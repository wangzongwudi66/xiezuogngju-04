import {
  confirmAssetLockRecordByProduction,
  confirmAssetLockRecordByWriter,
  createAssetLockRecord,
  createDeliveryPackageDraft,
  createScriptSourceBinding,
  extractAssetLockCandidatesFromDeliveryEpisodes,
  finalLockAssetRecord,
  markAssetLockRecordDisputed,
  markAssetLockRecordNeedsInfo,
  publishDeliveryPackage,
  removeScriptSourceBinding,
  selectPrimaryRole,
  submitDeliveryPackageForReview
} from "@aigc/domain";
import type {
  AssetChangeType,
  AssetLockRecord,
  AssetRiskLevel,
  AssetType,
  EpisodeAssignment,
  ProjectRole,
  ScriptSourceBinding,
  WorkspaceState
} from "@aigc/domain";
import type { WorkspaceRequestActor } from "../workspace-actor";
import { resolveAssetLockRecordRepository } from "./repository";
import type { AssetLockRecordRepositorySnapshot, DbAssetLockRecordRepository, LocalAssetLockRecordRepository } from "./repository";

export type AssetLockRecordMutationRequest =
  | {
      action: "create";
      projectId: string;
      deliveryPackageId: string;
      episodeNos: number[];
      assetName: string;
      assetType: AssetType;
      changeType: AssetChangeType;
      createdByUserId?: string;
      risk?: AssetRiskLevel;
      writerNote?: string;
      productionNote?: string;
    }
  | {
      action: "writer_confirm";
      assetLockRecordId: string;
      confirmedByUserId?: string;
      note?: string;
    }
  | {
      action: "production_confirm";
      assetLockRecordId: string;
      confirmedByUserId?: string;
      note?: string;
    }
  | {
      action: "needs_info";
      assetLockRecordId: string;
      markedByUserId?: string;
      missingInfo: string;
    }
  | {
      action: "dispute";
      assetLockRecordId: string;
      markedByUserId?: string;
      disputeReason: string;
    }
  | {
      action: "final_lock";
      assetLockRecordId: string;
      lockedByUserId?: string;
    }
  | {
      action: "bind_source";
      assetLockRecordId: string;
      deliveryPackageId: string;
      episodeNo: number;
      startLine: number;
      endLine: number;
    }
  | {
      action: "remove_source_binding";
      scriptSourceBindingId: string;
    }
  | {
      action: "prepare_demo";
      projectId: string;
      actorUserId?: string;
    }
  | {
      action: "generate_from_package";
      projectId: string;
      deliveryPackageId: string;
      actorUserId?: string;
    };

export interface AssetLockRecordListResponse {
  records: AssetLockRecord[];
  sourceBindings: ScriptSourceBinding[];
  summary: AssetLockRecordSummary;
}

export interface AssetLockRecordMutationResponse extends AssetLockRecordListResponse {
  record: AssetLockRecord;
  sourceBinding?: ScriptSourceBinding;
  removedSourceBindingId?: string;
}

export interface AssetLockRecordSummary {
  total: number;
  byStatus: Record<AssetLockRecord["status"], number>;
  byRisk: Record<AssetLockRecord["risk"], number>;
  pendingWriterCount: number;
  pendingProductionCount: number;
}

export async function listAssetLockRecords(
  projectId: string | undefined,
  actor: WorkspaceRequestActor
): Promise<AssetLockRecordListResponse> {
  const repository = resolveAssetLockRecordRepository();
  const snapshot = await repository.read();
  const viewerUserId = actor.userId;
  assertKnownActor(snapshot.state, actor);
  const records = selectAssetLockRecords(snapshot, projectId, viewerUserId);

  return {
    records,
    sourceBindings: selectVisibleScriptSourceBindings(snapshot, records, viewerUserId),
    summary: summarizeAssetLockRecords(records)
  };
}

export async function mutateAssetLockRecord(
  input: AssetLockRecordMutationRequest,
  actor: WorkspaceRequestActor
): Promise<AssetLockRecordMutationResponse> {
  const repository = resolveAssetLockRecordRepository();

  if (repository.mode === "db") {
    return mutateAssetLockRecordInDb(repository, input, actor);
  }

  return mutateAssetLockRecordInLocal(repository, input, actor);
}

