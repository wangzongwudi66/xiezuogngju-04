# Project Control Ledger

This file is the handoff source for the main control conversation after context compression.
Read it first before making scheduling, branch, or merge decisions.

## Script Source Binding Mutation Progress

Timestamp: `2026-05-25 22:15:31 +08:00`.

Active branch:

- Branch: `codex/script-source-binding-mutations`.
- Baseline HEAD: `f9b7b1c Record script source binding service merge`.
- Scope: narrow `asset-lock-records` source-binding writes only.
- Do not push unless the user explicitly asks.

Implemented so far:

- Added domain `removeScriptSourceBinding` helper.
- Hardened domain `removeScriptSourceBinding` so removal revalidates project, published package, record/package relationship, record episode membership, confirmed package episode, and locked-record state.
- Added `/api/asset-lock-records` mutation actions:
  - `bind_source`
  - `remove_source_binding`
- Service derives actor identity from `WorkspaceState.currentUserId`; client `createdByUserId`, `actorUserId`, `excerptSnapshot`, `viewerRole`, and `assignedEpisodeNos` are ignored for source binding writes.
- Writer source-binding permission is checked against the exact binding `episodeNo`; creator remains read-only.
- Added service regression coverage proving a writer cannot remove a binding for an out-of-assignment episode even when the same asset record spans an in-scope episode.
- Locked asset records reject bind/remove source binding.
- `mutateAssetLockRecord` returns optional `sourceBinding` or `removedSourceBindingId` for UI follow-up without changing existing record/list response behavior.
- Added projection regression that explicit binding priority is preserved and fallback source matching returns after explicit bindings are removed.
- No changes to `asset-decision-timeline.tsx`, `globals.css`, or `m1-dashboard.tsx`.

Targeted verification passed:

- `npm.cmd run test -w packages/domain -- script-source-binding`: 1 file / 16 tests.
- `npm.cmd run test -w apps/web -- app/api/asset-lock-records/service.test.ts`: 1 file / 23 tests.
- `npm.cmd run test -w apps/web -- app/api/asset-lock-records/route.test.ts`: 1 file / 11 tests.
- `npm.cmd run test -w apps/web -- app/asset-decision-timeline/projection.test.ts`: 1 file / 16 tests.
- `npm.cmd run test -w apps/web -- app/api/asset-decision-timeline/service.test.ts app/api/asset-decision-timeline/route.test.ts`: 2 files / 16 tests.
- `npm.cmd run test -w apps/web -- asset-lock-records asset-decision-timeline`: 8 files / 82 tests.
- `npm.cmd run typecheck`: passed for web and domain.
- `npm.cmd run typecheck -w apps/web`: passed.
- `git diff --check`: passed.
- Full `npm.cmd run verify` passed:
  - web: 20 files / 162 tests.
  - domain: 6 files / 63 tests.
  - Next production build passed.

Next action:

1. 07/08 read-only reviews confirmed no P0/P1 and approved merge preparation.
2. Merge-prep `npm.cmd run verify` passed:
   - web: 20 files / 162 tests.
   - domain: 6 files / 63 tests.
   - Next production build passed.
3. Fast-forward merged `codex/script-source-binding-mutations` into `main` through `0e44776 Harden source binding removal checks`.
4. Next recommended phase: browser/API smoke for bind/remove source behavior, then decide whether to add a minimal UI source-binding control or keep UI deferred.

## API Switch Handoff Snapshot

Timestamp: `2026-05-25 21:17:03 +08:00`.
Updated after merge: `2026-05-25`.

If the current conversation is lost, start here:

- Current branch: `main`.
- Current HEAD: `9491ee6 Add API switch handoff snapshot`.
- Merged branch: `codex/script-source-binding-service`.
- Functional service commit: `a3e417d Pass source bindings into timeline service`.
- Handoff-only commit: `9491ee6 Add API switch handoff snapshot`.
- Worktree at last check: clean after fast-forward merge.
- Do not push unless the user explicitly asks.

Current main includes:

- Projection dirty-binding defense: explicit `ScriptSourceBinding` is ignored unless its `episodeNo` belongs to the target `AssetLockRecord.episodeNos`.
- `/api/asset-decision-timeline` service read-only plumbing: passes `state.scriptSourceBindings ?? []` into `buildAssetTimelineProjection`.
- Route remains GET-only/read-only and still ignores client-provided `viewerRole`, `viewerUserId`, and `assignedEpisodeNos`.
- Tests cover explicit binding priority, creator/writer scope, dirty persisted bindings, route-level hidden binding filtering, and legacy-safe behavior.

Verification already run on this branch:

- `npm.cmd run test -w apps/web -- asset-decision-timeline` passed: 6 files / 47 tests.
- `npm.cmd run typecheck -w apps/web` passed.
- `npm.cmd run verify` passed:
  - web: 20 files / 154 tests.
  - domain: 6 files / 58 tests.
  - Next production build passed.

Completed action:

1. 03/04 read-only reviews reported no P0/P1 and approved merge.
2. Fast-forward merged `codex/script-source-binding-service` into `main`.
3. Updated this ledger with the merge result.

Recommended next action:

1. Run/confirm post-merge `npm.cmd run verify`.
2. Only after that, plan the next branch for narrow `asset-lock-records` source-binding mutations.

01 read-only review prompt:

```text
你是 01 产品/权限复审分支，基线为 codex/script-source-binding-service 的 HEAD a3e417d。只读复审，不要改文件、不要 stage、不要 commit、不要 push。

任务：复审 ScriptSourceBinding service 只读透传。重点看 /api/asset-decision-timeline 是否仍只读、creator/writer 是否只看到自己范围内的 explicit source binding、dirty persisted binding 是否会泄漏 sourceExcerpts。

请输出：1）P0/P1/P2/P3；2）权限和审计边界是否安全；3）是否可以合并回 main；4）进入下一阶段 bind_source/remove_source_binding 前必须补的产品/权限测试。
```

02 read-only review prompt:

```text
你是 02 工程/测试复审分支，基线为 codex/script-source-binding-service 的 HEAD a3e417d。只读复审，不要改文件、不要 stage、不要 commit、不要 push。

任务：复审 ScriptSourceBinding service 只读透传的工程质量。重点看 projection dirty-binding defense、service.ts 透传 state.scriptSourceBindings ?? []、service/route tests 是否覆盖足够，以及是否有高冲突文件或回归风险。

请输出：1）P0/P1/P2/P3；2）测试覆盖是否足够；3）是否适合 fast-forward merge 回 main；4）下一阶段 source-binding mutation 的低冲突提交序列。
```

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
- Local `main` is ahead of remote; do not push unless the user explicitly asks.
- Latest local implementation commit before this ledger-only update: `aff5803 Scope asset lock records to workspace session`.
- `codex/asset-lock-workbench` has been fast-forward merged into `main`.
- `codex/asset-decision-timeline` has been fast-forward merged into `main`.

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
- Asset decision timeline static prototype in the main project flow.
- Role-scoped asset timeline mock view model with creator assigned-episode scope, previous-version ghost clips, decision queues, aggregation, detail drawer, and visual acceptance fixes.
- Real read-only `/api/asset-decision-timeline` projection wired into the UI with mock fallback.
- Session-scoped `/api/asset-lock-records` reads and writes: actor identity comes from `WorkspaceState.currentUserId`, and creator/writer reads are episode-assignment scoped.

