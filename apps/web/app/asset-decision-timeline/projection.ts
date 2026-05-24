import type {
  AssetLockRecord,
  DeliveryPackageEpisode,
  Episode,
  EpisodeAssignment,
  ProjectRole
} from "@aigc/domain";
import {
  buildTracks,
  type AssetDecisionItem,
  type AssetStateSegment,
  type AssetTimelineClip,
  type AssetTimelineQueueTag,
  type CreatorAssignedEpisodeWindow,
  type PreviousVersionGhostComparison,
  type RoleScopedAssetTimelineViewModel,
  type ScriptSourceExcerpt
} from "../ui/asset-decision-timeline-data";

const CREATOR_SCOPE_RESPONSIBILITIES: Array<EpisodeAssignment["responsibility"]> = ["creator", "lead_creator"];
const WRITER_SCOPE_RESPONSIBILITIES: Array<EpisodeAssignment["responsibility"]> = ["writer"];

export interface AssetTimelineProjectionInput {
  projectId: string;
  deliveryPackageId: string;
  previousDeliveryPackageId?: string;
  viewerRole: ProjectRole;
  viewerUserId: string;
  assetLockRecords: AssetLockRecord[];
  deliveryPackageEpisodes: DeliveryPackageEpisode[];
  episodes: Episode[];
  assignments: EpisodeAssignment[];
  previousAssetLockRecords?: AssetLockRecord[];
}

export function buildAssetTimelineProjection(input: AssetTimelineProjectionInput): RoleScopedAssetTimelineViewModel {
  const records = input.assetLockRecords
    .filter((record) => record.projectId === input.projectId && record.deliveryPackageId === input.deliveryPackageId)
    .sort((a, b) => getEpisodeRange(a.episodeNos).from - getEpisodeRange(b.episodeNos).from || a.assetName.localeCompare(b.assetName));
  const currentPackageEpisodes = input.deliveryPackageEpisodes.filter((episode) => episode.deliveryPackageId === input.deliveryPackageId);
  const creatorAssignedWindow =
    input.viewerRole === "creator"
      ? deriveCreatorAssignedEpisodeWindow({
          assignments: input.assignments,
          episodes: input.episodes,
          projectId: input.projectId,
          userId: input.viewerUserId
        })
      : undefined;
  const roleScopedEpisodeNos =
    input.viewerRole === "creator"
      ? creatorAssignedWindow?.episodeNos ?? []
      : input.viewerRole === "writer"
        ? deriveAssignedEpisodeNos({
            assignments: input.assignments,
            episodes: input.episodes,
            projectId: input.projectId,
            responsibilities: WRITER_SCOPE_RESPONSIBILITIES,
            userId: input.viewerUserId
          })
        : undefined;
  const isRoleScoped = roleScopedEpisodeNos !== undefined;
  const roleEpisodeSet = new Set(roleScopedEpisodeNos ?? []);
  const scopedRecords = isRoleScoped
    ? records.filter((record) => record.episodeNos.some((episodeNo) => roleEpisodeSet.has(episodeNo)))
    : records;
  const assetNames = scopedRecords.map((record) => record.assetName);
  const sourceExcerpts = deriveSourceExcerptsFromPackageEpisodes({
    assetNames,
    deliveryPackageEpisodes: currentPackageEpisodes,
    deliveryPackageId: input.deliveryPackageId,
    projectId: input.projectId
  }).filter((excerpt) => !isRoleScoped || roleEpisodeSet.has(excerpt.episodeNo));
  const previousRecords = filterPreviousAssetLockRecords(input);
  const segments = scopedRecords.map((record) => buildAssetStateSegment(record, sourceExcerpts));
  const decisions = scopedRecords.map((record) => deriveDecisionItemFromAssetLockRecord(record, sourceExcerpts));
  const clips = scopedRecords.map((record, index) =>
    buildTimelineClip({
      roleEpisodeSet,
      decisionItemId: decisions[index].id,
      isRoleScoped,
      record,
      segment: segments[index],
      previousRecord: previousRecords.find((previous) => previous.assetName === record.assetName && previous.assetType === record.assetType)
    })
  );
  const packageEpisodeNos = normalizeEpisodeNos(currentPackageEpisodes.map((episode) => episode.episodeNo));
  const projectedEpisodeNos =
    roleScopedEpisodeNos !== undefined
      ? roleScopedEpisodeNos
      : normalizeEpisodeNos([...packageEpisodeNos, ...records.flatMap((record) => record.episodeNos)]);

  return {
    projectId: input.projectId,
    viewerUserId: input.viewerUserId,
    viewerRole: input.viewerRole,
    viewMode: "work_window",
    episodeWindow: buildEpisodeWindow(projectedEpisodeNos),
    creatorAssignedWindow,
    tracks: buildTracks(input.projectId, clips),
    decisionQueue: decisions,
    sourceExcerpts,
    selectedClipId: decisions.find((decision) => decision.clipId)?.clipId,
    permissions: buildTimelinePermissions(input.viewerRole)
  };
}

