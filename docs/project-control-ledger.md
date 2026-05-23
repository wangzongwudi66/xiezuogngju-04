# Project Control Ledger

This file is the handoff source for the main control conversation after context compression.
Read it first before making scheduling, branch, or merge decisions.

## User And Operating Mode

- The user acts as the customer manager, not a technical implementer.
- Communicate in Simplified Chinese.
- Give result-oriented guidance: current status, next action, whether to pause, rework, submit, merge, or verify.
- Main conversation owns project rhythm, review, branch management, and commit/merge decisions.
- Sub-conversations receive scoped tasks. They do not commit or push unless explicitly told.

## Main Branch Status

- Branch: `main`
- Remote tracking: `xiezuogongju-02/main`
- Current local `main` is ahead of remote by 4 commits.
- Do not push unless the user explicitly asks.

Main local commits not pushed:

1. `c741fb4 Complete project-scoped delivery workflow prototype`
2. `467d072 Persist uploaded delivery Word files`
3. `ae3a19c Add delivery import retry backend`
4. `d2a6db7 Add delivery import retry UI`

Main currently includes:

- Project switching and current project context.
- Member roles separated from episode/work assignments.
- Project-scoped episode assignment.
- Word/text import creates delivery drafts.
- Server-side delivery draft persistence.
- Delivery package confirmation, submit, publish, reject server-side flow.
- Uploaded original `.docx` file persistence.
- `fileId` on delivery import jobs.
- Backend retry for saved Word imports.
- Frontend retry button in import records.
- Coordinator/writer role view fixes.
- Hydration mismatch fix.

## Active Feature Branch

- Branch: `codex/asset-lock-workbench`
- Created from latest `main` at `d2a6db7`.
- Purpose: dedicated prototype for the asset review and final lock workflow.
- Current asset prototype is committed at `3471924 Add asset lock workbench prototype`.
- Current worktree should be clean before starting the next stage.

Committed asset workbench files:

- `apps/web/app/ui/asset-lock-workbench.tsx`
- `apps/web/app/ui/asset-lock-workbench-data.ts`
- `apps/web/app/ui/asset-lock-workbench.test.ts`
- `apps/web/app/ui/m1-dashboard.tsx`
- `apps/web/app/ui/m1-dashboard.test.ts`
- `apps/web/app/globals.css`
- `docs/project-control-ledger.md`

Asset branch completed so far:

- Added "资产定版" / asset lock entry.
- Added coordinator home entry for asset review and lock.
- Added writer/production side entry next to delivery center.
- Added asset lock workbench with:
  - Asset change overview.
  - Writer confirmation status.
  - Production confirmation status.
  - Dispute / missing-info counts.
  - Final lock readiness.
  - Filters by episode, asset type, status, owner, and risk.
  - Asset change list.
  - Single asset detail panel.
  - Writer note, production note, source paragraph, discussion records.
  - Batch writer confirmation.
  - Mark needs info.
  - Production confirmation.
  - Coordinator final lock action.
- Added domain-backed asset lock records in `WorkspaceState.assetLockRecords`.
- Added `/api/asset-lock-records` for list, create, writer confirm, production confirm, needs info, dispute, and final lock.
- Replaced mock-only workbench flow with API-backed records and server mutation refresh.
- Kept mock/demo mapping only as a minimal create/demo helper and display adapter.
- Asset helper, domain, API, and frontend behavior have tests.

Latest verification on asset branch:

```powershell
npm.cmd run verify
```

Passed:

- web: 7 test files, 48 tests passed.
- domain: 4 test files, 30 tests passed.
- build passed.

Next step for asset branch:

1. Continue into asset workflow model planning and implementation.
2. Keep backend/data-model work scoped to the asset lock stage.
3. Do not merge into `main` until the next stage is reviewed and committed.

## Sub-Conversation Status

### 并行A

- Completed coordinator role UI rework.
- Completed member role vs episode assignment model rework.
- Completed asset lock domain model implementation.
- Added `AssetLockRecord`, asset lock enum types, and domain actions for create, writer confirm, production confirm, needs info, dispute, and final lock.
- Verified with `npm.cmd run test -w packages/domain`, `npm.cmd run typecheck -w apps/web`, and `npm.cmd run test -w apps/web`.
- Status: paused.

### 分支2

- Completed import/parse UX rework.
- Completed import/parse reliability rework.
- Completed frontend import retry entry.
- Completed asset lock workbench UX/message pass after API integration.
- Improved empty states, role-specific action labels, processing states, final-lock blocking hints, and business error messages.
- Status: paused.

### 分支1

- Completed role home and navigation structure rework.
- Completed project switching and current project context rework.
- Fixed hydration mismatch.
- Completed asset lock workbench frontend API integration.
- Added frontend API helper, server-backed asset lock records, mutation handlers, and tests.
- Status: paused.

### 并行C

- Completed original Word file persistence.
- Completed backend delivery import retry.
- Completed `/api/asset-lock-records` backend service and route.
- Added service/route tests for list, create, writer confirm, production confirm, needs info, dispute, and final lock.
- Completed backend hardening after 并行D review.
- Added tests for ignored client status fields, cross-project rejection, invalid episodeNos, unauthorized actors, draft-package rejection, legacy snapshots without `assetLockRecords`, and GET-all behavior.
- Status: paused.

### 并行B

- Completed test review for original file persistence.
- Completed test review for import retry.
- Completed read-only review for asset lock API and workflow boundaries.
- Recommended `/api/asset-lock-records` as a separate API.
- Recommended storing asset lock records in `WorkspaceState.assetLockRecords`, reusing the current workspace persistence file.
- Status: paused.

### 并行D

- Completed Turbopack/NFT warning investigation and fix guidance.
- Completed safety/storage review for original Word file persistence.
- Completed read-only review for asset lock domain/API.
- Conclusion: needs minor backend hardening before final integration.
- Key concerns: actor identity is request-body trusted in prototype mode; clarify draft vs published delivery package creation rule; add tests for cross-project, unauthorized actors, ignored client status fields, and old snapshots without `assetLockRecords`.
- Status: paused.

### Lagrange

- Completed `delivery-packages` backend state mutation API.
- Status: paused.

### Ampere

- Completed frontend integration for delivery package state mutations.
- Status: paused.

## Current Do Not Do List

- Do not push `main` unless the user explicitly asks.
- Do not merge `codex/asset-lock-workbench` into `main` until manual review passes.
- Do not let multiple sub-conversations edit `m1-dashboard.tsx` at the same time.
- Do not expand into real database work yet.
- Do not build original Word download/audit UI unless it becomes a new stage.
- Do not create a separate asset JSON persistence file; keep asset records inside `WorkspaceState`.

## Recovery Steps After Context Compression

Run:

```powershell
git status --short --branch
git log --oneline --decorate --graph --all -12
```

Then:

- If current branch is `codex/asset-lock-workbench`, continue asset workbench review/refinement/commit.
- If current branch is `main`, confirm whether to switch back to `codex/asset-lock-workbench`.
- Before committing any feature stage, run:

```powershell
npm.cmd run verify
```

## Immediate Next Decision

Start the next asset stage with parallel support:

- Main conversation: own branch rhythm, integration, verification, and commits.
- One implementation sub-conversation can build the asset workflow/domain model.
- One review sub-conversation can review product flow, edge cases, and tests.
- Avoid concurrent edits to `m1-dashboard.tsx`.

Recommended next stage:

1. Run full `npm.cmd run verify`.
2. Commit the asset domain/API/frontend integration stage if verification passes.
3. Do not push or merge until the user asks.
4. Keep larger visual polish as a later stage.
