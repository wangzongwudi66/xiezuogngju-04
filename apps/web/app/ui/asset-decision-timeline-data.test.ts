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

  it("maps timeline clips to the visible episode grid", () => {
    expect(mapClipToEpisodeGrid({ episodeFrom: 8, episodeTo: 13 }, { from: 7, to: 13 })).toEqual({
      gridColumn: "2 / 8",
      visibleEpisodeFrom: 8,
      visibleEpisodeTo: 13
    });
    expect(mapClipToEpisodeGrid({ episodeFrom: 1, episodeTo: 3 }, { from: 7, to: 13 })).toBeNull();
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
});
