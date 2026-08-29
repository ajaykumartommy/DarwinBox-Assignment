# Design note: supervised migration autonomy

## Approach

This prototype treats client migration as a sequence of bounded decisions rather than an open-ended AI task. The UI accepts multiple source exports, builds a canonical employee view, proposes target mappings, runs validation, and sends only approved records to a mock target API. The primary workflow is deliberately visible: a consultant can follow the agent activity, inspect any uncertainty, and see the final delivery outcome without reading code or raw logs.

## Where the agent acts alone

The agent can perform transformations when they are high confidence, explainable, reversible, and target-valid. Examples: exact or known-alias field mappings; trimming and casing cleanup; normalizing unambiguous dates; canonicalizing email and telephone values; and merging duplicates with the same identifier when no non-empty fields conflict. The migration policy is deterministic and isolated in `lib/migration.ts`, which keeps the critical boundary testable even when an LLM is used to suggest mappings.

## Where it escalates

The agent must pause where a reasonable person could make more than one valid choice: a source column that could map to two target fields, a date such as `03/04/2024`, contradictory duplicate values, a missing required value that cannot be safely repaired, or repeated validation failure. Escalations include the record, evidence, confidence, and reason for pausing. A human can approve the recommendation, edit it, or exclude the record; the decision is reflected in the audit timeline.

## Delivery and trust

The mock target client models idempotent upsert behavior and a transient error that succeeds on a single retry. A production version would persist tenant-scoped run state, raw-file fingerprints, original and transformed values, reviewer identity, and each target response. It would also replace the seeded fixtures with CSV/XLSX parsers, target-schema upload, a real connector, role-based approvals, and explicit rollback where the target supports it.

## Prototype implementation

This submission includes a FastAPI and SQLite backend rather than only a UI simulation. It persists runs, canonical records, field mappings, escalations, reviewer actions, event history, and mock delivery responses. It accepts CSV/XLSX uploads, supports an optional target-schema JSON upload, blocks delivery while escalations are open, retries a deterministic transient target failure, and exposes an explicit rollback endpoint. The UI uses those API endpoints for its run, review, and delivery actions.
