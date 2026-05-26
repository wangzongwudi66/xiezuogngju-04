import type { ProjectRole } from "@aigc/domain";
import type { AssetTimelineClip, AssetTimelineQueueTag, ScriptSourceExcerpt } from "./asset-decision-timeline-data";

const sourceKindLabels: Record<ScriptSourceExcerpt["sourceKind"], string> = {
  explicit_binding: "显式绑定",
  asset_name_match: "自动匹配参考"
};

export const sourceExcerptEmptyText = "当前选择没有可展示的剧本来源段落。";

export function getSourceKindLabel(sourceKind: ScriptSourceExcerpt["sourceKind"]) {
  return sourceKindLabels[sourceKind];
}

export function buildTimelineResetKey({
  actorRole,
  actorUserId,
  assignedEpisodeNos,
  defaultQueueTag,
  projectId,
  selectedClipId,
  viewModelSourceKey
}: {
  actorRole: ProjectRole;
  actorUserId: string;
  assignedEpisodeNos?: number[];
  defaultQueueTag: AssetTimelineQueueTag;
  projectId: string;
  selectedClipId?: string;
  viewModelSourceKey?: string;
}) {
  const assignedScope = assignedEpisodeNos === undefined ? "demo" : assignedEpisodeNos.join(",");

  return [projectId, actorRole, actorUserId, assignedScope, defaultQueueTag, selectedClipId ?? "", viewModelSourceKey ?? "demo"].join("|");
}

export function getClipChangeMarkers(clip: AssetTimelineClip) {
  return clip.ghost?.changeMarkers.join(" ") ?? "";
}

export function getDecisionClipClassName({
  clip,
  focusedClipIds,
  selectedClipId
}: {
  clip: AssetTimelineClip;
  focusedClipIds: ReadonlySet<string>;
  selectedClipId: string;
}) {
  return [
    "decision-clip",
    clip.assetType,
    clip.currentSegment.risk,
    getClipChangeMarkers(clip),
    clip.id === selectedClipId ? "selected" : "",
    focusedClipIds.size > 0 && !focusedClipIds.has(clip.id) ? "muted" : "",
    clip.isDimmedByRoleScope ? "muted scope-muted" : ""
  ]
    .filter(Boolean)
    .join(" ");
}
