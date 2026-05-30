# M3 Real Postgres Smoke Runbook

This runbook is the minimum checklist for running the real Postgres smoke safely after a disposable `TEST_DATABASE_URL` is available.

## Safety rule

Use only a dedicated disposable Postgres database for this smoke.

Do not point `TEST_DATABASE_URL` at production, shared development, staging data that must be preserved, or a copied value from `DATABASE_URL`. The smoke intentionally ignores raw `DATABASE_URL`; it reads `TEST_DATABASE_URL`, maps it to `DATABASE_URL` inside the Vitest process, runs migrations, writes smoke rows, and deletes rows matching its smoke identifiers.

If `TEST_DATABASE_URL` is missing, the smoke must fail with `db_smoke_test_database_url_required`. In that state, do not claim the real smoke passed.

## Commands

From the repository root:

```powershell
npm.cmd run db:check -w apps/web
$env:TEST_DATABASE_URL="postgres://user:password@host:5432/disposable_db"
npm.cmd run db:smoke -w apps/web
```

After the run, clear the shell variable if the terminal will be reused:

```powershell
Remove-Item Env:\TEST_DATABASE_URL
```

## What the smoke does

The smoke entrypoint is `apps/web/db/postgres-smoke.ts`, run through `npm.cmd run db:smoke -w apps/web`.

Before the test body, it:

- creates a temp directory under the OS temp path;
- sets `AIGC_DELIVERY_IMPORT_STORE_PATH` to a temp JSON store;
- sets `AIGC_ASSET_LOCK_ATTACHMENT_FILE_DIR` to a temp attachment directory;
- sets `ASSET_LOCK_RECORDS_REPOSITORY=db` and `ASSET_LOCK_ATTACHMENTS_REPOSITORY=db`;
- applies every migration in `apps/web/db/migrations` through Drizzle's Postgres migrator;
- runs smoke cleanup once before seeding;
- seeds auth/scope, episode, and delivery package rows.

The test then exercises the DB-backed happy path:

- generates asset lock records from a smoke delivery package;
- creates an asset lock record;
- binds and removes a script source binding;
- uploads two attachment metadata rows and file payloads, then soft-deletes both attachments;
- reads the asset decision timeline projection;
- runs writer confirmation, production confirmation, and final lock;
- runs cleanup twice and asserts all smoke row counts are zero.

## Tables migrated, written, and cleaned

Migrations may create or alter all tables represented by `apps/web/db/migrations`, plus Drizzle migration metadata. The smoke cleanup does not remove migration metadata.

The smoke writes rows in these application tables:

- `users`: fixed users `user-head-writer`, `user-owner`, `user-creator-a`;
- `projects`: fixed project `project-jincheng` with code `SMK-JC`;
- `project_members`: ids beginning `smoke-member-`;
- `project_member_permissions`: ids beginning `smoke-permission-`;
- `episodes`: ids beginning `smoke-episode-`;
- `episode_assignments`: ids beginning `smoke-assignment-`;
- `delivery_packages`: ids beginning `smoke-delivery-`;
- `delivery_package_episodes`: rows for the two smoke packages;
- `asset_lock_records`: generated and manually created smoke asset records for `smoke-delivery-%`;
- `asset_lock_record_episodes`: episode join rows for those smoke asset records;
- `script_source_bindings`: explicit binding rows for `smoke-delivery-%`;
- `asset_attachments`: attachment metadata rows for `smoke-delivery-%`.

Cleanup deletes, in FK-safe order:

- `asset_attachments` where `delivery_package_id like 'smoke-delivery-%'`;
- `script_source_bindings` where `delivery_package_id like 'smoke-delivery-%'`;
- `asset_lock_record_episodes` attached to `asset_lock_records` where `delivery_package_id like 'smoke-delivery-%'`;
- `asset_lock_records` where `delivery_package_id like 'smoke-delivery-%'`;
- `delivery_package_episodes` where `delivery_package_id like 'smoke-delivery-%'`;
- `delivery_packages` where `id like 'smoke-delivery-%'`;
- `episode_assignments` where `id like 'smoke-assignment-%'`;
- `episodes` where `id like 'smoke-episode-%'`;
- `project_member_permissions` where `id like 'smoke-permission-%'`;
- `project_members` where `id like 'smoke-member-%'`;
- `projects` where `id = 'project-jincheng'`;
- `users` where `id in ('user-head-writer', 'user-owner', 'user-creator-a')`.

The temp attachment directory and temp delivery import store are removed by the test process after runtime cleanup.

## Failure triage

- Migration failure: run `npm.cmd run db:check -w apps/web` first, verify `TEST_DATABASE_URL` points to an empty disposable database, and inspect the failing migration name from the smoke output. A partially migrated disposable database should be dropped and recreated before retrying.
- FK failure: confirm no pre-existing data in the disposable database references the fixed smoke ids or `project-jincheng`. The cleanup assumes smoke-owned rows only and deletes in dependency order.
- Unique constraint failure: look for collisions on fixed values such as `users.name`, `projects.code = 'SMK-JC'`, `delivery_packages.id like 'smoke-delivery-%'`, `asset_lock_records.delivery_package_id + asset_name_key`, or source binding uniqueness. Recreate the disposable database if there is any doubt.
- Cleanup failure: check which cleanup query failed and whether new FK relationships were added after this runbook. The smoke asserts all tracked smoke row counts return to zero after two cleanup calls.
- Attachment temp dir failure: verify the OS temp directory is writable and that the process can create and remove `aigc-postgres-smoke-*` directories. Attachment files are local temp files; only metadata is stored in Postgres.
- Connection pool hang or exhaustion: ensure no previous smoke process is still running against the same database. The script opens short-lived pools for migration, seed, cleanup, and count checks, and closes the cached runtime at the end.

## Current limitation

This repository can only claim typecheck, migration check, or the expected fail-closed behavior without a real disposable `TEST_DATABASE_URL`. A real Postgres smoke pass requires the actual command `npm.cmd run db:smoke -w apps/web` to complete successfully with `TEST_DATABASE_URL` set to a disposable Postgres database.
