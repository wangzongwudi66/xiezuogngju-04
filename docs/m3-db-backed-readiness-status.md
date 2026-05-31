# M3 DB-Backed Readiness Status

This document records the current readiness boundary for the M3 DB-backed prototype. It is a status document, not a production readiness sign-off.

## Current DB-backed capabilities

The current `main` baseline includes DB-backed prototype coverage for these areas:

- Delivery import and package mutation paths: import, package update, submit, reject, and publish.
- Publish read-model overlay for the workspace snapshot/read path.
- Asset-lock records and script source bindings backed by Postgres repositories.
- Auth/scope read overlay for users, projects, memberships, permissions, episodes, and assignments.
- Auth/scope deterministic seed and narrow DB write contract for users, projects, memberships, permissions, and episode assignments.
- Auth/scope admin route and dashboard integration for DB/server-owned auth/scope writes, with signed-cookie actor resolution and server snapshot refresh after successful mutations.
- DB mode guardrails that prevent local workspace persistence from mutating DB-owned auth/scope arrays.
- Delivery routes using a server-derived workspace actor instead of client-controlled actor fields.
- Request-scoped actor derivation through a signed HttpOnly workspace session cookie, with user existence revalidated against the overlaid workspace snapshot on each protected request.
- Asset attachment metadata stored in DB, with attachment bytes behind a local or explicit S3-compatible storage provider abstraction.
- Asset attachment storage metadata is persisted as nullable `storage_key` / `checksum_sha256` sidecar data in the repository layer, without exposing those storage internals through the domain model or API response.
- Attachment download reads use the persisted storage key when present, preserve a legacy derived-key fallback, and verify byte size/checksum integrity.
- Attachment routes now use a storage-error allowlist mapper with stable fallback behavior for unknown provider, S3, and raw storage errors; storage verification failures map to a stable `502`.
- Attachment uploads verify storage writes: local storage checks stat size, and S3-compatible storage sends checksum metadata on `PutObject` and verifies `HeadObject` `ContentLength` plus checksum metadata.
- Asset attachment orphan audit-only support is present: local and S3 object-list adapters compare provider objects against a DB referenced-key set, prefer `storage_key`, fall back to `fileId + extname(fileName)` for legacy rows, count both active and deleted metadata as referenced, apply a default 24h grace period, classify unreferenced objects as `orphan_candidate`, `young`, or `unknown_age`, and report only `keyHash`/counts/size/reason/age metadata instead of raw keys, buckets, or endpoints.
- `postgres-smoke` harness coverage for the DB-backed happy path, including migration application, auth/scope seed rows, auth/scope admin route writes, delivery package mutation flow, asset-lock generation and mutations, source binding add/remove, attachment metadata/file upload and soft delete, timeline projection read, and smoke cleanup assertions.
- GitHub Actions `db-smoke` coverage on disposable Postgres, with `db:check` followed by `db:smoke`.

## Not formal backend-ready yet

The project must not claim a formal backend-ready state yet. Current blockers:

- `workspace-session` now has request-scoped signed cookie actor derivation, but remains a prototype user selector. It is not a formal auth implementation with passwords, OAuth, account lifecycle, CSRF policy, revocation, or admin controls.
- Auth/scope admin writes are narrow and DB-backed, but still do not constitute a formal product account-management system. Self-registration remains prototype-only and is not wired to the admin API.
- Attachment bytes can use an S3-compatible provider and now persist nullable storage key/checksum metadata with read-path and upload verification checks. Orphan audit-only support exists, but historical object backfill, schema tightening, production object-store integration, orphan cleanup/delete, and production scheduler/CLI/API entrypoints remain future work.
- Smoke coverage is still mostly happy path and does not substitute for broader runtime, permission, failure-mode, object-storage, CSRF, audit, or browser/manual coverage.

## Current gate line

The real disposable-Postgres `db:smoke` gate has passed in GitHub Actions after the orphan audit-only merge. Remote run `26704014543` completed successfully for `7d2acc2883ce65da4cdc9166370d0203fffd4aef`.

The orphan audit-only implementation is merged on `main`: `0cb1dcd` (`0cb1dcd6ebbdcf525d7424cd9a2caef2e3be1d74`) with merge record `7d2acc2883ce65da4cdc9166370d0203fffd4aef`. This does not complete cleanup/delete automation or make the project formally backend-ready.

Local `db:smoke` was not run for this readiness refresh. It still requires an explicit disposable `TEST_DATABASE_URL`; do not run it against shared, staging, production, or durable local data.

## Next gates

Use a disposable Postgres database only. Do not use shared, staging, production, or durable local data.

Required local gates when a disposable database is available:

1. Obtain a disposable `TEST_DATABASE_URL`.
2. Run `npm.cmd run db:check -w apps/web`.
3. Run `npm.cmd run db:smoke -w apps/web`.

For CI, keep `.github/workflows/db-smoke.yml` active on pull requests and `main` pushes.

## Recommended next batch

The next DB-backed work should focus on hardening the production-facing contracts already introduced instead of broad prototype expansion:

- Add browser-level/manual or automated coverage for the DB/server-owned dashboard admin flows: create/update/archive project, save member roles, save permissions, and assign episodes.
- Define the next auth/session hardening contract: CSRF posture, session revocation/rotation, audit fields, and the boundary between prototype user selection and formal account lifecycle.
- Plan historical object backfill plus schema tightening for attachment storage metadata, including when to move `storage_key` / `checksum_sha256` from nullable sidecar fields toward not-null/check/unique constraints.
- Complete production object-store integration and opt-in S3/MinIO integration tests before relying on object storage in production.
- Complete orphan object cleanup/delete plus production scheduler or explicit CLI/API entrypoints; audit-only support is already present, cleanup is not.
- Add browser/manual failure-mode coverage for attachment upload, download, storage-provider errors, integrity failures, and verification failures.
- Continue split-brain hardening so DB-owned arrays are read and written only through DB repositories in DB mode.