Latest main verification:

```powershell
npm.cmd run verify
```

## Asset Lock Session Scope Main Merge

Timestamp: `2026-05-25 01:17:07 +08:00`.

Baseline:

- Previous `main`: `64ffe73 Record asset timeline main merge`.
- Implementation branch: `codex/asset-lock-session-scope`.
- Merged commit: `aff5803 Scope asset lock records to workspace session`.

Actions completed:

- Fast-forward merged `codex/asset-lock-session-scope` into `main`.
- Kept `/api/asset-decision-timeline` read-only; no timeline mutation route was added.
- Confirmed `/api/asset-lock-records` now derives actor identity from `WorkspaceState.currentUserId` instead of client-supplied user id fields.
- Confirmed `/api/asset-lock-records` GET is scoped by server session role and episode assignments for creator/writer views.
- Left next domain work out of this merge: no `AssetDecision`, no `AssetStateSegment`, no `ScriptSourceBinding` yet.

Post-merge verification:

- `npm.cmd run verify` passed on `main`.
- Web tests passed: 20 files / 146 tests.
- Domain tests passed: 5 files / 47 tests.
- Next production build passed, including dynamic routes `/api/asset-decision-timeline`, `/api/asset-lock-records`, and `/api/workspace-session`.

Next recommended work:

- Start a new small branch for source traceability design and tests.
- First target should be a minimal `ScriptSourceBinding` plan around `AssetLockRecord`, `DeliveryPackageEpisode`, and confirmed package content.
- Keep timeline tracks, clips, queues, ghost comparison, and drawer state as projection/UI.
- Continue to reject client-provided identity/scope fields in write APIs.

Passed after fast-forward merging `codex/asset-decision-timeline` into `main`:

- web: 14 test files / 108 tests passed.
- domain: 5 test files / 47 tests passed.
- `next build` passed.

## Active Feature Branch

- Branch: `codex/script-source-binding-service`.
- Created from local `main` at `614eb15`.
- Purpose: complete read-only service plumbing for `state.scriptSourceBindings ?? []` and harden dirty-binding projection filtering.
- Last completed branch: `codex/script-source-binding-plan`, merged at `5f93cae`.
- Do not push unless the user explicitly asks.

## Script Source Binding Planning

Started on branch `codex/script-source-binding-plan`.
Fast-forward merged into `main` at `5f93cae` on `2026-05-25 02:03:09 +08:00`.

Scope:

- Add `docs/script-source-binding.md` first.
- Keep `/api/asset-decision-timeline` read-only.
- Keep timeline tracks, clips, queues, ghost comparison, and drawer state as projection/UI.
- Do not add `AssetDecision` or `AssetStateSegment`.
- Do not persist source bindings until the minimal field contract, permissions, and tests are accepted.

Next implementation sequence after documentation review:

1. Add domain-only `ScriptSourceBinding` helper and tests. Done on this branch after 01/02 review.
2. Let timeline projection consume explicit bindings while preserving asset-name fallback. Done on this branch.
3. Add read-only service plumbing for optional legacy-safe workspace bindings. Done on `codex/script-source-binding-service` and merged into `main`.
4. Only then consider narrow `asset-lock-records` actions for bind/remove source.

01/02 review decisions applied:

- Removed `source: "manual" | "extracted"` from the v1 binding shape.
- Clarified project roles vs `EpisodeAssignment.responsibility`.
- Locked asset records should reject source binding create/remove.
- First code step must not touch `store.ts`, `asset-lock-records` API, timeline projection, dashboard, or CSS.

Verification after domain helper step:

- `npm.cmd run test -w packages/domain -- script-source-binding` passed: 1 file / 9 tests.
- `npm.cmd run test -w packages/domain` passed: 6 files / 56 tests.
- `npm.cmd run typecheck --workspaces --if-present` passed.

Verification after projection binding step:

- Domain snapshot fix: `npm.cmd run test -w packages/domain -- script-source-binding` passed: 1 file / 11 tests.
- Domain snapshot fix: `npm.cmd run typecheck -w packages/domain` passed.
- Projection binding: `npm.cmd run test -w apps/web -- asset-decision-timeline` passed: 6 files / 41 tests.
- Projection binding: `npm.cmd run typecheck -w apps/web` passed.
- Pre-merge verification: `npm.cmd run verify` passed on `codex/script-source-binding-plan`.

Verification after service read-only plumbing step:

- Projection dirty-binding defense: `filterVisibleScriptSourceBindings` now requires `binding.episodeNo` to be included in the target `AssetLockRecord.episodeNos`.
- `/api/asset-decision-timeline` service now passes `state.scriptSourceBindings ?? []` into the projection.
- Route remains read-only and still ignores client-provided `viewerRole`, `viewerUserId`, and `assignedEpisodeNos`.
- 03 product/permission read-only review:可合并，无 P0/P1/P2/P3；confirmed route is GET-only/read-only and mutation must later reject client-controlled identity/scope.
- 04 engineering/test read-only review:可合并，无 P0/P1/P2；P3 only noted the handoff snapshot HEAD mismatch, now corrected in this ledger.
- Fast-forward merged `codex/script-source-binding-service` into `main` at `9491ee6 Add API switch handoff snapshot`.
- `npm.cmd run test -w apps/web -- asset-decision-timeline` passed: 6 files / 47 tests.
- `npm.cmd run typecheck -w apps/web` passed.
- `npm.cmd run verify` passed:
  - web: 20 files / 154 tests.
  - domain: 6 files / 58 tests.
  - Next production build passed.
- Post-merge `npm.cmd run verify` passed on `main`:
  - web: 20 files / 154 tests.
  - domain: 6 files / 58 tests.
  - Next production build passed with `/api/asset-decision-timeline`, `/api/asset-lock-records`, `/api/asset-lock-attachments`, `/api/delivery-import-jobs`, `/api/delivery-packages`, and `/api/workspace-session`.

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

- Asset-lock-record actor identity is now server-session scoped; the remaining deployment risk is that this is still a prototype workspace session, not external auth.
- Real multi-user deployment still needs a separate auth/session phase.
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

Committed prototype work:

- `3667022 Document asset decision timeline stage`
- `c70d4c3 Refine asset timeline prototype scope`
- `a2270c6 Add asset decision timeline prototype`
- `50a3f46 Update ledger for asset timeline prototype`
- `24773e5 Refine asset decision timeline prototype`
- `1daa727 Harden asset lock record mutations`
- `a5c7d15 Update timeline handoff ledger`

