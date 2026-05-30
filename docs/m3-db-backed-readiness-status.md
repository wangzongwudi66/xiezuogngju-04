# M3 DB-Backed Readiness Status

This document records the current readiness boundary for the M3 DB-backed prototype. It is a status document, not a production readiness sign-off.

## Current DB-backed capabilities

The current `main` baseline includes DB-backed prototype coverage for these areas:

- Delivery import and package mutation paths: import, package update, submit, reject, and publish.
- Publish read-model overlay for the workspace snapshot/read path.
- Asset-lock records and script source bindings backed by Postgres repositories.
- Auth/scope read overlay for users, projects, memberships, permissions, episodes, and assignments.
- Delivery routes using a server-derived workspace actor instead of client-controlled actor fields.
- Asset attachment metadata stored in DB, with attachment bytes behind a storage abstraction.
- `postgres-smoke` harness coverage for the DB-backed happy path, including migration application, auth/scope seed rows, delivery package mutation flow, asset-lock generation and mutations, source binding add/remove, attachment metadata/file upload and soft delete, timeline projection read, and smoke cleanup assertions.

## Not formal backend-ready yet

The project must not claim a formal backend-ready state yet. Current blockers:

- A real `db:smoke` run has not passed against a disposable Postgres database.
- `workspace-session` remains a prototype workspace selector, not a formal auth/session implementation.
- Auth/scope DB support is read/seed oriented only; there is no approved admin write contract.
- Attachment bytes still use a local storage abstraction. There is no object storage provider, storage key schema, or checksum contract.
- Smoke coverage is still mostly happy path and does not substitute for broader runtime, permission, failure-mode, or object-storage coverage.

## Current pause line

Do not merge additional DB schema or DB runtime extensions until the real `db:smoke` has passed against a disposable database.

Documentation-only updates and review notes may continue, but they must not extend schema, migrations, runtime repository behavior, business services, tests, or UI under this pause line.

## Next gates

Use a disposable Postgres database only. Do not use shared, staging, production, or durable local data.

Required gates before lifting the pause line:

1. Obtain a disposable `TEST_DATABASE_URL`.
2. Run `npm.cmd run db:check -w apps/web`.
3. Run `npm.cmd run db:smoke -w apps/web`.

Until those commands complete successfully in that order, the project can only claim prototype DB-backed slices plus typecheck/static validation, not real Postgres smoke readiness.

## Recommended next batch after `db:smoke` passes

After a real disposable-DB smoke pass, the next DB-backed work should focus on production-facing backend contracts instead of further broad prototype expansion:

- Session/cookie-backed actor derivation to replace the prototype workspace-session selector.
- Object storage provider integration for attachment bytes.
- Auth/scope seed and admin write contract, including explicit ownership of who may create or mutate users, memberships, permissions, episodes, and assignments.
