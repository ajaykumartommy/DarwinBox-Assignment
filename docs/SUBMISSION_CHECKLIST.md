# Submission checklist

Use this checklist before sending the DarwinBox take-home.

## Included in this repository

- `README.md` — setup, product decisions, OpenAI configuration, and demo flow.
- `docs/DESIGN_NOTE.md` — the one-page supervised-autonomy write-up.
- `backend/` — FastAPI service, SQLite persistence, upload/parser pipeline, OpenAI advisory pass, review, delivery, and rollback endpoints.
- `app/` and `lib/` — working review UI and API client.
- `sample-data/` — two source exports and the target schema used in the demo.

## Local verification

Start the API and UI using the commands in `README.md`. Then verify:

1. Upload both sample source files from **Source data**.
2. Run analysis and confirm 6 source rows become 4 canonical records.
3. Inspect evidence-led mappings.
4. Resolve the date, email, location, and duplicate-conflict escalations.
5. Deliver to the mock target and show the retry.
6. Roll back the mock delivery.
7. Export the mapping and audit JSON files.
8. In **Audit trail**, show agent, human, target, and rollback events.

## OpenAI verification

Add `OPENAI_API_KEY` to `backend/.env`, restart the API, run analysis, and confirm the latest `Agent advisory` event has actor `OpenAI advisor`. Never include the key in the repository, screenshots, or recording.

## Suggested demo recording

Record a 3–4 minute screen capture showing: the autonomy boundary, real file upload, canonical records, mapping evidence, at least one correction in the review queue, delivery with retry, rollback, and the audit trail. Keep the API key and terminal environment variables off-screen.

## Final handoff

Submit the Git repository URL, the demo recording URL/file, and (if requested) `docs/DESIGN_NOTE.md` as the one-page write-up. The prototype is intentionally local/mock-target, so explain that the target contract is ready to swap for a tenant-scoped DarwinBox connector.