Prototype files:

- `apps/web/app/ui/asset-decision-timeline-data.ts`
- `apps/web/app/ui/asset-decision-timeline-data.test.ts`
- `apps/web/app/ui/asset-decision-timeline.tsx`
- `apps/web/app/globals.css`
- `apps/web/app/ui/m1-dashboard.tsx`

Prototype behavior:

- Adds "资产轨道" entry.
- Uses local UI mock view model only.
- Shows a 10-episode work window with the creator assigned episodes highlighted inside it.
- Shows layered asset tracks, clips, ghost comparison markers, decision aggregation, left decision queue, and right detail drawer.
- Does not add API/domain persistence.

Current committed timeline refinement after 并行D review:

- Fixes ghost comparison rendering so previous-version ranges are lane-level grid items, not absolute children inside current clips.
- Makes decision aggregation selectable and uses the right detail drawer to explain the selected group.
- Adds current-version and previous-version summaries to the detail drawer.
- Keeps creator view scoped but prevents episode-window collapse by using the `6-15` work window and highlighting assigned `7-13`.
- Keeps creator-visible conflicts in the queue when they affect assigned episodes.
- Makes the right detail drawer overlay at narrower desktop widths to avoid squeezing the central track.
- Defaults creator view to "影响我的集" and coordinator/writer views to "今日必须确认".
- Reopens the right detail drawer when the user selects a decision queue.
- After replacement Branch A/B/C/D review, addressed first-pass acceptance fixes:
  - Creator project members can now enter asset timeline / asset lock workflows without granting delivery-center access.
  - Timeline uses dashboard-provided assigned episode numbers for creator scope when available.
  - Right detail drawer is closed by default and opens from queue/group/clip selection, reducing first-screen track obstruction.
  - Left queue now shows concrete decision items, not only category counts.
  - Empty status track is hidden in the rendered prototype.
  - Added a removed-asset sample and visible change-marker legend.
  - Detail drawer now includes asset facts, decision status/owner metadata, and lightweight communication records.
  - Layout CSS gives the center track priority, uses overlay detail at narrower desktop widths, and keeps mobile horizontal scroll inside the track board.
  - Added helper tests for assigned creator scope, project id projection, grid clipping, and removed-asset marker coverage.
- Second-round Branch A/B/C review on 2026-05-24:
  - Branch A: product flow is acceptable for a static readable prototype; no new product P1 code items, but browser role click-through is still needed before merge.
  - Branch B: remaining P1 is narrow/mobile horizontal scroll sync between the episode ruler and track board; overlay drawer obstruction at 1366px and ghost aria text can be improved later.
  - Branch C: remaining blocker-level risk is creator scope reliability: empty dashboard assignment must not create fake creator work, and creator-specific decisions must be filtered by `viewerUserId`.
  - Branch D architecture guidance still stands: keep the timeline view model in the UI mock layer; do not expand into domain/API yet.
- Follow-up fixes after second-round review:
  - Episode ruler and track rows now share one horizontal scroll container so narrow/mobile scrolling keeps episode numbers aligned with clips.
  - Creator scope keeps demo fallback only when `assignedEpisodeNos` is omitted by the standalone prototype; an explicit empty assignment from M1 creates no assigned window and no fake creator queue.
  - Creator queue now filters user-assigned items by `assignedToUserId`, while still allowing unassigned/writer/coordinator items that affect the creator's episodes.
  - Added tests for empty creator assignments, cross-creator decision leakage, invalid clip/window grid bounds, and empty episode windows.
- Verification after second-round follow-up:
  - `npm.cmd run test -w apps/web -- asset-decision-timeline m1-dashboard` passed: 2 files / 20 tests.
  - `npm.cmd run typecheck -w apps/web` passed.
  - `npm.cmd run verify` passed: web 13 files / 106 tests, domain 5 files / 47 tests, Next build passed.
  - Browser plugin control was not available in this thread; visual click-through is still required before merge.
- Targeted verification passed before full verify:
  - `npm.cmd run typecheck -w apps/web`
  - `npm.cmd run test -w apps/web -- asset-decision-timeline`
  - `npm.cmd run test -w apps/web` passed with 13 test files / 101 tests.
- Full verification passed:
  - `npm.cmd run verify`
  - web tests: 13 test files / 104 tests passed.
  - domain tests: 5 test files / 47 tests passed.
  - Next build passed without Turbopack/NFT warnings.
  - `http://localhost:3000` returned 200 locally.
- Browser acceptance status:
  - Dev server is reachable at `http://localhost:3000`.
  - `http://127.0.0.1:3000` also returns 200, but Next dev warns about HMR cross-origin access unless `allowedDevOrigins` is configured.
  - Current thread could not access the in-app Browser node runtime, so only HTTP/static/source-level validation has been performed so far.
  - Visual click-through acceptance is still needed before merge.

Asset lock mutation hardening added on top of the timeline branch:

- Reject duplicate asset lock names within the same delivery package after whitespace/case normalization.
- Reject writer confirm, production confirm, needs-info, dispute, or repeat final-lock mutations after an asset record is locked.
- Return both writer and production confirmations to `returned` when a confirmed record is marked needs-info or disputed again.
- Disable locked records in the asset lock UI and map locked-record errors to user-facing copy.

## Sub-Conversation Status

### 并行A

- Completed coordinator role UI rework.
- Completed member role vs episode assignment model rework.
- Completed asset lock domain model implementation.
- Completed conservative asset candidate extraction domain helper.
- Completed asset attachment domain metadata.
- Completed first-pass view model review for asset decision timeline.
- Conclusion: first version should define the timeline model in UI mock layer, not domain/API.
- Suggested location: `apps/web/app/ui/asset-decision-timeline-data.ts`.
- Future downshift target after validation: `packages/domain/src/types.ts`.
- Minimal model should cover: asset timeline view mode, track kind, decision kind/status, creator assigned episode window, script source excerpt, asset state segment, previous-version ghost comparison, timeline clip, timeline track, decision item, role-scoped view model.
- Status: available for next task.

### 并行B

