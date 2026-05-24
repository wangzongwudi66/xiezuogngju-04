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
- Current stage: static UI prototype committed and asset-lock mutation hardening cherry-picked onto the branch.
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
- Do not expand into real database work yet.
- Do not start real session/auth unless explicitly chosen as a phase.
- Do not build AI automatic asset parsing in the first timeline prototype.
- Do not let multiple sub-conversations edit the same high-conflict files at the same time.
- Avoid broad rewrites of `m1-dashboard.tsx` until the timeline prototype surface is chosen.

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
- In-app Browser control still lacks the required Node REPL tool in this thread, so Branch B should re-run the `390x844` page-level overflow measurement before merge.

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

Continue asset decision timeline acceptance after the final follow-up fixes.

Recommended first actions:

1. Re-run Branch B visual checks, especially `390x844` full-page overflow and `1366x768` drawer-open behavior.
2. If Branch B has no remaining P1, run final `npm.cmd run verify` if new changes were made after the last pass.
3. Keep timeline types in `apps/web/app/ui/asset-decision-timeline-data.ts` until product/UI validation is complete.
4. Do not add database, real auth/session, AI parsing, or new timeline APIs yet.
5. If visual acceptance passes, decide whether to merge `codex/asset-decision-timeline` into `main`.
