import { describe, expect, it } from "vitest";
import {
  buildMockAssetDecisionTimelineViewModel,
  filterDecisionItemsByQueue,
  findDecisionGroupItems,
  getEpisodeWindowNos,
  mapClipToEpisodeGrid,
  summarizeDecisionGroups
} from "./asset-decision-timeline-data";

describe("asset decision timeline data helpers", () => {
  it("builds a creator-scoped work window instead of a full-series wall", () => {
    const viewModel = buildMockAssetDecisionTimelineViewModel({
      projectId: "project-jincheng",
      viewerRole: "creator",
      viewerUserId: "user-creator-a"
    });

    expect(viewModel.viewMode).toBe("work_window");
    expect(viewModel.episodeWindow).toEqual({ from: 6, to: 15 });
    expect(viewModel.creatorAssignedWindow?.episodeNos).toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(viewModel.decisionQueue.every((item) => item.queueTags.includes("affects_my_episodes"))).toBe(true);
    expect(viewModel.decisionQueue.some((item) => item.kind === "conflict")).toBe(true);
  });

  it("uses assigned episodes when the dashboard provides a creator scope", () => {
    const viewModel = buildMockAssetDecisionTimelineViewModel({
      assignedEpisodeNos: [8, 1, 2, 3, 4, 5, 6, 7],
      projectId: "project-tide",
      viewerRole: "creator",
      viewerUserId: "user-creator-a"
    });

    expect(viewModel.episodeWindow).toEqual({ from: 1, to: 10 });
    expect(viewModel.creatorAssignedWindow?.episodeNos).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(viewModel.decisionQueue.every((item) => item.episodeNos.some((episodeNo) => episodeNo <= 8))).toBe(true);
    expect(viewModel.decisionQueue.every((item) => item.projectId === "project-tide")).toBe(true);
    expect(viewModel.sourceExcerpts.every((excerpt) => excerpt.projectId === "project-tide")).toBe(true);
  });

  it("maps timeline clips to the visible episode grid", () => {
    expect(mapClipToEpisodeGrid({ episodeFrom: 8, episodeTo: 13 }, { from: 7, to: 13 })).toEqual({
      gridColumn: "2 / 8",
      visibleEpisodeFrom: 8,
      visibleEpisodeTo: 13
    });
    expect(mapClipToEpisodeGrid({ episodeFrom: 5, episodeTo: 8 }, { from: 7, to: 13 })).toEqual({
      gridColumn: "1 / 3",
      visibleEpisodeFrom: 7,
      visibleEpisodeTo: 8
    });
    expect(mapClipToEpisodeGrid({ episodeFrom: 12, episodeTo: 15 }, { from: 7, to: 13 })).toEqual({
      gridColumn: "6 / 8",
      visibleEpisodeFrom: 12,
      visibleEpisodeTo: 13
    });
    expect(mapClipToEpisodeGrid({ episodeFrom: 7, episodeTo: 7 }, { from: 7, to: 13 })).toEqual({
      gridColumn: "1 / 2",
      visibleEpisodeFrom: 7,
      visibleEpisodeTo: 7
    });
    expect(mapClipToEpisodeGrid({ episodeFrom: 1, episodeTo: 3 }, { from: 7, to: 13 })).toBeNull();
    expect(mapClipToEpisodeGrid({ episodeFrom: 14, episodeTo: 16 }, { from: 7, to: 13 })).toBeNull();
  });

  it("filters queue decisions and summarizes by decision meaning", () => {
    const viewModel = buildMockAssetDecisionTimelineViewModel({
      projectId: "project-jincheng",
      viewerRole: "coordinator",
      viewerUserId: "user-owner"
    });

    expect(getEpisodeWindowNos(viewModel.episodeWindow)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(filterDecisionItemsByQueue(viewModel.decisionQueue, "conflicts")).toHaveLength(1);
    expect(summarizeDecisionGroups(viewModel.decisionQueue)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "需编剧定口径", count: 1, decisionItemIds: ["decision-scar-writer"] }),
        expect.objectContaining({ label: "资产冲突", count: 1, risk: "high" })
      ])
    );
  });

  it("keeps decision groups connected to their source decisions and summaries", () => {
    const viewModel = buildMockAssetDecisionTimelineViewModel({
      projectId: "project-jincheng",
      viewerRole: "creator",
      viewerUserId: "user-creator-a"
    });
    const conflictGroup = summarizeDecisionGroups(viewModel.decisionQueue).find((group) => group.kind === "conflict");

    expect(conflictGroup).toEqual(
      expect.objectContaining({
        label: "资产冲突",
        count: 1,
        decisionItemIds: ["decision-dust-conflict"],
        episodeNos: [12, 13],
        risk: "high"
      })
    );
    expect(conflictGroup?.currentSummary).toContain("粉尘");
    expect(conflictGroup?.previousSummary).toContain("普通塌方扬尘");
    expect(findDecisionGroupItems(viewModel, conflictGroup?.decisionItemIds ?? []).map((item) => item.id)).toEqual([
      "decision-dust-conflict"
    ]);
  });

  it("keeps ghost comparison aligned to the previous visible range", () => {
    const viewModel = buildMockAssetDecisionTimelineViewModel({
      projectId: "project-jincheng",
      viewerRole: "creator",
      viewerUserId: "user-creator-a"
    });
    const scarClip = viewModel.tracks.flatMap((track) => track.clips).find((clip) => clip.id === "clip-scar");

    expect(scarClip?.ghost?.previousEpisodeFrom).toBe(10);
    expect(scarClip?.ghost?.previousEpisodeTo).toBe(13);
    expect(mapClipToEpisodeGrid({ episodeFrom: 10, episodeTo: 13 }, viewModel.episodeWindow)).toEqual({
      gridColumn: "5 / 9",
      visibleEpisodeFrom: 10,
      visibleEpisodeTo: 13
    });
  });

  it("keeps a removed-asset sample visible for change marker acceptance", () => {
    const viewModel = buildMockAssetDecisionTimelineViewModel({
      projectId: "project-jincheng",
      viewerRole: "coordinator",
      viewerUserId: "user-owner"
    });
    const removedClip = viewModel.tracks.flatMap((track) => track.clips).find((clip) => clip.id === "clip-fan");
    const removedDecision = viewModel.decisionQueue.find((item) => item.id === "decision-fan-removed");

    expect(removedClip?.ghost?.changeMarkers).toContain("removed");
    expect(removedDecision?.kind).toBe("removed_asset");
  });
});