- Completed test reviews for Word persistence and import retry.
- Completed asset lock API/workflow review.
- Completed attachment design review.
- Completed final asset lock merge review; conclusion was "needs minor fixes", now addressed.
- Completed first-pass scope review for asset decision timeline.
- Conclusion: first version must be cut down to a static readable prototype plus a minimal view model.
- Required first version: 10-15 episode horizontal track, asset clips/segments, simple right detail panel, static decision aggregation, static left queue filters, 1-2 ghost comparison examples, local mock data.
- Do not include in first version: real API/domain persistence, AI parsing, real diff algorithm, complex permissions, drag editing, real task dispatch, full production management flow.
- Recommended sequence: define minimal view model, build static UI prototype, add pure function tests, add light component tests, then run manual readability验收.
- Status: available for next review.

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
- Completed first-pass UI/interaction review for asset decision timeline.
- Conclusion: static prototype is the right first step; success depends on the horizontal track being the clear first visual center.
- Recommended layout: compact top controls, narrow left decision queue, dominant middle timeline, right detail as drawer/overlay rather than equal-width permanent panel.
- Must validate first: 10-15 episode work window, ghost clip readability, decision aggregation, queue-to-timeline focus, detail open/close behavior, creator-scoped default view.
- Avoid: equal-weight three-column layout, ghost clips competing with current clips, quantity-only aggregation, creator seeing full-series asset wall by default.
- Status: available for next UI review.

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
- Do not expand asset decision timeline into real database work yet.
- Do not start real session/auth unless explicitly chosen as a phase.
- Do not build AI automatic asset parsing yet.
- Do not let multiple sub-conversations edit the same high-conflict files at the same time.
- Avoid broad rewrites of `m1-dashboard.tsx`; the next stage should be field mapping and state-machine design before code-heavy UI/API changes.

## Replacement Sub-Conversation Plan

The previous sub-conversations are no longer available. If parallel review is needed, reopen only these four:

- Branch A: product acceptance for the asset decision timeline, including creator/writer/coordinator flow and must-fix vs deferrable issues. Returned twice: static prototype now meets the lower bound; no new product P1 after first-pass fixes. Still requires browser role click-through before merge.
- Branch B: UI and interaction acceptance, focused on horizontal timeline dominance, ghost clip readability, decision aggregation, drawer behavior, and narrow viewport risks. Returned twice: first-pass layout/drawer issues were improved; second-round P1 ruler/board scroll sync is now fixed in main. Drawer overlay at 1366px and ghost aria text remain deferrable.
- Branch C: code and test review for `asset-decision-timeline-data.ts`, its tests, the timeline component, and the `m1-dashboard.tsx` entry point. Returned twice: creator entry is fixed; second-round creator empty-assignment fallback and cross-creator assigned-decision leakage are now fixed with tests.
- Branch D: architecture boundary review for whether/when timeline fields should move from UI mock data into domain/API. Returned: do not move the whole timeline into domain/API yet; keep view model in UI mock until UI/product validation passes.

Sub-conversations should not commit or push. Main conversation owns branch rhythm, integration, verification, and merge decisions.

## Next Parallel Acceptance Batch

Use commit `50df2f1 Tighten asset timeline creator scope and scrolling` as the review baseline on branch `codex/asset-decision-timeline`.

Conflict-control rule:

- Branch A/B/C/D are read-only review branches for the next batch.
- They must not edit, stage, commit, push, rebase, or merge.
- Main conversation performs any code/docs changes after collecting reports.
- If a sub-conversation finds a P0/P1 issue, it reports file/line references and a recommended minimal fix, but does not apply it.

Branch A prompt:

```text
你是分支 A，只做只读产品流程验收。请切到/确认当前分支为 codex/asset-decision-timeline，基线提交为 50df2f1。不要改文件、不要提交、不要 push。

任务：复审资产决策剪辑轨道是否已经达到“首版静态可读原型”的合并下限。重点检查 creator / writer / coordinator 三类角色流程：左侧队列是否能落到具体决策项，点击后是否能聚焦轨道与详情；详情是否足够支持静态流程讨论；全剧视角/剧本 diff 等未完成项是否可以后置。

请输出：1）是否阻塞合并；2）P0/P1/P2 问题列表；3）可后置事项；4）建议主对话下一步。只读检查即可，最多运行相关测试，不要修改代码。
```

Branch B prompt:

```text
你是分支 B，只做只读 UI/交互/视觉验收。请切到/确认当前分支为 codex/asset-decision-timeline，基线提交为 50df2f1。不要改文件、不要提交、不要 push。

任务：重点验收资产决策剪辑轨道的视觉可读性和交互。请尽量用浏览器查看 http://localhost:3000 的资产轨道入口，覆盖 1440x900、1366x768、760x900、390x844。重点看：时间尺与轨道横向滚动是否同步；轨道是否仍是第一视觉中心；点击队列/聚合/clip 后详情抽屉是否遮挡到不可接受；ghost/删除/变化 marker 是否可读；移动端是否整页横向溢出。

请输出：1）是否有合并阻塞级视觉问题；2）按 P1/P2/P3 排序的问题；3）每个问题给出文件/大致位置和最小修复建议；4）已确认通过的视口/操作。只读，不要修改代码。
```

Branch C prompt:

```text
你是分支 C，只做只读代码与测试复审。请切到/确认当前分支为 codex/asset-decision-timeline，基线提交为 50df2f1。不要改文件、不要提交、不要 push。

任务：复审本轮 creator scope 与滚动容器改动的正确性。重点文件：apps/web/app/ui/asset-decision-timeline-data.ts、asset-decision-timeline-data.test.ts、asset-decision-timeline.tsx、apps/web/app/globals.css、m1-dashboard.tsx。检查空 assignedEpisodeNos、creator B 不应看到 creator A 指派决策、viewerUserId 过滤、默认 selectedClipId、角色/项目切换后的 React state 是否可能不同步、测试是否覆盖关键边界。

请运行：npm.cmd run test -w apps/web -- asset-decision-timeline m1-dashboard；可再运行 npm.cmd run typecheck -w apps/web。请输出：1）是否阻塞合并；2）具体 bug/测试缺口；3）建议主对话最小修复范围。只读，不要修改代码。
```

Branch D prompt:

```text
你是分支 D，只做只读架构与合并准备复审。请切到/确认当前分支为 codex/asset-decision-timeline，基线提交为 50df2f1。不要改文件、不要提交、不要 push。

任务：判断资产决策剪辑轨道当前是否仍应停留在 UI mock 层，以及是否具备合并到 main 的工程条件。重点检查：是否误引入 domain/API 扩张；mock 字段是否仍可解释为 UI view model；与现有 asset-lock 领域/API 是否存在边界混淆；ledger 是否足够支持上下文恢复；合并前还需要哪些验证命令。

请输出：1）是否建议现在进入 domain/API；2）是否建议合并前继续修代码；3）合并策略建议；4）合并后下一阶段最合理任务。只读，不要修改代码。
```

## 2026-05-24 Final Acceptance Follow-Up

Branch A/B/C/D returned on top of `3c44892`:

- Branch A: no product-flow P0/P1; static readable prototype is acceptable for the first-version lower bound. P2 items are ordinary writer scope wording, zero-count queue behavior, and removed asset not entering aggregation.
- Branch B: found one visual P1: `390x844` still had full-page horizontal overflow (`documentElement.scrollWidth=613`, `clientWidth=390`). Also noted 1366px drawer overlay can cover the selected clip after click.
- Branch C: found two UI correctness blockers: empty creator scope data was correct but rendered clips did not consume `isDimmedByRoleScope`, and local React state could persist across actor/project/assignment changes.
- Branch D: no architecture blocker; do not move timeline into domain/API before product/UI validation. Fast-forward merge is preferred after final verification and visual click-through.

