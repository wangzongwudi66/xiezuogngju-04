# Asset Timeline Field Map

This document records the post-merge planning baseline for formalizing the asset decision timeline.

The current timeline is a validated static UI prototype. The next stage should turn it into a real projection built from existing project data before adding any new timeline persistence or mutation API.

## Goal

Turn the asset decision timeline from UI mock data into a read-only, role-scoped projection based on:

- `AssetLockRecord`
- `DeliveryPackage`, `DeliveryPackageEpisode`, and `EpisodeRevision`
- `EpisodeAssignment`
- request/session role context

Do not move the full timeline view model into domain. Tracks, clips, queues, grid positions, selected state, and drawer state remain projection/UI concerns.

## Non-Goals

- No AI asset parsing in this stage.
- No production task dispatch system.
- No full comments/IM system.
- No arbitrary version diff UI.
- No broad rewrite of `asset-decision-timeline.tsx`, `globals.css`, or `m1-dashboard.tsx`.
- No API that simply returns the current mock data from the backend.

## Next Product Target

Support a real, read-only timeline projection first, then add the smallest set of transitions needed for manual confirmation, needs-info, disputes, source review, and final locking through the existing asset-lock workflow.

The first real path should prove:

- creators only see assets and decisions affecting their assigned episodes;
- head writers, coordinators, and owners can inspect the full project window;
- ordinary writers are scoped to their `writer` episode assignments until broader visibility is explicitly approved;
- the detail drawer uses real asset records, source excerpts, previous/current package comparison, and communication history placeholders or records;
- mock data remains available only as demo fallback.

## Field Source Map

| Current type / field | Source category | Mapping decision |
|---|---|---|
| `AssetTimelineViewMode` | UI projection | View/filter mode only. Do not persist. |
| `AssetTimelineTrackKind` | Domain + UI projection | `AssetType` comes from domain. `"status"` is a UI track concept for now. |
| `AssetDecisionStatus` | UI projection | Derive from `AssetLockRecord.status`, confirmations, missing-info, and dispute fields. Do not persist this enum yet. |
| `AssetDecisionKind` | UI projection | Derive from asset change type, status, confirmations, missing-info, dispute state, and previous/current comparison. |
| `AssetTimelineQueueTag` | UI projection | Derive from status, viewer role, assignments, and timestamps. `due_today` needs a real due date before persistence. |
| `CreatorAssignedEpisodeWindow.projectId/userId/sourceAssignmentIds` | `EpisodeAssignment` | Build from assignments joined with project episodes. |
| `CreatorAssignedEpisodeWindow.episodeNos` | `EpisodeAssignment` | Build from assigned episodes in the current project. |
| `CreatorAssignedEpisodeWindow.episodeFrom/episodeTo` | UI projection | Min/max of assigned episode numbers. |
| `ScriptSourceExcerpt.projectId/deliveryPackageId/episodeNo/title/excerpt/startLine/endLine` | `DeliveryPackageEpisode` / `EpisodeRevision` | Build from package/revision content and a line-range extractor. |
| `ScriptSourceExcerpt.relatedAssetNames` | Projection | Derive through asset-name/source matching. Do not persist as truth. |
| `AssetStateSegment.assetLockRecordId/assetName/assetType/episodeNos/changeType/risk` | `AssetLockRecord` | Existing domain source. |
| `AssetStateSegment.id` | Projection | Generate from source record/package/segment identity. |
| `AssetStateSegment.episodeFrom/episodeTo` | `AssetLockRecord` projection | Min/max from `episodeNos` until true state segments exist. |
| `AssetStateSegment.stateLabel` | Projection | Display label from notes, status, missing info, dispute, or future state segment text. |
| `AssetStateSegment.sourceExcerptIds` | Source binding projection | Derive from source excerpt matching until a real binding object exists. |
| `PreviousVersionGhostComparison.*` | Package/revision comparison projection | Previous package/revision is real; marker list and summary are generated comparison results. |
| `AssetTimelineClip.*` | UI projection | Clip is the visual expression of asset records/segments. Do not persist clips. |
| `AssetTimelineTrack.*` | UI projection | Track grouping, labels, order, and clip placement are view model output. |
| `AssetDecisionItem.projectId/assetLockRecordId/episodeNos/risk/createdAt/updatedAt` | `AssetLockRecord` | Existing record source. |
| `AssetDecisionItem.clipId/kind/status/title/description/queueTags/currentSummary/previousSummary` | Projection | Build from asset record, source excerpts, comparison, and role context. Do not persist initially. |
| `AssetDecisionItem.assignedToRole/assignedToUserId` | `EpisodeAssignment` + projection | Derive from viewer role, asset state, and assigned episodes. A future owner field can be added only after product validation. |
| `AssetDecisionGroupSummary.*` | UI projection | Pure aggregation over decision items. |
| `RoleScopedAssetTimelineViewModel.*` | API/view response | Response DTO, not domain entity. `selected*` remains client state. |

