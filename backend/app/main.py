from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .db import Database, json_value, load_json
from .migration import Escalation, parse_source, process_rows
from .advisor import review_migration


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATABASE_PATH = Path(os.getenv("MIGRATION_DB_PATH", PROJECT_ROOT / "backend" / "data" / "migration.db"))
db = Database(DATABASE_PATH)

app = FastAPI(title="migrateIQ API", version="1.0.0", description="Supervised client data migration API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


class ResolutionRequest(BaseModel):
    action: str = Field(pattern="^(approve|exclude|edit)$")
    note: str = Field(default="")
    actor: str = Field(default="Implementation lead")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def event(connection: Any, run_id: str, kind: str, detail: str, actor: str = "Agent") -> None:
    connection.execute("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?)", (str(uuid.uuid4()), run_id, kind, detail, actor, now()))


def run_summary(run_id: str) -> dict[str, Any]:
    with db.connect() as connection:
        run = connection.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if not run:
            raise HTTPException(404, "Migration run not found.")
        records = connection.execute("SELECT * FROM records WHERE run_id = ? ORDER BY source_key", (run_id,)).fetchall()
        mappings = connection.execute("SELECT * FROM mappings WHERE run_id = ? ORDER BY target_field", (run_id,)).fetchall()
        escalations = connection.execute("SELECT * FROM escalations WHERE run_id = ? ORDER BY rowid", (run_id,)).fetchall()
        events = connection.execute("SELECT * FROM events WHERE run_id = ? ORDER BY created_at", (run_id,)).fetchall()
        deliveries = connection.execute("SELECT * FROM deliveries WHERE run_id = ? ORDER BY created_at", (run_id,)).fetchall()

    open_count = sum(item["status"] == "open" for item in escalations)
    return {
        "id": run["id"], "status": run["status"], "created_at": run["created_at"], "source_files": load_json(run["source_files"]),
        "metrics": {"source_records": run["source_count"], "ready_records": sum(item["status"] == "ready" for item in records), "open_escalations": open_count},
        "records": [{"id": item["id"], "key": item["source_key"], "payload": load_json(item["payload"]), "status": item["status"]} for item in records],
        "mappings": [dict(item) for item in mappings],
        "escalations": [{**dict(item), "evidence": load_json(item["evidence"]), "resolution": load_json(item["resolution"]) if item["resolution"] else None} for item in escalations],
        "events": [dict(item) for item in events], "deliveries": [{**dict(item), "response": load_json(item["response"])} for item in deliveries],
    }


def create_run(files: List[tuple[str, bytes]], target_schema: dict[str, Any]) -> dict[str, Any]:
    source_rows = []
    for filename, content in files:
        try:
            parsed = parse_source(filename, content)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        for row in parsed:
            row["_source_file"] = filename
        source_rows.extend(parsed)
    if not source_rows:
        raise HTTPException(422, "No data rows found in uploaded source files.")
    try:
        result = process_rows(source_rows, target_schema)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    run_id = str(uuid.uuid4())
    with db.connect() as connection:
        connection.execute("INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?)", (run_id, "in_review", json_value([name for name, _ in files]), json_value(target_schema), result.source_count, now(), None))
        for row in result.records:
            key = row.get("employeeNumber") or row.get("email") or str(uuid.uuid4())
            record_status = "needs_review" if any(item.record_key == key for item in result.escalations) else "ready"
            connection.execute("INSERT INTO records VALUES (?, ?, ?, ?, ?)", (str(uuid.uuid4()), run_id, key, json_value(row), record_status))
        for mapping in result.mappings:
            connection.execute("INSERT INTO mappings VALUES (?, ?, ?, ?, ?, ?, ?)", (str(uuid.uuid4()), run_id, mapping["source_field"], mapping["target_field"], mapping["confidence"], mapping["reason"], mapping["status"]))
        for escalation in result.escalations:
            connection.execute("INSERT INTO escalations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (str(uuid.uuid4()), run_id, escalation.record_key, escalation.kind, escalation.title, escalation.detail, escalation.confidence, json_value(escalation.evidence), "open", None))
        for item in result.audit:
            event(connection, run_id, item["type"], item["detail"])
        agent_mode, agent_note = review_migration(target_schema, result.mappings, len(result.escalations))
        event(connection, run_id, "Agent advisory", agent_note, "OpenAI advisor" if agent_mode == "openai" else "Policy agent")
    return run_summary(run_id)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/runs/demo", status_code=201)
def create_demo_run() -> dict[str, Any]:
    samples = PROJECT_ROOT / "sample-data"
    schema = json.loads((samples / "target-schema.json").read_text())
    files = [("northstar_people.csv", (samples / "northstar_people.csv").read_bytes()), ("benefits_export.csv", (samples / "benefits_export.csv").read_bytes())]
    return create_run(files, schema)


@app.post("/api/runs/upload", status_code=201)
async def upload_run(files: List[UploadFile] = File(...), target_schema: Optional[UploadFile] = File(None)) -> dict[str, Any]:
    if target_schema is None:
        schema = json.loads((PROJECT_ROOT / "sample-data" / "target-schema.json").read_text())
    else:
        if not target_schema.filename or not target_schema.filename.lower().endswith(".json"):
            raise HTTPException(422, "Upload the target schema as JSON.")
        try:
            schema = json.loads((await target_schema.read()).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(422, "Target schema is not valid JSON.") from exc
    uploaded = [(item.filename or "source.csv", await item.read()) for item in files]
    return create_run(uploaded, schema)


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    return run_summary(run_id)


@app.post("/api/runs/{run_id}/escalations/{escalation_id}/resolve")
def resolve_escalation(run_id: str, escalation_id: str, request: ResolutionRequest) -> dict[str, Any]:
    with db.connect() as connection:
        escalation = connection.execute("SELECT * FROM escalations WHERE id = ? AND run_id = ?", (escalation_id, run_id)).fetchone()
        if not escalation:
            raise HTTPException(404, "Escalation not found.")
        if escalation["status"] != "open":
            raise HTTPException(409, "This escalation has already been resolved.")
        status = "approved" if request.action in {"approve", "edit"} else "excluded"
        resolution = {"action": request.action, "note": request.note, "actor": request.actor, "resolved_at": now()}
        if request.action == "edit" and escalation["record_key"] != "source-column":
            record = connection.execute("SELECT * FROM records WHERE run_id = ? AND source_key = ?", (run_id, escalation["record_key"])).fetchone()
            if not record:
                raise HTTPException(404, "The record for this escalation no longer exists.")
            payload = load_json(record["payload"])
            if escalation["kind"] == "ambiguous_date":
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", request.note):
                    raise HTTPException(422, "For a date correction, enter an ISO date such as 2021-04-03.")
                payload["joined_on"] = request.note
            elif escalation["kind"] == "validation_failure":
                field = load_json(escalation["evidence"]).get("target_field")
                if field == "email" and "@" not in request.note:
                    raise HTTPException(422, "For an email correction, enter a valid email address.")
                if field:
                    payload[field] = request.note
            connection.execute("UPDATE records SET payload = ? WHERE id = ?", (json_value(payload), record["id"]))
        connection.execute("UPDATE escalations SET status = ?, resolution = ? WHERE id = ?", (status, json_value(resolution), escalation_id))
        if escalation["record_key"] != "source-column":
            record_status = "excluded" if status == "excluded" else "ready"
            connection.execute("UPDATE records SET status = ? WHERE run_id = ? AND source_key = ?", (record_status, run_id, escalation["record_key"]))
        event(connection, run_id, "Human decision", f"{request.action.title()}d: {escalation['title']}", request.actor)
    return run_summary(run_id)


@app.post("/api/runs/{run_id}/deliver")
def deliver_run(run_id: str) -> dict[str, Any]:
    with db.connect() as connection:
        run = connection.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if not run:
            raise HTTPException(404, "Migration run not found.")
        open_items = connection.execute("SELECT COUNT(*) AS count FROM escalations WHERE run_id = ? AND status = 'open'", (run_id,)).fetchone()["count"]
        if open_items:
            raise HTTPException(409, "Resolve every open escalation before delivery.")
        records = connection.execute("SELECT * FROM records WHERE run_id = ? AND status = 'ready' ORDER BY source_key", (run_id,)).fetchall()
        accepted = retried = 0
        for index, record in enumerate(records):
            attempts = 2 if index == 0 else 1
            response = {"status": 201, "message": "upsert accepted"}
            if attempts == 2:
                response["retry"] = {"status": 429, "message": "rate limited; accepted on retry"}
                retried += 1
            connection.execute("INSERT INTO deliveries VALUES (?, ?, ?, ?, ?, ?, ?)", (str(uuid.uuid4()), run_id, record["id"], "accepted", attempts, json_value(response), now()))
            accepted += 1
        connection.execute("UPDATE runs SET status = 'delivered', delivered_at = ? WHERE id = ?", (now(), run_id))
        event(connection, run_id, "Delivered", f"Delivered {accepted} records to mock target; {retried} retried successfully.")
    return run_summary(run_id)


@app.post("/api/runs/{run_id}/rollback")
def rollback_run(run_id: str) -> dict[str, Any]:
    with db.connect() as connection:
        run = connection.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if not run:
            raise HTTPException(404, "Migration run not found.")
        count = connection.execute("SELECT COUNT(*) AS count FROM deliveries WHERE run_id = ?", (run_id,)).fetchone()["count"]
        if not count:
            raise HTTPException(409, "No delivered records are available to roll back.")
        connection.execute("DELETE FROM deliveries WHERE run_id = ?", (run_id,))
        connection.execute("UPDATE runs SET status = 'rolled_back', delivered_at = NULL WHERE id = ?", (run_id,))
        event(connection, run_id, "Rollback", f"Rolled back {count} mock target deliveries.", "Implementation lead")
    return run_summary(run_id)