Main-conversation fixes after these reports:

- `AssetDecisionTimelinePrototype` now resets effective queue/selected clip/group/drawer state when project, actor, assignment scope, default queue, or view-model selected clip changes.
- The render path now guards against stale state during the render immediately after scope changes, so an empty creator scope cannot briefly show an old open drawer.
- Clip class generation now consumes `clip.isDimmedByRoleScope`, adding a scoped muted visual state for empty/out-of-scope creator timelines.
- Zero-count queue filters are disabled and the queue list renders an empty state instead of opening a stale detail panel.
- Ordinary writer/non-full-series roles now show `当前工作窗口` instead of creator-specific `只看影响我的集`.
- At `max-width: 1366px`, the detail drawer is now a static full-width second row instead of an absolute overlay over the timeline.
- At `max-width: 760px`, shell/grid/stage/drawer widths are constrained and the wide timeline is contained in `.decision-track-scroll`; mobile second marker chips are hidden to reduce narrow clip crowding.
- Branch B rechecked `e813e77` and still found the `390x844` full-page overflow P1: `documentElement.scrollWidth=613`, `clientWidth=375`, with the shell measuring about `577px`; track-internal scrolling remained synchronized.
- Follow-up mobile overflow fix: at `max-width: 760px`, the asset/timeline shell and track stage now use `contain: inline-size` plus `overflow-x: hidden`, the timeline scroll container switches to block-level inline-size containment, and the wide ruler/track rows use a fixed internal scroll width so they cannot contribute to page-level intrinsic width.
- Branch B rechecked `4ee43f8` and still found page-level `390x844` overflow at `documentElement.scrollWidth=613`, `clientWidth=375`; track-internal scrolling remained synchronized.
- Second follow-up mobile overflow fix: at `max-width: 760px`, root and dashboard ancestors (`html`, `body`, `.replica-shell`, `.replica-main`, `.replica-grid`, `.module-panel`, `.panel`) now clamp horizontal overflow so the timeline's internal scroll width cannot bubble up to the document.
- Added `asset-decision-timeline-view.ts` for JSX-free UI helper tests and `asset-decision-timeline.test.ts` covering scoped muted class generation and reset-key changes.

Verification after fixes:

- `npm.cmd run test -w apps/web -- asset-decision-timeline m1-dashboard` passed: 3 files / 22 tests.
- `npm.cmd run typecheck -w apps/web` passed.
- `npm.cmd run verify` passed before and after both follow-up mobile overflow fixes: web 14 files / 108 tests, domain 5 files / 47 tests, Next build passed.
- `http://localhost:3000` returned 200.
- Branch B rechecked `8bd353d`: `390x844` passed with `documentElement.scrollWidth=375` and `clientWidth=375`; `.decision-track-scroll` remained synchronized (`scrollLeft 0 -> 54`, ruler and track both moved `-54px`). Branch B returned "无剩余 P1，可进入合并准备".
- `codex/asset-decision-timeline` was fast-forward merged into `main` at `0f00d3f`; final `npm.cmd run verify` passed on `main`.

## Recovery Steps After Context Compression

Run:

```powershell
git status --short --branch
git log --oneline --decorate --graph --all -12
Get-Content docs/project-control-ledger.md -Raw
Get-Content docs/asset-decision-timeline.md -Raw
```

Then:

- If current branch is `main`, continue post-merge planning from the latest `main`.
- If current branch is `codex/asset-decision-timeline`, switch back to `main` before starting new work unless the user explicitly wants to inspect the old feature branch.
- Before committing any implementation stage, run targeted tests.
- Before merge decisions, run:

```powershell
npm.cmd run verify
```

## Immediate Next Decision

Review the field-map design before any implementation.

Recommended first actions:

1. Review `docs/asset-timeline-field-map.md`.
2. If accepted, keep the next implementation branch focused on pure projection helpers and tests.
3. Do not add real timeline mutations yet.
4. Keep existing UI mock working while projection helpers are developed.
5. Run full verification before any branch merge.

## 2026-05-24 Post-Merge Planning Review

Branch A/B/C/D returned on `main` at `2b665a3`:

- Branch A: next product target should turn the static timeline into a real decision workbench based on published packages, asset lock records, and assignments. It recommends realizing asset state segments, script source bindings, lightweight discussion entries, and possibly decision lifecycle fields only when due/assignee/acknowledgement become real scope.
- Branch B: mapped existing mock fields. Tracks, clips, queues, selection, grouping, ghost marker summaries, permissions, and layout remain UI/projection. Existing domain sources are `AssetLockRecord`, `DeliveryPackage/EpisodeRevision`, and `EpisodeAssignment`.
- Branch C: recommends no new persistent domain type yet. Next technical step should be a minimal read-only projection API after projection helpers are proven; existing asset-lock mutations should continue handling confirm, needs-info, dispute, and final-lock transitions.
- Branch D: recommends one writable branch only, `codex/asset-timeline-field-map`; first commit should be documentation, then pure tests/helpers, and UI/API wiring last.

Main-conversation action:

- Created branch `codex/asset-timeline-field-map` from `main`.
- Added `docs/asset-timeline-field-map.md` with field source mapping, non-goals, candidate future business objects, read-only projection API boundary, permission rules, minimum test plan, and commit sequence.
- Added pure projection helpers in `apps/web/app/ui/asset-decision-timeline-projection.ts` without changing UI components or APIs.
- Added `asset-decision-timeline-projection.test.ts` covering assignment-derived creator windows, source excerpts from package episode lines, asset-lock status to decision mapping, creator-scoped projection, and empty-assignment downgrade.
- Targeted verification for this helper stage:
  - `npm.cmd run test -w apps/web -- asset-decision-timeline` passed: 3 files / 16 tests.
  - `npm.cmd run typecheck -w apps/web` passed.
- Hardened projection helpers with package-scoped episode-window filtering and previous-version ghost comparison coverage.
- Follow-up verification for the projection hardening step:
  - `npm.cmd run test -w apps/web -- asset-decision-timeline` passed: 3 files / 18 tests.
  - `npm.cmd run typecheck -w apps/web` passed.

Branch A/B/C/D read-only review of `2961717`:

- Branch A: no product P0/P1 in the helper direction, but ordinary `writer` versus `head_writer` visibility needed a product decision before API work.
- Branch B: main data risks were creator projection leaking non-assigned clips, previous records matching across project/package boundaries, and creator assignment scope accepting non-creator responsibilities.
- Branch C: asked for tests around current record filtering, previous record filtering, and stronger creator scope before any API route.
- Branch D: recommended not adding `GET /api/asset-decision-timeline` yet; continue helper/test hardening and avoid route-to-UI coupling.

