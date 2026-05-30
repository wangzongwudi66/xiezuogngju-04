# M3 DB-Backed Readiness Status

This document records the current readiness boundary for the M3 DB-backed prototype. It is a status document, not a production readiness sign-off.

## Current DB-backed capabilities

The current `main` baseline includes DB-backed prototype coverage for these areas:

- Delivery import and package mutation paths: import, package update, submit, reject, and publish.
- Publish read-model overlay for the workspace snapshot/read path.
- Asset-lock records and script source bindings backed by Postgres repositories.
- Auth/scope read overlay for users, projects, memberships, permissions, episodes, and assignments.
- Delivery routes using a server-derived workspace actor instead of client-controlled actor fields.
- Request-scoped actor derivation through a signed HttpOnly workspace session cookie, with user existence revalidated against the overlaid workspace snapshot on each protected request.
- Asset attachment metadata stored in DB, with attachment bytes behind a storage abstraction.
- `postgres-smoke` harness coverage for the DB-backed happy path, including migration application, auth/scope seed rows, delivery package mutation flow, asset-lock generation and mutations, source binding add/remove, attachment metadata/file upload and soft delete, timeline projection read, and smoke cleanup assertions.
- GitHub Actions `db-smoke` coverage on disposable Postgres, with `db:check` followed by `db:smoke`.

## Not formal backend-ready yet

The project must not claim a formal backend-ready state yet. Current blockers:

- `workspace-session` now has request-scoped signed cookie actor derivation, but remains a prototype user selector. It is not a formal auth implementation with passwords, OAuth, account lifecycle, CSRF policy, revocation, or admin controls.
- Auth/scope DB support is read/seed oriented only; there is no approved admin write contract.
- Attachment bytes still use a local storage abstraction. There is no object storage provider, storage key schema, or checksum contract.
- Smoke coverage is still mostly happy path and does not substitute for broader runtime, permission, failure-mode, or object-storage coverage.

## Current gate line

The real disposable-Postgres `db:smoke` gate has passed in GitHub Actions. Additional DB schema or DB runtime extensions may proceed only with narrow implementation scope, focused tests, and the CI `db-smoke` gate kept active.

Local `db:smoke` still requires an explicit disposable `TEST_DATABASE_URL`; do not run it against shared, staging, production, or durable local data.

## Next gates

Use a disposable Postgres database only. Do not use shared, staging, production, or durable local data.

Required local gates when a disposable database is available:

1. Obtain a disposable `TEST_DATABASE_URL`.
2. Run `npm.cmd run db:check -w apps/web`.
3. Run `npm.cmd run db:smoke -w apps/web`.

For CI, keep `.github/workflows/db-smoke.yml` active on pull requests and `main` pushes.

## Recommended next batch after `db:smoke` passes

The next DB-backed work should focus on production-facing backend contracts instead of further broad prototype expansion:

- Object storage provider integration for attachment bytes.
- Auth/scope seed and admin write contract, including explicit ownership of who may create or mutate users, memberships, permissions, episodes, and assignments.
