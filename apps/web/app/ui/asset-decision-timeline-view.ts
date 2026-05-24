import type { ProjectRole } from "@aigc/domain";
import type { AssetTimelineClip, AssetTimelineQueueTag } from "./asset-decision-timeline-data";

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
