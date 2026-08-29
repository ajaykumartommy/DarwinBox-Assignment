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
4. Open **Review queue**. Approve one recommendation and exclude another to demonstrate human control and auditability.
5. Complete the remaining decision, return to **Target delivery**, and push to the mock API.
6. End in **Audit trail**, where automated work and human judgments are recorded together.

## Local development

```bash
npm install
npm run dev
```

Then open the URL printed by the development server. Use `npm run build` for a production build.

## What I would build next

1. Persist migration runs, raw-file fingerprints, decisions, and target responses in a tenant-scoped data store.
2. Add parser adapters for CSV/XLSX and a JSON/YAML schema upload flow.
3. Use an LLM only to propose mappings and explanations, backed by deterministic confidence scoring and validation rules.
4. Add row-level diff previews, bulk decisions, role-based review permissions, and true rollback support where the target API permits it.