Main-conversation action after the review:

- Adopted conservative visibility: `owner`/`coordinator`/`head_writer` see the full projection; ordinary `writer` is scoped to `writer` episode assignments; `creator` is scoped to `creator`/`lead_creator` assignments.
- Changed creator/writer scoped projections to filter clips/tracks/decisions/source excerpts instead of returning non-scope clips as dimmed data.
- Added previous-record filtering by `projectId` and by explicit `previousDeliveryPackageId` when provided; otherwise current-package records are ignored as previous records.
- Added tests for creator strict scope, empty creator scope, ordinary writer scope versus head-writer full visibility, current record project/package filtering, and previous ghost filtering.
- Verification after this hardening step:
  - `npm.cmd run test -w apps/web -- asset-decision-timeline` passed: 3 files / 21 tests.
  - `npm.cmd run typecheck -w apps/web` passed.

Remaining before API route:

- Do not add timeline mutations; keep using `asset-lock-records` transitions.
- Before a real route, move or wrap projection logic in an API/service-safe layer instead of importing UI directly from a route.
- `source_changed` still needs a real source-binding or previous/current source comparison design; do not fake it from `changeType`.

Main-conversation service-boundary action:

- Moved projection helper/test out of `apps/web/app/ui` into `apps/web/app/asset-decision-timeline/projection.ts` and `projection.test.ts`; it still returns the existing UI view-model DTO, but the helper itself is no longer located under UI.
- Added `apps/web/app/api/asset-decision-timeline/service.ts` as a read-only service selector. It reads through `readDeliveryImportWorkspace`, derives `viewerUserId` from `WorkspaceState.currentUserId`, checks project membership, checks current/previous package project and published status, and then builds the role-scoped projection.
- Added `apps/web/app/api/asset-decision-timeline/service.test.ts` covering current member projection, unauthenticated user, non-member, wrong-project package, unpublished current/previous package, and creator assigned-episode isolation.
- No `GET /api/asset-decision-timeline` route was added yet, and no mutation API was added.
- Verification after service-boundary step:
  - `npm.cmd run test -w apps/web -- asset-decision-timeline` passed: 4 files / 25 tests.
  - `npm.cmd run typecheck -w apps/web` passed.

Next main-conversation work:

- Do not wire UI yet.
- Next low-conflict step is route-level tests plus a minimal GET route only if service-boundary review passes.
- Any route must accept only `projectId`, `deliveryPackageId`, and optional `previousDeliveryPackageId`; it must not accept `viewerUserId`, `viewerRole`, or `assignedEpisodeNos`.

Main-conversation route action:

- Added `apps/web/app/api/asset-decision-timeline/route.ts` with a minimal read-only `GET` route.
- The route accepts only `projectId`, `deliveryPackageId`, and optional `previousDeliveryPackageId`; client-supplied `viewerUserId`, `viewerRole`, and `assignedEpisodeNos` are ignored because service identity comes from `WorkspaceState.currentUserId`.
- Added `apps/web/app/api/asset-decision-timeline/route.test.ts` covering missing query params, successful projection response, ignored client-controlled identity/scope fields, unauthenticated status `401`, and missing package status `404`.
- No route-level `POST` or timeline mutation was added.
- Verification after route step:
  - `npm.cmd run test -w apps/web -- asset-decision-timeline` passed: 5 files / 29 tests.
  - `npm.cmd run typecheck -w apps/web` passed.
  - `git diff --check` passed.

Next main-conversation work:

- Ask Branch A/B/C/D for read-only review of the new route/service boundary before wiring UI.
- If the route review passes, the next implementation step should be UI integration in a separate commit with a demo fallback.
- If review finds route/service P1 issues, fix those before touching `asset-decision-timeline.tsx`, `globals.css`, or `m1-dashboard.tsx`.

Branch A/B/C/D read-only review of `1c237d9`:

- Branch A: route/service direction is correct, but UI wiring should wait until previous-package ghost behavior and multi-role `viewerRole` selection are deterministic.
- Branch B: main P1 was previous records matching arbitrary non-current packages when `previousDeliveryPackageId` is omitted; source excerpts also needed a confirmed/revision-backed constraint.
- Branch C: requested tests for previous package behavior, stable role selection, broader route status mapping, writer scope, and empty/source edge cases.
- Branch D: UI wiring can be planned as a separate step after API boundary fixes; it should be minimal, preserve mock fallback, avoid CSS, and avoid timeline mutations.

Main-conversation API-boundary hardening:

- Changed projection behavior so previous ghost comparison is generated only when an explicit `previousDeliveryPackageId` is provided.
- Changed service role selection to use domain `selectPrimaryRole` after confirming the viewer is a project member, avoiding array-order role selection.
- Added service validation that an explicit previous package must be same project, published, and published before the current package.
- Restricted projection source excerpt input to confirmed package episodes via `DeliveryPackageEpisode.isConfirmedChange`.
- Added/updated tests for multi-role primary role selection, no implicit previous ghost, explicit earlier previous package ghost, later previous package rejection, route error status matrix, and confirmed-only source excerpts.
- Verification after API-boundary hardening:
  - `npm.cmd run test -w apps/web -- asset-decision-timeline` passed: 5 files / 33 tests.
  - `npm.cmd run typecheck -w apps/web` passed.
  - `git diff --check` passed.

Next main-conversation work:

- Route/service P1s from A/B/C are addressed; the next low-conflict implementation step can be UI API client helper only.
- Do not wire the large timeline component and dashboard in the same commit as the helper.
- Keep `previousDeliveryPackageId` optional in UI and omit it at first; this means no ghost on real API projection until previous-package selection is designed.

Main-conversation UI client helper action:

- Added `apps/web/app/ui/asset-decision-timeline-api.ts` with `fetchAssetDecisionTimelineProjection` and fallback-oriented error formatting.
- Added `apps/web/app/ui/asset-decision-timeline-api.test.ts` covering query encoding, server-side error preservation, malformed response normalization, and fallback message formatting.
- No timeline component, dashboard, CSS, or mutation wiring was changed in this step.
- Verification after UI API helper step:
  - `npm.cmd run test -w apps/web -- asset-decision-timeline asset-decision-timeline-api` passed: 6 files / 37 tests.
  - `npm.cmd run typecheck -w apps/web` passed.
  - `git diff --check` passed.

Next main-conversation work:

- Next implementation step can be a small `asset-decision-timeline.tsx` integration that prefers API projection when `deliveryPackageId` is present and otherwise keeps mock fallback.
- Do not touch `m1-dashboard.tsx` until the component-level fetch/fallback behavior is tested.
- Do not pass `previousDeliveryPackageId` from UI yet.

Main-conversation component integration action:

