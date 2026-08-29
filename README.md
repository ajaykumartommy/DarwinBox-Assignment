# migrateIQ - Employee migration command center

A focused, interview-ready prototype for the DarwinBox Forward Deployed Engineer take-home. It demonstrates a supervised agent workflow for moving messy HR data into a target employee schema.

## What it demonstrates

- Multi-file source ingestion, with a lightweight upload interaction and a seeded two-file demo workspace.
- Evidence-led field mapping: headers, value formats, and semantic signals build confidence; risky mappings do not silently apply.
- Safe normalization and duplicate reconciliation, with a clear autonomy boundary.
- Human review only for genuine ambiguity. Decisions can be approved, edited, or excluded and are retained in the audit trail.
- Controlled mock target delivery, with idempotent-upsert semantics, simulated retry behavior, and per-record accountability.

## Product decisions

The "agent" is deliberately constrained. It executes only transformations that are high confidence, reversible, and validated against the target shape. It escalates when source evidence supports more than one valid interpretation, a required value cannot be repaired confidently, or validation does not converge. This gives an implementation consultant a compact review queue instead of a noisy approval workflow.

The prototype runs locally and uses realistic seeded migration data so the happy path and review path are both immediately demoable. In a production implementation, the same deterministic confidence policy would sit beside an LLM-assisted mapper, with persisted runs, real file parsing, and a real target connector.

## Demo script (about 3 minutes)

1. Open **Migration run** and frame the autonomy boundary in the "What the agent handled" card.
2. Open **Source data** to show the two source exports consolidated into canonical records.
3. Open **Field mapping** to explain that every inferred mapping has visible evidence and confidence.
4. Open **Review queue**. Approve, exclude, or edit the seeded ambiguous date, location, duplicate-conflict, and missing-required-value cases to demonstrate human control and auditability.
5. Complete the decisions, return to **Target delivery**, and push to the mock API.
6. End in **Audit trail**, where automated work and human judgments are recorded together.

## Local development

The application has two local services. The React UI calls the FastAPI service
at `http://localhost:8000`; CORS is restricted to the local UI origins.

In one terminal, create an isolated Python environment and start the API:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
PYTHONPATH=. .venv/bin/uvicorn app.main:app --reload --port 8000
```

In a second terminal, start the UI:

```bash
npm install
npm run dev
```

Then open the URL printed by the development server and select **Run analysis**.
It creates a persisted demo run using the sample source files. Uploading CSV or
XLSX source files uses the same API pipeline; an optional JSON target schema is
supported by the API (`POST /api/runs/upload`), and the built-in employee schema
is used when one is not supplied from the UI.

The API exposes `GET /health`, run retrieval, escalation resolution, controlled
delivery, and explicit rollback endpoints. FastAPI also provides interactive API
documentation at `http://localhost:8000/docs` while running. Use `npm run build`
for a production UI build.

### Optional OpenAI advisor

The safety-critical processing path is deterministic by design. To add an
OpenAI advisory reviewer, set `OPENAI_API_KEY` before starting the API. Optionally
set `OPENAI_MODEL`; otherwise the app uses `gpt-4.1-mini`. The advisor reviews
the proposed mappings and escalation boundary; it never writes target records
or overrides validation rules. Its outcome is recorded in the run audit trail.

## What I would build next

1. Persist migration runs, raw-file fingerprints, decisions, and target responses in a tenant-scoped data store.
2. Add parser adapters for CSV/XLSX and a JSON/YAML schema upload flow.
3. Use an LLM only to propose mappings and explanations, backed by deterministic confidence scoring and validation rules.
4. Add row-level diff previews, bulk decisions, role-based review permissions, and true rollback support where the target API permits it.