## Candidate Future Business Objects

These should not be added all at once. They are candidates once the read-only projection proves the workflow.

### Asset State Segment

Use only when `AssetLockRecord.episodeNos` is insufficient to represent one asset changing state across ranges.

Minimal candidate fields:

- `id`
- `projectId`
- `assetLockRecordId`
- `deliveryPackageId`
- `episodeFrom`
- `episodeTo`
- `stateLabel`
- `changeType`
- `risk`
- `sourceBindingIds`
- `createdByUserId`
- `updatedAt`

### Script Source Binding

Use when writers need stable, auditable source references instead of generated excerpts.

Minimal candidate fields:

- `id`
- `projectId`
- `assetLockRecordId`
- `assetStateSegmentId`
- `deliveryPackageId`
- `episodeNo`
- `episodeRevisionId`
- `startLine`
- `endLine`
- `excerptSnapshot`
- `createdByUserId`
- `createdAt`

### Asset Discussion Entry

Use for lightweight audit comments, not a general chat system.

Minimal candidate fields:

- `id`
- `projectId`
- `targetType`
- `targetId`
- `authorUserId`
- `authorRole`
- `kind`
- `body`
- `createdAt`

### Asset Decision

Do not add first. Prefer deriving decision state from `AssetLockRecord`. Add only if due date, explicit assignee, acknowledgement, return/reopen, or independent lifecycle becomes real product scope.

## Minimal Read-Only Projection API

If the next stage moves beyond documentation, start with a read-only projection:

```text
GET /api/asset-decision-timeline?projectId=...&deliveryPackageId=...
```

The server must derive viewer identity and role from the same trusted project context used elsewhere. Do not trust client-provided `assignedEpisodeNos`.

Projection inputs:

- asset lock records for the project/package;
- published/current package episodes and revisions;
- previous package or previous revisions for comparison;
- project episodes and assignments;
- viewer role and user id.

Projection outputs can resemble the current UI view model, but they should be treated as DTOs.

## Mutation Boundary

Continue using `/api/asset-lock-records` for:

- `generate_from_package`
- `create`
- `writer_confirm`
- `production_confirm`
- `needs_info`
- `dispute`
- `final_lock`

Do not add timeline-specific mutation routes until a real `AssetDecision`, `AssetStateSegment`, or `ScriptSourceBinding` lifecycle is approved.

## Permission Rules

- Creator scope must be computed from `EpisodeAssignment` on the server.
- Creator projection must not leak full package text or unrelated episode excerpts.
- Coordinator and owner can inspect full project timeline.
- Head writer can inspect full project timeline and writer-decision items.
- Ordinary writers are limited to episodes where they have `EpisodeAssignment.responsibility = "writer"` until broader access is explicitly approved.
- Every projection path must enforce `projectId`, `deliveryPackageId`, and record ownership consistency.

## Minimum Test Plan Before API Work

- creator with empty assignment returns no fake assigned window and no fake queue;
- creator B cannot see creator A-only assigned decisions;
- creator source excerpts are limited to assigned episodes;
- coordinator/head writer get full project projection;
- mismatched `projectId` and `deliveryPackageId` rejects or returns empty;
- `AssetLockRecord.status` and confirmations map consistently to decision kind/status/tags;
- current vs previous comparison covers new, removed, range changed, status changed, and source changed;
- projection route is read-only and does not mutate workspace;
- missing previous revision, missing source excerpt, and missing assignment degrade without crashes.

## Recommended Commit Sequence

1. Document field map and state-boundary decisions.
2. Add pure projection tests using mock domain-like inputs.
3. Implement projection helper functions without changing UI routing.
4. Add an API/service-safe selector that reads from `WorkspaceState`, enforces project/package/member boundaries, and calls the projection helper without exposing a route yet.
5. Add a read-only API route only if service tests cover unauthenticated, non-member, project/package mismatch, published-package, and role-scope cases.
6. Wire UI to projection last, in a separate commit.

Run at least:

```powershell
npm.cmd run test -w apps/web -- asset-decision-timeline
npm.cmd run typecheck -w apps/web
```

Run full verification before merging any API/domain work:

```powershell
npm.cmd run verify
```