- Updated `apps/web/app/ui/asset-decision-timeline.tsx` to accept optional `deliveryPackageId`.
- When `deliveryPackageId` is present, the component requests the read-only projection through `fetchAssetDecisionTimelineProjection`; successful responses replace the mock view model, while loading/failure/no package keeps the mock fallback.
- The component labels the source as real projection, loading, static prototype, or Demo fallback; no CSS, dashboard, navigation, or mutation wiring was changed.
- Updated `buildTimelineResetKey` to include a view-model source key so switching between mock/loading/real/fallback resets stale selection state.
- Added helper test coverage for source-key reset behavior.
- Verification after component integration:
  - `npm.cmd run test -w apps/web -- asset-decision-timeline asset-decision-timeline-api` passed: 6 files / 38 tests.
  - `npm.cmd run typecheck -w apps/web` passed.
  - `git diff --check` passed.

Next main-conversation work:

- Only after this commit should `m1-dashboard.tsx` pass a published `deliveryPackageId` into `AssetDecisionTimelinePrototype`.
- Keep the dashboard change to a single prop wiring; do not change CSS, navigation, permissions, or asset-lock mutations in that commit.

Main-conversation dashboard wiring action:

- Updated `apps/web/app/ui/m1-dashboard.tsx` so `AssetDecisionTimelinePrototype` receives `deliveryPackageId` only when the active delivery package is `published`.
- This is a prop-only wiring step: no CSS, navigation, permissions, package selection policy, asset-lock mutation, or timeline mutation changes.
- Because the UI still does not pass `previousDeliveryPackageId`, real API projections will show current package data without ghost comparison until previous-package selection is designed.
- Verification after dashboard wiring:
  - `npm.cmd run test -w apps/web -- asset-decision-timeline asset-decision-timeline-api m1-dashboard` passed: 7 files / 49 tests.
  - `npm.cmd run typecheck -w apps/web` passed.
  - `git diff --check` passed.

Next main-conversation work:

- Run full `npm.cmd run verify` before considering merge back to `main`.
- Ask Branch A/B/C/D for read-only review of the UI wiring and browser acceptance scope.
- Browser acceptance should cover asset timeline with no published package, with a published package, creator scope, writer/head_writer/coordinator scope, and fallback behavior when the API returns an error.

Full verification after route, API client, component, and dashboard wiring:

- `npm.cmd run verify` passed on `codex/asset-timeline-field-map`.
- Web typecheck passed.
- Domain typecheck passed.
- Web tests passed: 18 files / 135 tests.
- Domain tests passed: 5 files / 47 tests.
- Next production build passed and includes dynamic route `/api/asset-decision-timeline`.

Next main-conversation work:

- Do not merge yet without one read-only review batch and browser acceptance.
- Ask branches to review HEAD after the verify commit; keep sub-conversations read-only.
- Browser acceptance should happen after review or after any review-blocking fixes.

Branch A/B/C/D read-only review of `4750f96`:

- Branch A found one P1 product wiring risk: asset timeline used the active delivery package only, so if the active package was draft/pending while a published package existed, timeline could fall back to Demo instead of real projection.
- Branch B found no P0/P1 permission leak; noted Demo fallback and future source-binding limitations as non-blocking risks.
- Branch C reported `npm.cmd run verify` passed and found no blocker to browser acceptance.
- Branch D recommended browser acceptance but listed the same published-package and fallback scenarios as key checks.

Main-conversation package-selection fix:

- Added `selectAssetTimelineDeliveryPackageId` in `apps/web/app/ui/delivery-role-view.ts` to choose the latest published package independently of the active delivery package.
- Updated `m1-dashboard.tsx` so the asset timeline receives that latest published package id even when the active package for the delivery center is draft or pending.
- Added `m1-dashboard.test.ts` coverage proving coordinators can keep a pending active package while the asset timeline selects the latest published package.
- Verification after this fix:
  - `npm.cmd run test -w apps/web -- asset-decision-timeline asset-decision-timeline-api m1-dashboard` passed: 7 files / 50 tests.
  - `npm.cmd run typecheck -w apps/web` passed.
  - `git diff --check` passed.

Full verification after package-selection fix:

- Current branch: `codex/asset-timeline-field-map`.
- Current HEAD: `709c7bd Select published package for asset timeline`.
- `npm.cmd run verify` passed after the package-selection fix.
- Web typecheck passed.
- Domain typecheck passed.
- Web tests passed: 18 files / 136 tests.
- Domain tests passed: 5 files / 47 tests.
- Next production build passed and includes dynamic route `/api/asset-decision-timeline`.

Main-conversation workspace session fix:

- HTTP validation found that the real timeline route still returned `401 unauthenticated` in the running app because the M1 login flow only updated client/local workspace state while `/api/asset-decision-timeline` reads the server workspace `currentUserId`.
- Added `/api/workspace-session` as a small workspace-session sync endpoint for the local prototype. This is not a timeline mutation; timeline mutations remain out of scope.
- Added `syncWorkspaceCurrentUser` in the UI and gated the asset timeline's real projection request until the server workspace current user matches the local current user.
- HTTP validation after the fix:
  - `POST /api/workspace-session` with `user-owner` returned `200` and persisted `currentUserId=user-owner`.
  - `GET /api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=delivery-jc-3-4-qmk20g` returned `200`, `viewer=user-owner`, `role=coordinator`, `queue=6`, `tracks=5`.
- Verification after this fix:
  - `npm.cmd run test -w apps/web -- workspace-session asset-decision-timeline asset-decision-timeline-api m1-dashboard` passed: 9 files / 55 tests.
  - `npm.cmd run verify` passed.
  - Web tests passed: 20 files / 141 tests.
  - Domain tests passed: 5 files / 47 tests.
  - Next production build passed and includes dynamic routes `/api/asset-decision-timeline` and `/api/workspace-session`.

Next main-conversation work:

- Run browser acceptance for the asset timeline before merge preparation.
- If browser acceptance passes, update this ledger with browser results and consider merging `codex/asset-timeline-field-map` back to `main`.

Browser acceptance and final pre-merge hardening:

- Branch A browser acceptance reported no P0/P1 on the real asset timeline projection wiring:
  - `creator-a` login synchronized `/api/workspace-session`.
  - Asset timeline requested `/api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=delivery-jc-3-4-qmk20g`.
  - Query did not include `viewerUserId`, `viewerRole`, `assignedEpisodeNos`, or `previousDeliveryPackageId`.
  - `creator-a` and `writer` both showed real projection; `writer` could see real episode 3/4 clips.
  - `creator-b` could not see `creator-a` scoped assets; `head_writer` and `coordinator` could see full projection.
  - `1366x768`, `760x900`, and `390x844` had no page-level horizontal overflow; track ruler and clips scrolled in sync.
  - Queue, group, clip, and detail interactions were readable; account switching reset drawer/selected clip state.