export function deriveCreatorAssignedEpisodeWindow({
  assignments,
  episodes,
  projectId,
  userId
}: {
  assignments: EpisodeAssignment[];
  episodes: Episode[];
  projectId: string;
  userId: string;
}): CreatorAssignedEpisodeWindow | undefined {
  const { episodeNos, scopedAssignments } = deriveScopedAssignments({
    assignments,
    episodes,
    projectId,
    responsibilities: CREATOR_SCOPE_RESPONSIBILITIES,
    userId
  });

  if (episodeNos.length === 0) {
    return undefined;
  }

  return {
    projectId,
    userId,
    episodeFrom: episodeNos[0],
    episodeTo: episodeNos[episodeNos.length - 1],
    episodeNos,
    sourceAssignmentIds: scopedAssignments.map((assignment) => assignment.id).sort()
  };
}

export function deriveSourceExcerptsFromPackageEpisodes({
  assetNames,
  deliveryPackageEpisodes,
  deliveryPackageId,
  projectId
}: {
  assetNames: string[];
  deliveryPackageEpisodes: DeliveryPackageEpisode[];
  deliveryPackageId: string;
  projectId: string;
}): ScriptSourceExcerpt[] {
  const uniqueAssetNames = Array.from(new Set(assetNames.map((assetName) => assetName.trim()).filter(Boolean)));

  return deliveryPackageEpisodes
    .filter((episode) => episode.deliveryPackageId === deliveryPackageId)
    .flatMap((episode) => {
      const lines = episode.content.split(/\r?\n/);

      return lines.flatMap((line, index) => {
        const relatedAssetNames = uniqueAssetNames.filter((assetName) => line.includes(assetName));

        if (relatedAssetNames.length === 0) {
          return [];
        }

        const lineNo = index + 1;

        return [
          {
            id: `${deliveryPackageId}-ep${episode.episodeNo}-line${lineNo}`,
            projectId,
            deliveryPackageId,
            episodeNo: episode.episodeNo,
            title: `${episode.title} · 第 ${lineNo} 行`,
            excerpt: line.trim(),
            startLine: lineNo,
            endLine: lineNo,
            relatedAssetNames
          }
        ];
      });
    });
}