async function mutateAssetLockRecordInLocal(
  repository: LocalAssetLockRecordRepository,
  input: AssetLockRecordMutationRequest,
  actor: WorkspaceRequestActor
): Promise<AssetLockRecordMutationResponse> {
  let sourceBinding: ScriptSourceBinding | undefined;
  let removedSourceBindingId: string | undefined;
  let removedSourceBindingRecordId: string | undefined;
  const snapshot = await repository.mutate((repositorySnapshot) => {
    const state = repositorySnapshot.state;

    if (input.action === "remove_source_binding") {
      const binding = requireScriptSourceBindingForService(state, input.scriptSourceBindingId);
      removedSourceBindingRecordId = binding.assetLockRecordId;
      removedSourceBindingId = binding.id;
    }

    const nextState = applyAssetLockRecordMutation(state, input, actor);

    if (input.action === "bind_source") {
      sourceBinding = findCreatedSourceBinding(nextState, input);
    }

    return nextState;
  });
  const record = findMutatedRecord(snapshot, input, removedSourceBindingRecordId);
  const viewerUserId = actor.userId;
  const records = selectAssetLockRecords(snapshot, record.projectId, viewerUserId);

  return {
    record,
    records,
    sourceBindings: selectVisibleScriptSourceBindings(snapshot, records, viewerUserId),
    summary: summarizeAssetLockRecords(records),
    sourceBinding,
    removedSourceBindingId
  };
}

async function mutateAssetLockRecordInDb(
  repository: DbAssetLockRecordRepository,
  input: AssetLockRecordMutationRequest,
  actor: WorkspaceRequestActor
): Promise<AssetLockRecordMutationResponse> {
  if (input.action !== "create") {
    throw new Error(`asset_lock_record_db_mutation_unsupported:${input.action}`);
  }

  const previousSnapshot = await repository.read();
  const nextState = applyAssetLockRecordMutation(previousSnapshot.state, input, actor);
  const createdRecord = findCreatedAssetLockRecord(previousSnapshot, nextState);
  const snapshot = await repository.createAssetLockRecord(createdRecord);
  const record = snapshot.assetLockRecords.find((item) => item.id === createdRecord.id) ?? createdRecord;
  const viewerUserId = actor.userId;
  const records = selectAssetLockRecords(snapshot, record.projectId, viewerUserId);

  return {
    record,
    records,
    sourceBindings: selectVisibleScriptSourceBindings(snapshot, records, viewerUserId),
    summary: summarizeAssetLockRecords(records)
  };
}

function applyAssetLockRecordMutation(state: WorkspaceState, input: AssetLockRecordMutationRequest, actor: WorkspaceRequestActor) {
  const actorUserId = actor.userId;
  assertKnownActor(state, actor);
  assertAssetLockMutationPermission(state, input, actorUserId);

  switch (input.action) {
    case "create":
      return createAssetLockRecord(state, {
        projectId: input.projectId,
        deliveryPackageId: input.deliveryPackageId,
        episodeNos: input.episodeNos,
        assetName: input.assetName,
        assetType: input.assetType,
        changeType: input.changeType,
        createdByUserId: actorUserId,
        risk: input.risk,
        writerNote: input.writerNote,
        productionNote: input.productionNote
      });
    case "writer_confirm":
      return confirmAssetLockRecordByWriter(state, {
        assetLockRecordId: input.assetLockRecordId,
        confirmedByUserId: actorUserId,
        note: input.note
      });
    case "production_confirm":
      return confirmAssetLockRecordByProduction(state, {
        assetLockRecordId: input.assetLockRecordId,
        confirmedByUserId: actorUserId,
        note: input.note
      });
    case "needs_info":
      return markAssetLockRecordNeedsInfo(state, {
        assetLockRecordId: input.assetLockRecordId,
        markedByUserId: actorUserId,
        missingInfo: input.missingInfo
      });
    case "dispute":
      return markAssetLockRecordDisputed(state, {
        assetLockRecordId: input.assetLockRecordId,
        markedByUserId: actorUserId,
        disputeReason: input.disputeReason
      });
    case "final_lock":
      return finalLockAssetRecord(state, {
        assetLockRecordId: input.assetLockRecordId,
        lockedByUserId: actorUserId
      });
    case "bind_source": {
      const record = requireAssetLockRecordForService(state, input.assetLockRecordId);
      const sourceBinding = createScriptSourceBinding(state, {
        projectId: record.projectId,
        deliveryPackageId: input.deliveryPackageId,
        assetLockRecordId: input.assetLockRecordId,
        episodeNo: input.episodeNo,
        startLine: input.startLine,
        endLine: input.endLine,
        createdByUserId: actorUserId
      });

      return {
        ...state,
        scriptSourceBindings: [...(state.scriptSourceBindings ?? []), sourceBinding]
      };
    }
    case "remove_source_binding":
      return removeScriptSourceBinding(state, {
        scriptSourceBindingId: input.scriptSourceBindingId
      });
    case "prepare_demo":
      return prepareAssetLockDemoRecords(state, input.projectId, actorUserId);
    case "generate_from_package":
      return generateAssetLockRecordsFromPackage(state, {
        projectId: input.projectId,
        deliveryPackageId: input.deliveryPackageId,
        actorUserId,
        allowFallback: false
      });
  }
}

