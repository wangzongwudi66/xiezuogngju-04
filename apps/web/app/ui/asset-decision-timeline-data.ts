import type { AssetChangeType, AssetRiskLevel, AssetType, ProjectRole } from "@aigc/domain";

export type AssetTimelineViewMode = "series" | "work_window" | "episode";
export type AssetTimelineTrackKind = AssetType | "status";
export type AssetDecisionStatus =
  | "todo"
  | "acknowledged"
  | "executable"
  | "needs_writer_decision"
  | "conflict"
  | "returned"
  | "resolved";
export type AssetDecisionKind =
  | "new_asset"
  | "removed_asset"
  | "range_changed"
  | "state_changed"
  | "source_changed"
  | "needs_creator_confirm"
  | "needs_writer_decision"
  | "conflict"
  | "ready_to_execute";
export type AssetTimelineQueueTag = "due_today" | "affects_my_episodes" | "waiting_others" | "script_changes" | "conflicts";

export interface CreatorAssignedEpisodeWindow {
  projectId: string;
  userId: string;
  episodeFrom: number;
  episodeTo: number;
  episodeNos: number[];
  sourceAssignmentIds: string[];
}

export interface ScriptSourceExcerpt {
  id: string;
  projectId: string;
  deliveryPackageId: string;
  episodeNo: number;
  title?: string;
  excerpt: string;
  startLine?: number;
  endLine?: number;
  relatedAssetNames: string[];
}

export interface AssetStateSegment {
  id: string;
  assetLockRecordId: string;
  assetName: string;
  assetType: AssetType;
  stateLabel: string;
  episodeFrom: number;
  episodeTo: number;
  episodeNos: number[];
  changeType: AssetChangeType;
  risk: AssetRiskLevel;
  sourceExcerptIds: string[];
}

export interface PreviousVersionGhostComparison {
  previousSegmentId?: string;
  previousDeliveryPackageId?: string;
  previousEpisodeFrom?: number;
  previousEpisodeTo?: number;
  previousStateLabel?: string;
  previousSourceExcerptIds?: string[];
  changeMarkers: Array<"new" | "removed" | "range_changed" | "state_changed" | "source_changed">;
  summary: string;
}

export interface AssetTimelineClip {
  id: string;
  trackId: string;
  assetLockRecordId: string;
  assetName: string;
  assetType: AssetType;
  episodeFrom: number;
  episodeTo: number;
  currentSegment: AssetStateSegment;
  ghost?: PreviousVersionGhostComparison;
  decisionItemIds: string[];
  isInAssignedWindow?: boolean;
  isDimmedByRoleScope?: boolean;
}

export interface AssetTimelineTrack {
  id: string;
  projectId: string;
  kind: AssetTimelineTrackKind;
  label: string;
  order: number;
  clips: AssetTimelineClip[];
}

