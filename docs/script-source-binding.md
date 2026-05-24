# Script Source Binding Plan

This document defines the next small step after the real asset decision timeline projection.

The goal is to make script source excerpts auditable without turning the timeline itself into a workflow domain model.

## Goal

Add a minimal `ScriptSourceBinding` concept around `AssetLockRecord` so an asset decision can point to a stable script line range from a published delivery package.

This should support:

- showing source excerpts in the asset timeline from explicit bindings first;
- preserving a reviewable line range and excerpt snapshot for audit;
- keeping creator/writer/coordinator visibility scoped by server-side roles and episode assignments;
- refreshing the existing read-only timeline projection after asset-lock actions.

## Non-Goals

- No timeline mutation route.
- No persisted timeline tracks, clips, queues, ghost clips, drawer state, or grid layout.
- No `AssetDecision` domain object yet.
- No `AssetStateSegment` domain object yet.
- No full script diff workbench.
- No AI parsing or fuzzy extraction as a source of truth.
- No chat or IM system.
- No due date, multi-owner task dispatch, acknowledgement, reopen, or calendar workflow.

## Minimal Domain Shape

Candidate type:

```ts
export interface ScriptSourceBinding {
  id: string;
  projectId: string;
  deliveryPackageId: string;
  assetLockRecordId: string;
  episodeNo: number;
  startLine: number;
  endLine: number;
  excerptSnapshot: string;
  createdByUserId: string;
  createdAt: string;
}
```

Candidate input:

```ts
export interface ScriptSourceBindingInput {
  projectId: string;
  deliveryPackageId: string;
  assetLockRecordId: string;
  episodeNo: number;
  startLine: number;
  endLine: number;
  createdByUserId: string;
}
```

Notes:

- `excerptSnapshot` is generated from package content at bind time, not accepted from the client.
- `createdByUserId` should be injected by the server service from `WorkspaceState.currentUserId`, not trusted from a route body.
- `episodeRevisionId` can be added later if the binding must attach to a specific revision row. For the first pass, `deliveryPackageId + episodeNo + line range` is enough because only published, confirmed package episodes are eligible.
- `source: "extracted"` is intentionally not part of v1. Extracted suggestions can exist later as non-trusted candidates, but only reviewed bindings become audit source.

## Validation Rules

The domain helper should reject or normalize before persistence:

- `projectId` must exist.
- `deliveryPackageId` must exist, belong to the same project, and be `published`.
- The target `DeliveryPackageEpisode` must match `deliveryPackageId + episodeNo`.
- The package episode must have `isConfirmedChange === true`.
- `assetLockRecordId` must exist and belong to the same project and delivery package.
- `episodeNo` must be included in `AssetLockRecord.episodeNos`.
- `startLine` and `endLine` are 1-based and inclusive.
- `startLine <= endLine`.
- Line range must be inside the package episode content.
- `excerptSnapshot.trim()` must not be empty.
- Duplicate bindings for the same `assetLockRecordId + deliveryPackageId + episodeNo + startLine + endLine` should be rejected.
- `AssetLockRecord.status === "locked"` should reject create/remove source binding until a product decision explicitly allows post-lock source changes.

## Permission Rules

Use server workspace session only.

- project role `owner` and `coordinator`: can create and remove bindings for project records.
- project role `head_writer`: can create and remove bindings for project records.
- project role `writer`: can create and remove bindings only when the binding episode intersects their `writer` episode assignment.
- project role `creator`: read only; can view bindings only inside `creator` or `lead_creator` episode assignments.
- episode responsibilities `reviewer` and `support`: do not grant source-binding write permission unless a later product decision grants it.

Read visibility must match the timeline projection:

- creators see only bindings whose `episodeNo` is in their creator/lead_creator assignment scope;
- ordinary writers see only bindings whose `episodeNo` is in their writer assignment scope;
- head writers, coordinators, and owners can see project-wide bindings.
- implementation must derive scope by joining `EpisodeAssignment.episodeId` to `Episode.projectId/episodeNo`, not by trusting client-provided episode numbers.

## API Boundary

Do not add `POST /api/asset-decision-timeline`.

If persistence is approved, add narrow operations under the existing asset-lock area, for example:

```text
POST /api/asset-lock-records
{
  "action": "bind_source",
  "assetLockRecordId": "...",
  "deliveryPackageId": "...",
  "episodeNo": 3,
  "startLine": 12,
  "endLine": 15
}
```

```text
POST /api/asset-lock-records
{
  "action": "remove_source_binding",
  "scriptSourceBindingId": "..."
}
```

v1 can hard-delete bindings if persistence is approved. That means audit only covers currently active bindings. If deletion history becomes a product requirement, add `status`, `removedByUserId`, and `removedAt` before exposing remove in production.

The route must not accept:

- `viewerUserId`
- `viewerRole`
- `assignedEpisodeNos`
- `createdByUserId`
- `actorUserId`
- `excerptSnapshot`

The service should inject actor identity and role from workspace state, then call domain helpers.

## Projection Behavior

The timeline projection should consume bindings in this order:

1. Use explicit `ScriptSourceBinding` rows visible to the viewer.
2. Materialize `ScriptSourceExcerpt` from `excerptSnapshot`, line range, and package episode metadata.
3. Attach excerpt ids to matching `AssetStateSegment` and `AssetDecisionItem`.
4. If no binding exists, keep the current asset-name source matching as demo/projection fallback.

Fallback rules:

- fallback excerpts are not audit truth;
- fallback excerpts must still be scoped by role and assigned episodes;
- fallback should be visually usable but not saved as binding without explicit writer/head-writer action;
- legacy workspaces without `scriptSourceBindings` must not crash.

## Storage Boundary

First implementation can add an optional workspace field:

```ts
scriptSourceBindings?: ScriptSourceBinding[];
```

Compatibility rule:

- missing `scriptSourceBindings` means an empty list.
- reset/seed flows should initialize it to `[]` only when persistence work starts.
- do not touch store/seed in the documentation-only commit.

## Test Plan

Domain helper tests:

- builds a stable excerpt snapshot from multi-line content;
- rejects unknown project;
- rejects cross-project package/record mismatch;
- rejects unpublished package;
- rejects unconfirmed package episode;
- rejects episode outside the record episode range;
- rejects out-of-range line numbers;
- rejects empty excerpt;
- rejects duplicate line range binding;
- rejects locked records for create/remove source binding.

API/service tests:

- malicious client `createdByUserId` or `actorUserId` is ignored;
- writer can bind only inside writer assignment episodes;
- creator cannot create or remove bindings;
- coordinator/head_writer can bind project records;
- remove binding enforces the same scope rules;
- legacy workspace with no `scriptSourceBindings` returns stable responses.

Projection tests:

- explicit binding wins over asset-name fallback;
- no binding keeps existing fallback behavior;
- creator/writer source excerpts are scoped to assigned episodes;
- `decision.sourceExcerptIds` never points to hidden excerpts;
- route still ignores client `viewerUserId`, `viewerRole`, and `assignedEpisodeNos`;
- existing asset-decision-timeline projection stays read-only.

## Rollback And Pause Conditions

Pause if:

- this requires adding `AssetDecision` or `AssetStateSegment`;
- this requires a timeline mutation route;
- source truth still depends only on fuzzy asset-name matching;
- creator/writer can see unassigned source text;
- unconfirmed package content is exposed;
- legacy workspaces crash when bindings are absent.

Rollback strategy:

- documentation can be reverted independently;
- domain helper and tests should be one commit;
- projection integration should be one commit;
- persistence/API mutations should be a separate final commit.