function findMutatedRecord(
  snapshot: AssetLockRecordRepositorySnapshot,
  input: AssetLockRecordMutationRequest,
  removedSourceBindingRecordId?: string
) {
  const records = snapshot.assetLockRecords;

  if (input.action === "create") {
    const record = records.at(-1);

    if (!record) {
      throw new Error("asset_lock_record_not_created");
    }

    return record;
  }

  if (input.action === "prepare_demo") {
    const record = records.find((item) => item.projectId === input.projectId);

    if (!record) {
      throw new Error("asset_lock_record_not_created");
    }

    return record;
  }

  if (input.action === "generate_from_package") {
    const record = records.find(
      (item) => item.projectId === input.projectId && item.deliveryPackageId === input.deliveryPackageId
    );

    if (!record) {
      throw new Error("asset_lock_record_not_created");
    }

    return record;
  }

  if (input.action === "bind_source") {
    const record = records.find((item) => item.id === input.assetLockRecordId);

    if (!record) {
      throw new Error("asset_lock_record_not_found");
    }

    return record;
  }

  if (input.action === "remove_source_binding") {
    const record = records.find((item) => item.id === removedSourceBindingRecordId);

    if (!record) {
      throw new Error("asset_lock_record_not_found");
    }

    return record;
  }

  const record = records.find((item) => item.id === input.assetLockRecordId);

  if (!record) {
    throw new Error("asset_lock_record_not_found");
  }

  return record;
}

function findCreatedAssetLockRecord(previousSnapshot: AssetLockRecordRepositorySnapshot, nextState: WorkspaceState) {
  const previousRecordIds = new Set(previousSnapshot.assetLockRecords.map((record) => record.id));
  const record = (nextState.assetLockRecords ?? []).find((item) => !previousRecordIds.has(item.id));

  if (!record) {
    throw new Error("asset_lock_record_not_created");
  }

  return record;
}

function prepareAssetLockDemoRecords(state: WorkspaceState, projectId: string, actorUserId: string) {
  const existingPublishedPackage = state.deliveryPackages.find(
    (deliveryPackage) => deliveryPackage.projectId === projectId && deliveryPackage.status === "published"
  );
  let nextState = state;
  let deliveryPackageId = existingPublishedPackage?.id ?? "";

  if (!deliveryPackageId) {
    nextState = createDeliveryPackageDraft(nextState, {
      projectId,
      uploadedByUserId: actorUserId,
      type: "range",
      declaredEpisodeFrom: 3,
      declaredEpisodeTo: 4,
      title: "Asset lock demo delivery package",
      sourceFileName: "asset-lock-demo.docx",
      episodes: [
        {
          episodeNo: 3,
          title: "Episode 3",
          content:
            "\u7b2c 3 \u96c6\n\u9435\u7926\u4e95\u5165\u53e3\u65b0\u589e\u5347\u964d\u7b3c\uff0c\u7ea2\u8272\u5b89\u5168\u706f\u7b2c\u4e00\u6b21\u542f\u7528\u3002"
        },
        {
          episodeNo: 4,
          title: "Episode 4",
          content:
            "\u7b2c 4 \u96c6\n\u5730\u56fe\u5c55\u5f00\uff0c\u7c89\u5c18\u7206\u95ea\u4f5c\u4e3a\u584c\u65b9\u524d\u5146\uff0c\u5236\u4f5c\u4fa7\u9700\u8981\u786e\u8ba4\u8d44\u4ea7\u5c3a\u5bf8\u548c\u590d\u7528\u8303\u56f4\u3002"
        }
      ],
      confirmedEpisodeNos: [3, 4]
    });
    deliveryPackageId = nextState.deliveryPackages.at(-1)?.id ?? "";
    nextState = submitDeliveryPackageForReview(nextState, deliveryPackageId, actorUserId);
    nextState = publishDeliveryPackage(nextState, deliveryPackageId, actorUserId);
  }

  return generateAssetLockRecordsFromPackage(nextState, {
    projectId,
    deliveryPackageId,
    actorUserId,
    allowFallback: true
  });
}