export interface AssetDecisionItem {
  id: string;
  projectId: string;
  assetLockRecordId: string;
  clipId?: string;
  kind: AssetDecisionKind;
  status: AssetDecisionStatus;
  title: string;
  description: string;
  episodeNos: number[];
  queueTags: AssetTimelineQueueTag[];
  assignedToRole?: ProjectRole;
  assignedToUserId?: string;
  sourceExcerptIds: string[];
  currentSummary: string;
  previousSummary?: string;
  risk: AssetRiskLevel;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDecisionGroupSummary {
  kind: Extract<AssetDecisionKind, "needs_writer_decision" | "needs_creator_confirm" | "conflict" | "ready_to_execute">;
  label: string;
  count: number;
  decisionItemIds: string[];
  episodeNos: number[];
  risk: AssetRiskLevel;
  currentSummary: string;
  previousSummary?: string;
}

export interface RoleScopedAssetTimelineViewModel {
  projectId: string;
  viewerUserId: string;
  viewerRole: ProjectRole;
  viewMode: AssetTimelineViewMode;
  episodeWindow: {
    from: number;
    to: number;
  };
  creatorAssignedWindow?: CreatorAssignedEpisodeWindow;
  tracks: AssetTimelineTrack[];
  decisionQueue: AssetDecisionItem[];
  sourceExcerpts: ScriptSourceExcerpt[];
  selectedClipId?: string;
  selectedDecisionItemId?: string;
  permissions: {
    canViewFullSeries: boolean;
    canEditSegments: boolean;
    canConfirmExecutable: boolean;
    canRequestWriterDecision: boolean;
    canResolveConflict: boolean;
  };
}

export const timelineQueueLabels: Record<AssetTimelineQueueTag, string> = {
  due_today: "今日必须确认",
  affects_my_episodes: "影响我的集",
  waiting_others: "等待他人",
  script_changes: "剧本变更",
  conflicts: "资产冲突"
};

export const timelineTrackLabels: Record<AssetTimelineTrackKind, string> = {
  character: "角色轨",
  scene: "场景轨",
  prop: "道具轨",
  vehicle: "车辆轨",
  effect: "特效轨",
  status: "状态轨"
};

export const timelineDecisionLabels: Record<AssetDecisionKind, string> = {
  new_asset: "新增资产",
  removed_asset: "删除资产",
  range_changed: "起止变化",
  state_changed: "状态变化",
  source_changed: "来源变化",
  needs_creator_confirm: "需创作者确认",
  needs_writer_decision: "需编剧定口径",
  conflict: "资产冲突",
  ready_to_execute: "可直接执行"
};

export const timelineRiskLabels: Record<AssetRiskLevel, string> = {
  normal: "普通",
  attention: "注意",
  high: "高风险"
};

const sourceExcerpts: ScriptSourceExcerpt[] = [
  {
    id: "excerpt-lift-ep8",
    projectId: "project-jincheng",
    deliveryPackageId: "delivery-jc-current",
    episodeNo: 8,
    title: "第 8 集 · 升降笼卡死",
    excerpt: "升降笼停在半空，红色安全灯忽明忽暗。李砚把手伸进门缝，旧伤被铁锈刮开。",
    relatedAssetNames: ["北井升降笼", "李砚旧伤妆", "红色安全灯"]
  },
  {
    id: "excerpt-map-ep10",
    projectId: "project-jincheng",
    deliveryPackageId: "delivery-jc-current",
    episodeNo: 10,
    title: "第 10 集 · 旧矿区地图",
    excerpt: "杜衡把手绘图压在灯下，只露出北井到风道的一段线，禁入区名称被刻意遮住。",
    relatedAssetNames: ["旧矿区手绘图"]
  },
  {
    id: "excerpt-dust-ep12",
    projectId: "project-jincheng",
    deliveryPackageId: "delivery-jc-current",
    episodeNo: 12,
    title: "第 12 集 · 粉尘爆闪",
    excerpt: "红灯骤暗，粉尘像火花一样闪过两秒，随后支架发出断裂声。",
    relatedAssetNames: ["井底粉尘爆闪"]
  }
];

const segments: AssetStateSegment[] = [
  {
    id: "segment-lift-current",
    assetLockRecordId: "asset-lock-lift",
    assetName: "北井升降笼",
    assetType: "scene",
    stateLabel: "卡死结构 / 可复用场景",
    episodeFrom: 7,
    episodeTo: 11,
    episodeNos: [7, 8, 9, 10, 11],
    changeType: "modified",
    risk: "attention",
    sourceExcerptIds: ["excerpt-lift-ep8"]
  },
  {
    id: "segment-scar-current",
    assetLockRecordId: "asset-lock-scar",
    assetName: "李砚旧伤妆",
    assetType: "character",
    stateLabel: "旧伤显露 / 需口径",
    episodeFrom: 8,
    episodeTo: 13,
    episodeNos: [8, 9, 10, 11, 12, 13],
    changeType: "modified",
    risk: "high",
    sourceExcerptIds: ["excerpt-lift-ep8"]
  },
  {
    id: "segment-lamp-current",
    assetLockRecordId: "asset-lock-lamp",
    assetName: "红色安全灯",
    assetType: "prop",
    stateLabel: "红光规则沿用",
    episodeFrom: 6,
    episodeTo: 15,
    episodeNos: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    changeType: "reused",
    risk: "normal",
    sourceExcerptIds: ["excerpt-lift-ep8", "excerpt-dust-ep12"]
  },
  {
    id: "segment-map-current",
    assetLockRecordId: "asset-lock-map",
    assetName: "旧矿区手绘图",
    assetType: "prop",
    stateLabel: "新增局部图 / 待补尺寸",
    episodeFrom: 10,
    episodeTo: 12,
    episodeNos: [10, 11, 12],
    changeType: "new",
    risk: "high",
    sourceExcerptIds: ["excerpt-map-ep10"]
  },
  {
    id: "segment-dust-current",
    assetLockRecordId: "asset-lock-dust",
    assetName: "井底粉尘爆闪",
    assetType: "effect",
    stateLabel: "爆闪降级待确认",
    episodeFrom: 12,
    episodeTo: 13,
    episodeNos: [12, 13],
    changeType: "new",
    risk: "high",
    sourceExcerptIds: ["excerpt-dust-ep12"]
  }
];

const decisions: AssetDecisionItem[] = [
  {
    id: "decision-scar-writer",
    projectId: "project-jincheng",
    assetLockRecordId: "asset-lock-scar",
    clipId: "clip-scar",
    kind: "needs_writer_decision",
    status: "needs_writer_decision",
    title: "李砚旧伤妆需要编剧定口径",
    description: "旧伤从第 8 集提前显露，创作者需要确认后续镜头是否保持同一位置。",
    episodeNos: [8, 9, 10, 11, 12, 13],
    queueTags: ["due_today", "affects_my_episodes", "script_changes"],
    assignedToRole: "head_writer",
    sourceExcerptIds: ["excerpt-lift-ep8"],
    currentSummary: "当前版：第 8 集开始显露旧伤，持续到第 13 集。",
    previousSummary: "上一版：旧伤第 10 集后才明确出现。",
    risk: "high",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  },
  {
    id: "decision-map-info",
    projectId: "project-jincheng",
    assetLockRecordId: "asset-lock-map",
    clipId: "clip-map",
    kind: "needs_creator_confirm",
    status: "todo",
    title: "旧矿区手绘图需创作者补尺寸",
    description: "地图只露出局部，但制作侧仍需要尺寸、纸张质感和可见文字范围。",
    episodeNos: [10, 11, 12],
    queueTags: ["due_today", "affects_my_episodes"],
    assignedToRole: "creator",
    assignedToUserId: "user-creator-a",
    sourceExcerptIds: ["excerpt-map-ep10"],
    currentSummary: "当前版：第 10-12 集需要手绘图局部可见。",
    previousSummary: "上一版：没有独立地图道具。",
    risk: "high",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  },
  {
    id: "decision-dust-conflict",
    projectId: "project-jincheng",
    assetLockRecordId: "asset-lock-dust",
    clipId: "clip-dust",
    kind: "conflict",
    status: "conflict",
    title: "粉尘爆闪有剧透风险",
    description: "编剧担心爆闪过早暗示事故，制作侧认为镜头节奏依赖该效果。",
    episodeNos: [12, 13],
    queueTags: ["conflicts", "script_changes", "affects_my_episodes"],
    assignedToRole: "coordinator",
    sourceExcerptIds: ["excerpt-dust-ep12"],
    currentSummary: "当前版：粉尘闪过两秒并带断裂声。",
    previousSummary: "上一版：普通塌方扬尘，没有爆闪。",
    risk: "high",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  },
  {
    id: "decision-lamp-ready",
    projectId: "project-jincheng",
    assetLockRecordId: "asset-lock-lamp",
    clipId: "clip-lamp",
    kind: "ready_to_execute",
    status: "executable",
    title: "红色安全灯可直接执行",
    description: "红光规则已确认，本窗口内只需沿用资产库规则。",
    episodeNos: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    queueTags: ["affects_my_episodes"],
    assignedToRole: "creator",
    assignedToUserId: "user-creator-a",
    sourceExcerptIds: ["excerpt-lift-ep8", "excerpt-dust-ep12"],
    currentSummary: "当前版：第 6-15 集沿用红色安全灯规则。",
    previousSummary: "上一版：规则相同。",
    risk: "normal",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z"
  }
];

const clips: AssetTimelineClip[] = [
  {
    id: "clip-lift",
    trackId: "track-scene",
    assetLockRecordId: "asset-lock-lift",
    assetName: "北井升降笼",
    assetType: "scene",
    episodeFrom: 7,
    episodeTo: 11,
    currentSegment: segments[0],
    ghost: {
      previousSegmentId: "segment-lift-previous",
      previousDeliveryPackageId: "delivery-jc-previous",
      previousEpisodeFrom: 8,
      previousEpisodeTo: 11,
      previousStateLabel: "普通矿井入口",
      previousSourceExcerptIds: ["excerpt-lift-ep8"],
      changeMarkers: ["range_changed", "state_changed"],
      summary: "上一版从第 8 集开始，当前版提前到第 7 集并明确为卡死结构。"
    },
    decisionItemIds: [],
    isInAssignedWindow: true
  },
  {
    id: "clip-scar",
    trackId: "track-character",
    assetLockRecordId: "asset-lock-scar",
    assetName: "李砚旧伤妆",
    assetType: "character",
    episodeFrom: 8,
    episodeTo: 13,
    currentSegment: segments[1],
    ghost: {
      previousSegmentId: "segment-scar-previous",
      previousDeliveryPackageId: "delivery-jc-previous",
      previousEpisodeFrom: 10,
      previousEpisodeTo: 13,
      previousStateLabel: "旧伤后置",
      previousSourceExcerptIds: ["excerpt-lift-ep8"],
      changeMarkers: ["range_changed", "source_changed"],
      summary: "上一版旧伤从第 10 集出现，当前版提前到第 8 集。"
    },
    decisionItemIds: ["decision-scar-writer"],
    isInAssignedWindow: true
  },
  {
    id: "clip-lamp",
    trackId: "track-prop",
    assetLockRecordId: "asset-lock-lamp",
    assetName: "红色安全灯",
    assetType: "prop",
    episodeFrom: 6,
    episodeTo: 15,
    currentSegment: segments[2],
    ghost: {
      previousSegmentId: "segment-lamp-previous",
      previousDeliveryPackageId: "delivery-jc-previous",
      previousEpisodeFrom: 6,
      previousEpisodeTo: 15,
      previousStateLabel: "红光规则沿用",
      previousSourceExcerptIds: ["excerpt-lift-ep8"],
      changeMarkers: [],
      summary: "上一版范围一致，可直接沿用。"
    },
    decisionItemIds: ["decision-lamp-ready"],
    isInAssignedWindow: true
  },
  {
    id: "clip-map",
    trackId: "track-prop",
    assetLockRecordId: "asset-lock-map",
    assetName: "旧矿区手绘图",
    assetType: "prop",
    episodeFrom: 10,
    episodeTo: 12,
    currentSegment: segments[3],
    ghost: {
      previousDeliveryPackageId: "delivery-jc-previous",
      changeMarkers: ["new"],
      summary: "上一版没有独立地图道具。"
    },
    decisionItemIds: ["decision-map-info"],
    isInAssignedWindow: true
  },
  {
    id: "clip-dust",
    trackId: "track-effect",
    assetLockRecordId: "asset-lock-dust",
    assetName: "井底粉尘爆闪",
    assetType: "effect",
    episodeFrom: 12,
    episodeTo: 13,
    currentSegment: segments[4],
    ghost: {
      previousDeliveryPackageId: "delivery-jc-previous",
      previousEpisodeFrom: 12,
      previousEpisodeTo: 12,
      previousStateLabel: "普通粉尘",
      changeMarkers: ["new", "state_changed"],
      summary: "上一版只是普通粉尘，当前版新增爆闪表现。"
    },
    decisionItemIds: ["decision-dust-conflict"],
    isInAssignedWindow: true
  }
];

export function buildMockAssetDecisionTimelineViewModel(input: {
  projectId: string;
  viewerRole: ProjectRole;
  viewerUserId: string;
}): RoleScopedAssetTimelineViewModel {
  const isCreator = input.viewerRole === "creator";
  const creatorAssignedWindow: CreatorAssignedEpisodeWindow | undefined = isCreator
    ? {
        projectId: input.projectId,
        userId: input.viewerUserId,
        episodeFrom: 7,
        episodeTo: 13,
        episodeNos: [7, 8, 9, 10, 11, 12, 13],
        sourceAssignmentIds: ["assignment-demo-creator-window"]
      }
    : undefined;
  const scopedClips = clips.map((clip) => ({
    ...clip,
    isDimmedByRoleScope: isCreator && !rangeIntersects(clip.episodeFrom, clip.episodeTo, 7, 13)
  }));

  return {
    projectId: input.projectId,
    viewerUserId: input.viewerUserId,
    viewerRole: input.viewerRole,
    viewMode: "work_window",
    episodeWindow: { from: 6, to: 15 },
    creatorAssignedWindow,
    tracks: buildTracks(input.projectId, scopedClips),
    decisionQueue: isCreator
      ? decisions.filter((item) => item.queueTags.includes("affects_my_episodes"))
      : decisions,
    sourceExcerpts,
    selectedClipId: "clip-scar",
    permissions: {
      canViewFullSeries: input.viewerRole === "owner" || input.viewerRole === "coordinator" || input.viewerRole === "head_writer",
      canEditSegments: input.viewerRole === "head_writer" || input.viewerRole === "writer",
      canConfirmExecutable: input.viewerRole === "creator" || input.viewerRole === "coordinator" || input.viewerRole === "owner",
      canRequestWriterDecision: input.viewerRole === "creator" || input.viewerRole === "coordinator" || input.viewerRole === "owner",
      canResolveConflict: input.viewerRole === "coordinator" || input.viewerRole === "owner"
    }
  };
}

export function buildTracks(projectId: string, timelineClips: AssetTimelineClip[]): AssetTimelineTrack[] {
  const trackOrder: Array<{ id: string; kind: AssetTimelineTrackKind; label: string; order: number }> = [
    { id: "track-character", kind: "character", label: "角色轨", order: 1 },
    { id: "track-scene", kind: "scene", label: "场景轨", order: 2 },
    { id: "track-prop", kind: "prop", label: "道具轨", order: 3 },
    { id: "track-effect", kind: "effect", label: "特效轨", order: 4 },
    { id: "track-status", kind: "status", label: "状态轨", order: 5 }
  ];

  return trackOrder.map((track) => ({
    ...track,
    projectId,
    clips: timelineClips.filter((clip) => clip.trackId === track.id)
  }));
}

export function getEpisodeWindowNos(window: { from: number; to: number }) {
  return Array.from({ length: window.to - window.from + 1 }, (_, index) => window.from + index);
}

export function mapClipToEpisodeGrid(clip: Pick<AssetTimelineClip, "episodeFrom" | "episodeTo">, window: { from: number; to: number }) {
  const start = Math.max(clip.episodeFrom, window.from);
  const end = Math.min(clip.episodeTo, window.to);

  if (end < window.from || start > window.to) {
    return null;
  }

  return {
    gridColumn: `${start - window.from + 1} / ${end - window.from + 2}`,
    visibleEpisodeFrom: start,
    visibleEpisodeTo: end
  };
}

export function filterDecisionItemsByQueue(items: AssetDecisionItem[], queueTag: AssetTimelineQueueTag) {
  return items.filter((item) => item.queueTags.includes(queueTag));
}

export function summarizeDecisionGroups(items: AssetDecisionItem[]): AssetDecisionGroupSummary[] {
  const groups = [
    {
      kind: "needs_writer_decision" as const,
      label: "需编剧定口径",
      items: items.filter((item) => item.kind === "needs_writer_decision")
    },
    {
      kind: "needs_creator_confirm" as const,
      label: "需创作者确认",
      items: items.filter((item) => item.kind === "needs_creator_confirm")
    },
    {
      kind: "conflict" as const,
      label: "资产冲突",
      items: items.filter((item) => item.kind === "conflict")
    },
    {
      kind: "ready_to_execute" as const,
      label: "可直接执行",
      items: items.filter((item) => item.kind === "ready_to_execute")
    }
  ];

  return groups
    .map((group) => {
      const episodeNos = Array.from(new Set(group.items.flatMap((item) => item.episodeNos))).sort((a, b) => a - b);
      const risk: AssetRiskLevel = group.items.some((item) => item.risk === "high")
        ? "high"
        : group.items.some((item) => item.risk === "attention")
          ? "attention"
          : "normal";

      return {
        kind: group.kind,
        label: group.label,
        count: group.items.length,
        decisionItemIds: group.items.map((item) => item.id),
        episodeNos,
        risk,
        currentSummary: group.items.map((item) => item.currentSummary).join("；"),
        previousSummary: group.items.map((item) => item.previousSummary).filter(Boolean).join("；") || undefined
      };
    })
    .filter((group) => group.count > 0);
}

export function findDecisionGroupItems(viewModel: RoleScopedAssetTimelineViewModel, decisionItemIds: string[]) {
  const ids = new Set(decisionItemIds);
  return viewModel.decisionQueue.filter((item) => ids.has(item.id));
}

export function findClipDecisionItems(viewModel: RoleScopedAssetTimelineViewModel, clipId: string) {
  const decisionIds = new Set(
    viewModel.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)?.decisionItemIds ?? []
  );
  return viewModel.decisionQueue.filter((item) => decisionIds.has(item.id));
}

export function findSourceExcerpts(viewModel: RoleScopedAssetTimelineViewModel, sourceExcerptIds: string[]) {
  const ids = new Set(sourceExcerptIds);
  return viewModel.sourceExcerpts.filter((excerpt) => ids.has(excerpt.id));
}

function rangeIntersects(aFrom: number, aTo: number, bFrom: number, bTo: number) {
  return aFrom <= bTo && bFrom <= aTo;
}