export function deriveDecisionItemFromAssetLockRecord(
  record: AssetLockRecord,
  sourceExcerpts: ScriptSourceExcerpt[] = []
): AssetDecisionItem {
  const range = getEpisodeRange(record.episodeNos);
  const sourceExcerptIds = findSourceExcerptIdsForRecord(record, sourceExcerpts);
  const statusMapping = mapAssetLockRecordToDecisionState(record);

  return {
    id: `decision-${record.id}`,
    projectId: record.projectId,
    assetLockRecordId: record.id,
    clipId: `clip-${record.id}`,
    kind: statusMapping.kind,
    status: statusMapping.status,
    title: `${record.assetName}${statusMapping.titleSuffix}`,
    description: statusMapping.description,
    episodeNos: normalizeEpisodeNos(record.episodeNos),
    queueTags: statusMapping.queueTags,
    assignedToRole: statusMapping.assignedToRole,
    sourceExcerptIds,
    currentSummary: `当前版：第 ${range.from}-${range.to} 集 ${record.assetName} · ${statusMapping.summary}`,
    previousSummary: undefined,
    risk: record.risk,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function buildAssetStateSegment(record: AssetLockRecord, sourceExcerpts: ScriptSourceExcerpt[]): AssetStateSegment {
  const range = getEpisodeRange(record.episodeNos);

  return {
    id: `segment-${record.id}`,
    assetLockRecordId: record.id,
    assetName: record.assetName,
    assetType: record.assetType,
    stateLabel: getRecordStateLabel(record),
    episodeFrom: range.from,
    episodeTo: range.to,
    episodeNos: normalizeEpisodeNos(record.episodeNos),
    changeType: record.changeType,
    risk: record.risk,
    sourceExcerptIds: findSourceExcerptIdsForRecord(record, sourceExcerpts)
  };
}

function buildTimelineClip({
  roleEpisodeSet,
  decisionItemId,
  isRoleScoped,
  previousRecord,
  record,
  segment
}: {
  roleEpisodeSet: Set<number>;
  decisionItemId: string;
  isRoleScoped: boolean;
  previousRecord?: AssetLockRecord;
  record: AssetLockRecord;
  segment: AssetStateSegment;
}): AssetTimelineClip {
  const range = getEpisodeRange(record.episodeNos);
  const overlapsRoleScope = !isRoleScoped || record.episodeNos.some((episodeNo) => roleEpisodeSet.has(episodeNo));

  return {
    id: `clip-${record.id}`,
    trackId: `track-${record.assetType}`,
    assetLockRecordId: record.id,
    assetName: record.assetName,
    assetType: record.assetType,
    episodeFrom: range.from,
    episodeTo: range.to,
    currentSegment: segment,
    ghost: buildGhostComparison(record, previousRecord),
    decisionItemIds: [decisionItemId],
    isInAssignedWindow: overlapsRoleScope,
    isDimmedByRoleScope: isRoleScoped && !overlapsRoleScope
  };
}

function filterPreviousAssetLockRecords(input: AssetTimelineProjectionInput) {
  return (input.previousAssetLockRecords ?? []).filter((previous) => {
    if (previous.projectId !== input.projectId) {
      return false;
    }

    if (input.previousDeliveryPackageId) {
      return previous.deliveryPackageId === input.previousDeliveryPackageId;
    }

    return previous.deliveryPackageId !== input.deliveryPackageId;
  });
}

function buildGhostComparison(record: AssetLockRecord, previousRecord?: AssetLockRecord): PreviousVersionGhostComparison | undefined {
  if (!previousRecord) {
    return record.changeType === "new"
      ? {
          changeMarkers: ["new"],
          summary: "上一版没有对应资产。"
        }
      : undefined;
  }

  const currentRange = getEpisodeRange(record.episodeNos);
  const previousRange = getEpisodeRange(previousRecord.episodeNos);
  const changeMarkers: PreviousVersionGhostComparison["changeMarkers"] = [];

  if (currentRange.from !== previousRange.from || currentRange.to !== previousRange.to) {
    changeMarkers.push("range_changed");
  }

  if (record.status !== previousRecord.status || record.risk !== previousRecord.risk) {
    changeMarkers.push("state_changed");
  }

  if (record.changeType === "removed") {
    changeMarkers.push("removed");
  }

  if (changeMarkers.length === 0) {
    return undefined;
  }

  return {
    previousSegmentId: `segment-${previousRecord.id}`,
    previousDeliveryPackageId: previousRecord.deliveryPackageId,
    previousEpisodeFrom: previousRange.from,
    previousEpisodeTo: previousRange.to,
    previousStateLabel: getRecordStateLabel(previousRecord),
    changeMarkers,
    summary: `上一版第 ${previousRange.from}-${previousRange.to} 集，本版第 ${currentRange.from}-${currentRange.to} 集。`
  };
}

function mapAssetLockRecordToDecisionState(record: AssetLockRecord): Pick<
  AssetDecisionItem,
  "kind" | "status" | "queueTags" | "assignedToRole"
> & {
  titleSuffix: string;
  description: string;
  summary: string;
} {
  if (record.status === "disputed") {
    return {
      kind: "conflict",
      status: "conflict",
      queueTags: ["conflicts", "script_changes"],
      assignedToRole: "coordinator",
      titleSuffix: "存在冲突",
      description: record.disputeReason ?? "资产存在争议，需要统筹协调。",
      summary: "存在冲突，等待统筹处理。"
    };
  }

  if (record.status === "needs_info") {
    return {
      kind: "needs_creator_confirm",
      status: "todo",
      queueTags: ["due_today", "affects_my_episodes"],
      assignedToRole: "creator",
      titleSuffix: "需要补充信息",
      description: record.missingInfo ?? "制作侧需要补充资产信息。",
      summary: "需要补充信息后才能继续确认。"
    };
  }

  if (record.writerConfirmation !== "confirmed") {
    return {
      kind: "needs_writer_decision",
      status: "needs_writer_decision",
      queueTags: ["due_today", "script_changes"],
      assignedToRole: "head_writer",
      titleSuffix: "需要编剧定口径",
      description: record.writerNote ?? "需要编剧确认资产口径。",
      summary: "等待编剧确认口径。"
    };
  }

  if (record.productionConfirmation !== "confirmed") {
    return {
      kind: "needs_creator_confirm",
      status: "todo",
      queueTags: ["due_today", "affects_my_episodes"],
      assignedToRole: "creator",
      titleSuffix: "需要创作者确认",
      description: record.productionNote ?? "需要创作者确认资产是否可执行。",
      summary: "等待创作者确认可执行性。"
    };
  }

  return {
    kind: "ready_to_execute",
    status: "executable",
    queueTags: ["affects_my_episodes"],
    assignedToRole: "creator",
    titleSuffix: "可执行",
    description: "编剧和制作侧已确认，可进入执行。",
    summary: "已确认可执行。"
  };
}

function buildTimelinePermissions(viewerRole: ProjectRole): RoleScopedAssetTimelineViewModel["permissions"] {
  return {
    canViewFullSeries: viewerRole === "owner" || viewerRole === "coordinator" || viewerRole === "head_writer",
    canEditSegments: viewerRole === "head_writer" || viewerRole === "writer",
    canConfirmExecutable: viewerRole === "creator" || viewerRole === "coordinator" || viewerRole === "owner",
    canRequestWriterDecision: viewerRole === "creator" || viewerRole === "coordinator" || viewerRole === "owner",
    canResolveConflict: viewerRole === "coordinator" || viewerRole === "owner"
  };
}

function findSourceExcerptIdsForRecord(record: AssetLockRecord, sourceExcerpts: ScriptSourceExcerpt[]) {
  const episodeNos = new Set(record.episodeNos);

  return sourceExcerpts
    .filter((excerpt) => episodeNos.has(excerpt.episodeNo) && excerpt.relatedAssetNames.includes(record.assetName))
    .map((excerpt) => excerpt.id);
}

function deriveAssignedEpisodeNos({
  assignments,
  episodes,
  projectId,
  responsibilities,
  userId
}: {
  assignments: EpisodeAssignment[];
  episodes: Episode[];
  projectId: string;
  responsibilities: Array<EpisodeAssignment["responsibility"]>;
  userId: string;
}) {
  return deriveScopedAssignments({
    assignments,
    episodes,
    projectId,
    responsibilities,
    userId
  }).episodeNos;
}

function deriveScopedAssignments({
  assignments,
  episodes,
  projectId,
  responsibilities,
  userId
}: {
  assignments: EpisodeAssignment[];
  episodes: Episode[];
  projectId: string;
  responsibilities: Array<EpisodeAssignment["responsibility"]>;
  userId: string;
}) {
  const projectEpisodeById = new Map(episodes.filter((episode) => episode.projectId === projectId).map((episode) => [episode.id, episode]));
  const scopedAssignments = assignments.filter(
    (assignment) =>
      assignment.userId === userId && responsibilities.includes(assignment.responsibility) && projectEpisodeById.has(assignment.episodeId)
  );
  const episodeNos = normalizeEpisodeNos(scopedAssignments.map((assignment) => projectEpisodeById.get(assignment.episodeId)?.episodeNo ?? 0));

  return { episodeNos, scopedAssignments };
}

function getRecordStateLabel(record: AssetLockRecord) {
  if (record.status === "disputed") {
    return "冲突待协调";
  }

  if (record.status === "needs_info") {
    return "待补充信息";
  }

  if (record.status === "locked") {
    return "已定版";
  }

  if (record.writerConfirmation === "confirmed" && record.productionConfirmation === "confirmed") {
    return "可执行";
  }

  return "待确认";
}

function buildEpisodeWindow(episodeNos: number[]) {
  if (episodeNos.length === 0) {
    return { from: 1, to: 10 };
  }

  const from = episodeNos[0];
  const to = episodeNos[episodeNos.length - 1];
  let windowFrom = Math.max(1, from - 1);

  if (windowFrom + 9 < to) {
    windowFrom = Math.max(1, to - 9);
  }

  return { from: windowFrom, to: windowFrom + 9 };
}

function getEpisodeRange(episodeNos: number[]) {
  const normalized = normalizeEpisodeNos(episodeNos);
  const from = normalized[0] ?? 1;
  const to = normalized[normalized.length - 1] ?? from;

  return { from, to };
}

function normalizeEpisodeNos(episodeNos: number[]) {
  return Array.from(new Set(episodeNos))
    .filter((episodeNo) => Number.isInteger(episodeNo) && episodeNo > 0)
    .sort((a, b) => a - b);
}