function generateAssetLockRecordsFromPackage(
  state: WorkspaceState,
  input: { actorUserId: string; allowFallback: boolean; deliveryPackageId: string; projectId: string }
) {
  const deliveryPackage = state.deliveryPackages.find((item) => item.id === input.deliveryPackageId);

  if (!deliveryPackage) {
    throw new Error("delivery_package_not_found");
  }

  if (deliveryPackage.projectId !== input.projectId) {
    throw new Error("asset_lock_record_package_project_mismatch");
  }

  if (deliveryPackage.status !== "published") {
    throw new Error("asset_lock_record_requires_published_package");
  }

  const episodes = state.deliveryPackageEpisodes.filter((episode) => episode.deliveryPackageId === input.deliveryPackageId);
  const existingNames = new Set(
    (state.assetLockRecords ?? [])
      .filter((record) => record.deliveryPackageId === input.deliveryPackageId)
      .map((record) => normalizeAssetLockNameKey(record.assetName))
  );
  const candidates = extractAssetLockCandidatesFromDeliveryEpisodes({
    projectId: input.projectId,
    deliveryPackageId: input.deliveryPackageId,
    createdByUserId: input.actorUserId,
    episodes
  });
  const candidatesToCreate =
    candidates.length > 0
      ? candidates
      : input.allowFallback
        ? [
            {
              projectId: input.projectId,
              deliveryPackageId: input.deliveryPackageId,
              episodeNos: episodes.map((episode) => episode.episodeNo),
              assetName: "Manual review asset candidate",
              assetType: "prop" as const,
              changeType: "modified" as const,
              createdByUserId: input.actorUserId,
              risk: "attention" as const,
              writerNote: "No asset keywords were extracted. Writer should confirm whether this package contains asset changes.",
              productionNote: "No asset keywords were extracted. Production should confirm whether assets need to be added or changed."
            }
          ]
        : [];

  if (candidatesToCreate.length === 0) {
    throw new Error("asset_lock_candidates_empty");
  }

  let nextState = state;

  for (const candidate of candidatesToCreate) {
    const assetNameKey = normalizeAssetLockNameKey(candidate.assetName);

    if (existingNames.has(assetNameKey)) {
      continue;
    }

    nextState = createAssetLockRecord(nextState, candidate);
    existingNames.add(assetNameKey);
  }

  return nextState;
}

