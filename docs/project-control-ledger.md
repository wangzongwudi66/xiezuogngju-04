# Project Control Ledger

This file is the handoff source for the main control conversation after context compression.
Read it first before making scheduling, branch, or merge decisions.

## User And Operating Mode

- The user acts as the customer manager, not a technical implementer.
- Communicate in Simplified Chinese.
- Give result-oriented guidance: current status, next action, whether to pause, rework, submit, merge, or verify.
- Main conversation owns project rhythm, review, branch management, and commit/merge decisions.
- Sub-conversations receive scoped tasks. They do not commit or push unless explicitly told.
- Do not push unless the user explicitly asks.
- Keep this ledger updated before and after each major phase to avoid context loss.

## Main Branch Status

- Branch: `main`
- Remote tracking: `xiezuogongju-02/main`
- Local `main` is ahead of remote by 15 commits as of 2026-05-24.
- Latest local `main` commit before the next-stage branch: `05d018b Clean up delivery import test copy`.
- `codex/asset-lock-workbench` has been fast-forward merged into `main`.

Main currently includes:

- Project switching and current project context.
- Member roles separated from episode/work assignments.
- Project-scoped episode assignment.
- Word/text import creates delivery drafts.
- Server-side delivery draft persistence.
- Delivery package confirmation, submit, publish, reject server-side flow.
- Uploaded original `.docx` file persistence with `fileId`.
- Backend and frontend retry for saved Word imports.
- Asset lock workbench in the main project flow.
- Domain-backed `AssetLockRecord` and `AssetAttachment`.
- `/api/asset-lock-records` for list/create/mutate/prepare demo/generate from package.
- `/api/asset-lock-attachments` for upload/list.
- Asset candidate extraction from published delivery package episodes.
- Asset lock frontend with records, confirmation, needs-info, dispute, final lock, attachments, and locked upload blocking.

Latest main verification:

```powershell
npm.cmd run verify
```

Passed after merging asset lock workbench:

- web: 12 test files / 96 tests passed.
- domain: 5 test files / 44 tests passed.
- `next build` passed.

## Active Feature Branch

- Branch: `codex/asset-decision-timeline`
- Created from local `main` at `05d018b`.
- Purpose: prototype the next core module, "资产决策剪辑轨道".
- Current stage: planning and design baseline.
- Do not push or merge until reviewed.

## Asset Lock Workbench Completion

Completed and merged into `main`:

- `3471924 Add asset lock workbench prototype`
- `36393f5 Connect asset lock workflow to API`
- `c7192cc Add asset lock acceptance demo setup`
- `3982c23 Generate asset lock records from delivery content`
- `45eef39 Add asset lock attachment backend`
- `a8ed680 Connect asset lock attachments UI`
- `400b285 Polish asset lock workbench layout`
- `34ee098 Fix asset lock record hydration from server snapshot`
- `763de20 Harden asset attachment UI state handling`
- `f75b22c Clarify asset attachment UI copy`
- `05d018b Clean up delivery import test copy`

Known asset lock risks intentionally deferred:

- Prototype actor identity still comes from request body (`actorUserId`, `uploadedByUserId`).
- Real multi-user deployment needs a separate session/auth phase.
- Attachment download, preview, and delete routes are not implemented yet.
- The current asset candidate extraction is conservative keyword logic, not AI parsing.

## Next Core Module: Asset Decision Timeline

Working name: **资产决策剪辑轨道**.

This is not just an asset list. It should become a core work area for viewing and deciding asset lifecycle changes across a full series timeline.

Core goals:

- Show finalized script-driven asset lifecycle across the whole episode timeline.
- Show where each asset appears, persists, changes state, or disappears.
- Compare current version against previous version with ghost clips.
- Let writers and creators confirm, discuss, and decide asset changes.
- Let creators quickly see assets affecting their assigned episodes.

First-version scope:

- Local prototype data is acceptable.
- No real database expansion.
- No AI automatic asset parsing.
- No real image asset library requirement.
- Build a clear timeline UI first, then decide what domain/API to formalize.

Must-have first-version experience:

- A horizontal episode timeline, e.g. episode 1-60.
- Track layers by asset type: character, scene, prop, effect, status.
- Asset state segments as clips spanning episode ranges.
- A current-version clip and a lighter previous-version ghost clip.
- Change markers for new, removed, range changed, status changed, and source paragraph changed.
- Decision-aware aggregation when many assets crowd the same range.
- A left-side decision queue: due today, affects my episodes, waiting on others, script changes, conflicts.
- A right-side detail panel with decision explanation, asset detail, script comparison, and discussion.
- Creator view defaults to assigned episode window and relevant decisions.
- Writer/coordinator view can inspect the full series.

See detailed design baseline:

- `docs/asset-decision-timeline.md`

## Sub-Conversation Status

### 并行A

- Completed coordinator role UI rework.
- Completed member role vs episode assignment model rework.
- Completed asset lock domain model implementation.
- Completed conservative asset candidate extraction domain helper.
- Completed asset attachment domain metadata.
- Status: available for next task.

### 并行B

- Completed test reviews for Word persistence and import retry.
- Completed asset lock API/workflow review.
- Completed attachment design review.
- Completed final asset lock merge review; conclusion was "needs minor fixes", now addressed.
- Status: available for next read-only product/test review.

### 并行C

- Completed original Word file persistence.
- Completed backend delivery import retry.
- Completed `/api/asset-lock-records`.
- Completed candidate-generation API integration.
- Completed `/api/asset-lock-attachments`.
- Status: available for next implementation task.

### 并行D

- Completed Turbopack/NFT warning guidance.
- Completed asset lock safety/storage review.
- Completed attachment security/storage review.
- Completed UI parallel-safety and final asset lock UI review; minor copy fix addressed.
- Status: available for next UI/interaction review.

### 分支1

- Completed role home/navigation structure rework.
- Completed project switching and hydration fixes.
- Completed asset lock API frontend integration.
- Completed attachment upload/list frontend integration.
- Status: available for next frontend implementation task.

### 分支2

- Completed import/parse UX work.
- Completed asset lock UX/message pass.
- Completed static UI/visual audit.
- Status: available for CSS/visual polish work after main prototype structure lands.

### 分支3

- Provided the design direction for "资产决策剪辑轨道".
- Key decision: use a timeline/editing-track mental model, with decision queue and right-side detail panel.
- Status: continue as product/design sparring branch if needed.

## Current Do Not Do List

- Do not push unless the user explicitly asks.
- Do not expand into real database work yet.
- Do not start real session/auth unless explicitly chosen as a phase.
- Do not build AI automatic asset parsing in the first timeline prototype.
- Do not let multiple sub-conversations edit the same high-conflict files at the same time.
- Avoid broad rewrites of `m1-dashboard.tsx` until the timeline prototype surface is chosen.

## Recovery Steps After Context Compression

Run:

```powershell
git status --short --branch
git log --oneline --decorate --graph --all -12
Get-Content docs/project-control-ledger.md -Raw
Get-Content docs/asset-decision-timeline.md -Raw
```

Then:

- If current branch is `codex/asset-decision-timeline`, continue the timeline design/prototype stage.
- If current branch is `main`, confirm whether to switch back to `codex/asset-decision-timeline`.
- Before committing any implementation stage, run targeted tests.
- Before merge decisions, run:

```powershell
npm.cmd run verify
```

## Immediate Next Decision

Start the asset decision timeline stage.

Recommended first actions:

1. Commit the design baseline and ledger update on `codex/asset-decision-timeline`.
2. Ask 并行B for first-version scope review and risk trimming.
3. Ask 并行D for timeline UI/interaction critique.
4. Start a local prototype plan for data shape and static UI, avoiding API/domain overcommit until the UI model is validated.
