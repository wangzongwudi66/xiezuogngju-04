import { describe, expect, it } from "vitest";
import { buildMockAssetDecisionTimelineViewModel } from "./asset-decision-timeline-data";
import { buildTimelineResetKey, getDecisionClipClassName } from "./asset-decision-timeline-view";

describe("asset decision timeline component helpers", () => {
  it("includes scope-muted in clip classes for empty creator scope clips", () => {
    const viewModel = buildMockAssetDecisionTimelineViewModel({
      assignedEpisodeNos: [],
      projectId: "project-jincheng",
      viewerRole: "creator",
      viewerUserId: "user-creator-a"
    });
    const clipClasses = viewModel.tracks
      .flatMap((track) => track.clips)
      .map((clip) => getDecisionClipClassName({ clip, focusedClipIds: new Set(), selectedClipId: "" }));

    expect(clipClasses).not.toEqual([]);
    expect(clipClasses.every((className) => className.includes("scope-muted"))).toBe(true);
  });

  it("changes reset keys when role scope inputs change", () => {
    const firstKey = buildTimelineResetKey({
      actorRole: "creator",
      actorUserId: "user-creator-a",
      assignedEpisodeNos: [7, 8, 9],
      defaultQueueTag: "affects_my_episodes",
      projectId: "project-jincheng",
      selectedClipId: "clip-scar"
    });
    const secondKey = buildTimelineResetKey({
      actorRole: "creator",
      actorUserId: "user-creator-a",
      assignedEpisodeNos: [],
      defaultQueueTag: "due_today",
      projectId: "project-jincheng",
      selectedClipId: undefined
    });

    expect(firstKey).not.toBe(secondKey);
  });

  it("changes reset keys when the view-model source changes", () => {
    const demoKey = buildTimelineResetKey({
      actorRole: "coordinator",
      actorUserId: "user-owner",
      defaultQueueTag: "due_today",
      projectId: "project-jincheng",
      selectedClipId: "clip-map",
      viewModelSourceKey: "demo"
    });
    const realKey = buildTimelineResetKey({
      actorRole: "coordinator",
      actorUserId: "user-owner",
      defaultQueueTag: "due_today",
      projectId: "project-jincheng",
      selectedClipId: "clip-map",
      viewModelSourceKey: "real:delivery-current"
    });

    expect(demoKey).not.toBe(realKey);
  });
});