function normalizeAssetLockNameKey(assetName: string) {
  return assetName.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function selectAssetLockRecords(
  snapshot: AssetLockRecordRepositorySnapshot,
  projectId: string | undefined,
  viewerUserId: string
) {
  return snapshot.assetLockRecords
    .filter((record) => !projectId || record.projectId === projectId)
    .filter((record) => canViewAssetLockRecord(snapshot.state, record, viewerUserId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function selectVisibleScriptSourceBindings(
  snapshot: AssetLockRecordRepositorySnapshot,
  records: AssetLockRecord[],
  viewerUserId: string
) {
  const recordsById = new Map(records.map((record) => [record.id, record]));

  return snapshot.scriptSourceBindings.filter((binding) => {
    const record = recordsById.get(binding.assetLockRecordId);

    if (!record) {
      return false;
    }

    if (
      binding.projectId !== record.projectId ||
      binding.deliveryPackageId !== record.deliveryPackageId ||
      !record.episodeNos.includes(binding.episodeNo)
    ) {
      return false;
    }

    const role = selectPrimaryRole(snapshot.state, viewerUserId, record.projectId);

    if (hasFullAssetLockAccess(role)) {
      return true;
    }

    if (role === "writer") {
      return getAssignedEpisodeNos(snapshot.state, record.projectId, viewerUserId, ["writer"]).includes(binding.episodeNo);
    }

    if (role === "creator") {
      return getAssignedEpisodeNos(snapshot.state, record.projectId, viewerUserId, ["creator", "lead_creator"]).includes(
        binding.episodeNo
      );
    }

    return false;
  });
}

function requireProjectMemberRole(state: WorkspaceState, projectId: string, userId: string) {
  const isMember = state.members.some((member) => member.projectId === projectId && member.userId === userId);

  if (!isMember) {
    throw new Error("asset_lock_project_member_required");
  }

  return selectPrimaryRole(state, userId, projectId);
}

function assertKnownActor(state: WorkspaceState, actor: WorkspaceRequestActor) {
  if (!actor.userId || !state.users.some((user) => user.id === actor.userId)) {
    throw new Error("asset_lock_unauthenticated");
  }
}

function canViewAssetLockRecord(state: WorkspaceState, record: AssetLockRecord, viewerUserId: string) {
  if (!state.members.some((member) => member.projectId === record.projectId && member.userId === viewerUserId)) {
    return false;
  }

  const role = selectPrimaryRole(state, viewerUserId, record.projectId);

  if (hasFullAssetLockAccess(role)) {
    return true;
  }

  if (role === "writer") {
    return intersects(record.episodeNos, getAssignedEpisodeNos(state, record.projectId, viewerUserId, ["writer"]));
  }

  if (role === "creator") {
    return intersects(record.episodeNos, getAssignedEpisodeNos(state, record.projectId, viewerUserId, ["creator", "lead_creator"]));
  }

  return false;
}

function assertAssetLockMutationPermission(state: WorkspaceState, input: AssetLockRecordMutationRequest, actorUserId: string) {
  const projectId = getMutationProjectId(state, input);
  const role = requireProjectMemberRole(state, projectId, actorUserId);

  switch (input.action) {
    case "create":
      assertCanCreateAssetLockRecord(state, input, actorUserId, role);
      return;
    case "generate_from_package":
    case "prepare_demo":
      if (!hasFullAssetLockAccess(role)) {
        throw new Error("asset_lock_action_forbidden");
      }
      return;
    case "writer_confirm":
      assertCanMutateExistingRecord(state, input.assetLockRecordId, actorUserId, role, "writer_confirm");
      return;
    case "production_confirm":
      assertCanMutateExistingRecord(state, input.assetLockRecordId, actorUserId, role, "production_confirm");
      return;
    case "needs_info":
    case "dispute":
      assertCanMutateExistingRecord(state, input.assetLockRecordId, actorUserId, role, "comment");
      return;
    case "final_lock":
      if (role !== "owner" && role !== "coordinator") {
        throw new Error("asset_lock_action_forbidden");
      }
      return;
    case "bind_source":
      assertCanMutateSourceBindingEpisode(state, input.assetLockRecordId, input.episodeNo, actorUserId, role);
      return;
    case "remove_source_binding": {
      const binding = requireScriptSourceBindingForService(state, input.scriptSourceBindingId);
      assertCanMutateSourceBindingEpisode(state, binding.assetLockRecordId, binding.episodeNo, actorUserId, role);
      return;
    }
  }
}

function getMutationProjectId(state: WorkspaceState, input: AssetLockRecordMutationRequest) {
  if (input.action === "create" || input.action === "generate_from_package" || input.action === "prepare_demo") {
    return input.projectId;
  }

  if (input.action === "remove_source_binding") {
    const binding = requireScriptSourceBindingForService(state, input.scriptSourceBindingId);
    return requireAssetLockRecordForService(state, binding.assetLockRecordId).projectId;
  }

  return requireAssetLockRecordForService(state, input.assetLockRecordId).projectId;
}

function assertCanCreateAssetLockRecord(
  state: WorkspaceState,
  input: Extract<AssetLockRecordMutationRequest, { action: "create" }>,
  actorUserId: string,
  role: ProjectRole
) {
  if (hasFullAssetLockAccess(role)) {
    return;
  }

  if (role !== "writer") {
    throw new Error("asset_lock_action_forbidden");
  }

  const assignedEpisodeNos = getAssignedEpisodeNos(state, input.projectId, actorUserId, ["writer"]);

  if (input.episodeNos.length === 0 || !input.episodeNos.every((episodeNo) => assignedEpisodeNos.includes(episodeNo))) {
    throw new Error("asset_lock_episode_scope_forbidden");
  }
}

function assertCanMutateExistingRecord(
  state: WorkspaceState,
  assetLockRecordId: string,
  actorUserId: string,
  role: ProjectRole,
  action: "comment" | "production_confirm" | "writer_confirm"
) {
  const record = requireAssetLockRecordForService(state, assetLockRecordId);

  if (role === "owner" || role === "coordinator") {
    return;
  }

  if (role === "head_writer") {
    if (action === "production_confirm") {
      throw new Error("asset_lock_action_forbidden");
    }

    return;
  }

  if (role === "writer") {
    if (action === "production_confirm") {
      throw new Error("asset_lock_action_forbidden");
    }

    if (intersects(record.episodeNos, getAssignedEpisodeNos(state, record.projectId, actorUserId, ["writer"]))) {
      return;
    }
  }

  if (role === "creator") {
    if (action === "writer_confirm") {
      throw new Error("asset_lock_action_forbidden");
    }

    if (intersects(record.episodeNos, getAssignedEpisodeNos(state, record.projectId, actorUserId, ["creator", "lead_creator"]))) {
      return;
    }
  }

  throw new Error("asset_lock_episode_scope_forbidden");
}

function assertCanMutateSourceBindingEpisode(
  state: WorkspaceState,
  assetLockRecordId: string,
  episodeNo: number,
  actorUserId: string,
  role: ProjectRole
) {
  const record = requireAssetLockRecordForService(state, assetLockRecordId);

  if (role === "owner" || role === "coordinator" || role === "head_writer") {
    return;
  }

  if (role !== "writer") {
    throw new Error("asset_lock_action_forbidden");
  }

  if (getAssignedEpisodeNos(state, record.projectId, actorUserId, ["writer"]).includes(episodeNo)) {
    return;
  }

  throw new Error("asset_lock_episode_scope_forbidden");
}

function hasFullAssetLockAccess(role: ProjectRole) {
  return role === "owner" || role === "coordinator" || role === "head_writer";
}

function getAssignedEpisodeNos(
  state: WorkspaceState,
  projectId: string,
  userId: string,
  responsibilities: EpisodeAssignment["responsibility"][]
) {
  const episodeIds = new Set(
    state.assignments
      .filter((assignment) => assignment.userId === userId && responsibilities.includes(assignment.responsibility))
      .map((assignment) => assignment.episodeId)
  );

  return state.episodes
    .filter((episode) => episode.projectId === projectId && episodeIds.has(episode.id))
    .map((episode) => episode.episodeNo);
}

function intersects(left: number[], right: number[]) {
  const rightSet = new Set(right);
  return left.some((episodeNo) => rightSet.has(episodeNo));
}

function requireAssetLockRecordForService(state: WorkspaceState, assetLockRecordId: string) {
  const record = (state.assetLockRecords ?? []).find((item) => item.id === assetLockRecordId);

  if (!record) {
    throw new Error("asset_lock_record_not_found");
  }

  return record;
}

function requireScriptSourceBindingForService(state: WorkspaceState, scriptSourceBindingId: string) {
  const binding = (state.scriptSourceBindings ?? []).find((item) => item.id === scriptSourceBindingId);

  if (!binding) {
    throw new Error("script_source_binding_not_found");
  }

  return binding;
}

function findCreatedSourceBinding(
  state: WorkspaceState,
  input: Extract<AssetLockRecordMutationRequest, { action: "bind_source" }>
) {
  return (state.scriptSourceBindings ?? []).find(
    (binding) =>
      binding.assetLockRecordId === input.assetLockRecordId &&
      binding.deliveryPackageId === input.deliveryPackageId &&
      binding.episodeNo === input.episodeNo &&
      binding.startLine === input.startLine &&
      binding.endLine === input.endLine
  );
}

function summarizeAssetLockRecords(records: AssetLockRecord[]): AssetLockRecordSummary {
  return records.reduce<AssetLockRecordSummary>(
    (summary, record) => {
      summary.total += 1;
      summary.byStatus[record.status] += 1;
      summary.byRisk[record.risk] += 1;

      if (record.writerConfirmation !== "confirmed") {
        summary.pendingWriterCount += 1;
      }

      if (record.productionConfirmation !== "confirmed") {
        summary.pendingProductionCount += 1;
      }

      return summary;
    },
    {
      total: 0,
      byStatus: {
        draft: 0,
        needs_info: 0,
        disputed: 0,
        ready_to_lock: 0,
        locked: 0
      },
      byRisk: {
        normal: 0,
        attention: 0,
        high: 0
      },
      pendingWriterCount: 0,
      pendingProductionCount: 0
    }
  );
}
