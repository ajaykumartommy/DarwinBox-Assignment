# migrateIQ - Employee migration command center

A focused, interview-ready prototype for the DarwinBox Forward Deployed Engineer take-home. It demonstrates a supervised agent workflow for moving messy HR data into a target employee schema.

## What it demonstrates

- Multi-file source ingestion, with a lightweight upload interaction; analysis requires the user to select source files.
- Evidence-led field mapping: headers, value formats, and semantic signals build confidence; risky mappings do not silently apply.
- Safe normalization and duplicate reconciliation, with a clear autonomy boundary.
- Human review only for genuine ambiguity. Decisions can be approved, edited, or excluded and are retained in the audit trail.
- Controlled mock target delivery, with idempotent-upsert semantics, simulated retry behavior, and per-record accountability.

## Product decisions

The "agent" is deliberately constrained. It executes only transformations that are high confidence, reversible, and validated against the target shape. It escalates when source evidence supports more than one valid interpretation, a required value cannot be repaired confidently, or validation does not converge. This gives an implementation consultant a compact review queue instead of a noisy approval workflow.

The prototype runs locally and includes realistic sample exports so the happy path and review path are immediately demoable. The UI requires the user to upload source files before analysis. It persists runs in SQLite and accepts real CSV/XLSX uploads; a production implementation would replace the mock target connector with a tenant-scoped DarwinBox integration.

## Demo script (about 3 minutes)

1. Open **Source data** and upload the two source exports.
2. Open **Migration run** and frame the autonomy boundary in the "What the agent handled" card.
3. Open **Field mapping** to explain that every inferred mapping has visible evidence and confidence.
4. Open **Review queue**. Approve, exclude, or edit the ambiguous date, location, duplicate-conflict, and missing-required-value cases from the uploaded samples to demonstrate human control and auditability.
5. Complete the decisions, return to **Target delivery**, and push to the mock API. The visible retry and **Roll back mock delivery** controls exercise the delivery safeguards.
6. End in **Audit trail**, where automated work, human judgments, target responses, and any rollback are recorded together.

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

Then open the URL printed by the development server, select **Source data**, and
upload one or more CSV/XLSX files before selecting **Run analysis**. The UI never
substitutes seeded files on the first run. Uploaded source files use the same API
pipeline; an optional JSON target schema is supported by the API
(`POST /api/runs/upload`), and the built-in employee schema is used when one is
not supplied from the UI.

The API exposes `GET /health`, run retrieval, escalation resolution, controlled
delivery, and explicit rollback endpoints. FastAPI also provides interactive API
documentation at `http://localhost:8000/docs` while running. Use `npm run build`
for a production UI build.

### Optional OpenAI advisor

The safety-critical processing path is deterministic by design. To add an
OpenAI advisory reviewer, add `OPENAI_API_KEY=...` to `backend/.env` (or set it
in the shell) before starting the API. Optionally set `OPENAI_MODEL`; otherwise
the app uses `gpt-4.1-mini`. The advisor reviews
the proposed mappings and escalation boundary; it never writes target records
or overrides validation rules. Its outcome is recorded in the run audit trail.

## What I would build next

1. Move the SQLite run store to a tenant-scoped production database with raw-file fingerprints and retention controls.
2. Add YAML schema support and richer parser diagnostics for large or malformed source exports.
3. Expand the OpenAI advisor to propose mappings and explanations, still backed by deterministic confidence scoring and validation rules.
4. Add row-level diff previews, bulk decisions, role-based review permissions, and a live target rollback where the target API permits it.