- Branch B code review reported no P0/P1:
  - `sessionReady` gating and `serverDeliveryPackageIds` whitelist behavior were accepted.
  - Server workspace refresh maintains the whitelist; prototype reset clears it.
  - Writer episode-window fix did not break creator empty assignment, creator-B isolation, or head-writer full view.
- Main-conversation decision: skip the remaining P3-only integration test gap for now and proceed to merge preparation after final verification.
- Final verification before merge preparation:
  - Commit prepared: `a4442c6 Harden asset timeline real projection acceptance`.
  - `npm.cmd run verify` passed.
  - Web tests passed: 20 files / 144 tests.
  - Domain tests passed: 5 files / 47 tests.
  - Next production build passed with dynamic routes `/api/asset-decision-timeline` and `/api/workspace-session`.
- Main fast-forward merge:
  - `codex/asset-timeline-field-map` was fast-forward merged into `main`.
  - Merged HEAD on `main`: `d730d4b Record asset timeline merge readiness`.
  - Post-merge `npm.cmd run verify` passed on `main`.
  - Web tests passed: 20 files / 144 tests.
  - Domain tests passed: 5 files / 47 tests.
  - Next production build passed with dynamic routes `/api/asset-decision-timeline` and `/api/workspace-session`.

## Asset Lock Session Scope Hardening

Branch after main merge: `codex/asset-lock-session-scope`.

Read-only review inputs:

- Branch A confirmed the next product target should be a lightweight asset decision workbench with traceable source text and actionable status, while keeping timeline tracks/clips/queues as projection/UI.
- Branch B found the blocking API risk: `/api/asset-lock-records` still trusted client-supplied user ids and its GET returned project-wide records without creator/writer episode scoping.
- Branch C returned an outdated baseline (`codex/asset-timeline-field-map` at `4750f96`), so it was treated as stale context rather than current acceptance input.

Main-conversation implementation:

- `asset-lock-records` route parsing no longer requires `createdByUserId`, `confirmedByUserId`, `markedByUserId`, `lockedByUserId`, or `actorUserId`.
- `asset-lock-records` service now derives the actor from `WorkspaceState.currentUserId`.
- `asset-lock-records` GET now filters by server session role and episode assignments:
  - `owner` / `coordinator` / `head_writer`: full project records.
  - `writer`: records intersecting writer assignments.
  - `creator`: records intersecting creator / lead_creator assignments.
- Existing asset-lock mutations remain the only write path; no timeline mutation route was added.
- Frontend asset-lock calls no longer send user identity fields for create/confirm/needs-info/dispute/final-lock/prepare-demo.
- Tests now cover malicious client-supplied identity being ignored and creator scope filtering on asset-lock GET.

Verification so far:

- `npm.cmd run test -w apps/web -- asset-lock-records asset-decision-timeline asset-lock-attachments m1-dashboard` passed: 11 files / 93 tests.
- `npm.cmd run typecheck -w apps/web` passed.
- `npm.cmd run verify` passed.
- Web tests passed: 20 files / 146 tests.
- Domain tests passed: 5 files / 47 tests.
- Next production build passed with dynamic routes `/api/asset-decision-timeline`, `/api/asset-lock-records`, and `/api/workspace-session`.

## Next Post-Merge Parallel Batch

Use `main` at or after `0f00d3f Record final asset timeline visual pass` as the baseline. If this ledger has a newer commit, use the latest `main` commit. All sub-conversations are read-only unless the main conversation explicitly delegates implementation.

Conflict-control rule:

- Branch A/B/C/D are read-only planning/review branches.
- They must not edit, stage, commit, push, rebase, or merge.
- Main conversation owns any new branch, implementation, documentation edits, commits, and final merge decisions.
- The next phase is design/mapping first; do not write real timeline APIs yet.

Branch A prompt:

```text
你是分支 A，只做只读产品/业务对象复审。请确认当前基线为 main 最新提交（至少包含 0f00d3f 资产决策剪辑轨道合并）。不要改文件、不要 stage、不要提交、不要 push。

任务：基于现有资产决策剪辑轨道静态原型，判断哪些能力应该进入下一阶段，哪些仍应后置。重点回答：创作者、编剧、统筹在下一阶段最需要真实化的 3-5 个动作是什么；哪些只是 UI 展示；“决策项”“状态段”“沟通记录”“剧本来源绑定”哪些应成为业务对象，哪些暂时仍可派生。

请输出：1）下一阶段产品目标一句话；2）必须真实化的业务对象/动作；3）仍应保留 mock/UI 派生的内容；4）合并后下一阶段验收标准。只读，不要修改代码。
```

Branch B prompt:

```text
你是分支 B，只做只读数据来源映射复审。请确认当前基线为 main 最新提交（至少包含 0f00d3f 资产决策剪辑轨道合并）。不要改文件、不要 stage、不要提交、不要 push。

任务：逐项审查 apps/web/app/ui/asset-decision-timeline-data.ts 中的 mock 类型和字段，给出字段来源映射建议。每个字段归类为：AssetLockRecord 派生、DeliveryPackage/EpisodeRevision 派生、EpisodeAssignment 派生、纯 UI 派生、暂不应保留。重点识别哪些字段不能直接下沉 domain，哪些字段已经有 domain 来源。

请输出：1）字段映射表；2）可下沉 domain 的最小字段集；3）必须保持 UI 派生的字段；4）进入 API 前必须补的测试。只读，不要修改代码。
```

Branch C prompt:

```text
你是分支 C，只做只读 domain/API 边界复审。请确认当前基线为 main 最新提交（至少包含 0f00d3f 资产决策剪辑轨道合并）。不要改文件、不要 stage、不要提交、不要 push。

任务：检查 packages/domain/src/types.ts、store.ts、apps/web/app/api/asset-lock-records/service.ts，以及资产 timeline mock，判断下一阶段是否需要新增 domain 类型或 API。优先考虑复用 AssetLockRecord、DeliveryPackage、EpisodeRevision、EpisodeAssignment。不要提出大而全 API；只提出最小 projection / transition 方案。

请输出：1）是否需要新 domain 类型；2）是否需要只读 projection API；3）哪些 mutation 继续走现有 asset-lock API；4）权限/隔离风险；5）最小测试计划。只读，不要修改代码。
```

Branch D prompt:

```text
你是分支 D，只做只读工程计划/风险复审。请确认当前基线为 main 最新提交（至少包含 0f00d3f 资产决策剪辑轨道合并）。不要改文件、不要 stage、不要提交、不要 push。

任务：为下一阶段制定低冲突执行计划。重点看哪些文件高冲突、哪些文档应先写、哪些测试可以先落地，如何拆成主对话与子对话任务。请避免建议多个分支同时修改 asset-decision-timeline.tsx / globals.css / m1-dashboard.tsx。

请输出：1）推荐分支数量和每个分支职责；2）建议先改文档还是代码；3）最高风险文件；4）最小可提交序列；5）回滚/暂停条件。只读，不要修改代码。
```
