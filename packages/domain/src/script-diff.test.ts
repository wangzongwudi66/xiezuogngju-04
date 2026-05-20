import { describe, expect, it } from "vitest";
import { diffEpisodeScript } from "./script-diff";

describe("script diff", () => {
  it("returns line-level added, removed, changed blocks with a creator-facing summary", () => {
    const oldContent = [
      "Scene 1: A finds the old camera.",
      "A: We should leave before sunrise.",
      "Scene 2: B hides the card.",
      "End beat: the door opens."
    ].join("\n");
    const newContent = [
      "Scene 1: A finds the old camera.",
      "A: We should leave before midnight.",
      "Scene 2: B hides the card.",
      "New beat: the phone rings.",
      "End beat: the window opens."
    ].join("\n");

    const diff = diffEpisodeScript(oldContent, newContent);

    expect(diff.changed).toEqual([
      {
        id: "changed-2-2",
        granularity: "line",
        oldIndex: 2,
        newIndex: 2,
        oldText: "A: We should leave before sunrise.",
        newText: "A: We should leave before midnight."
      },
      {
        id: "changed-4-5",
        granularity: "line",
        oldIndex: 4,
        newIndex: 5,
        oldText: "End beat: the door opens.",
        newText: "End beat: the window opens."
      }
    ]);
    expect(diff.added).toEqual([
      {
        id: "added-4",
        granularity: "line",
        oldIndex: null,
        newIndex: 4,
        text: "New beat: the phone rings."
      }
    ]);
    expect(diff.removed).toEqual([]);
    expect(diff.summary).toMatchObject({
      hasChanges: true,
      addedCount: 1,
      removedCount: 0,
      changedCount: 2,
      totalChanges: 3
    });
    expect(diff.summary.headline).toBe("本集有新改动：新增 1 行，删除 0 行，修改 2 行。");
    expect(diff.summary.details).toContain("新增第 4 行：New beat: the phone rings.");
  });

  it("returns paragraph-level changes when scripts contain blank-line paragraph breaks", () => {
    const oldContent = [
      "Opening paragraph.\nA enters the room.",
      "Middle paragraph.\nB keeps the secret.",
      "Final paragraph.\nThey hear footsteps."
    ].join("\n\n");
    const newContent = [
      "Opening paragraph.\nA enters the room.",
      "Middle paragraph.\nB reveals the secret.",
      "Final paragraph.\nThey hear footsteps."
    ].join("\n\n");

    const diff = diffEpisodeScript(oldContent, newContent);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([
      {
        id: "changed-2-2",
        granularity: "paragraph",
        oldIndex: 2,
        newIndex: 2,
        oldText: "Middle paragraph.\nB keeps the secret.",
        newText: "Middle paragraph.\nB reveals the secret."
      }
    ]);
    expect(diff.summary.headline).toBe("本集有新改动：新增 0 段，删除 0 段，修改 1 段。");
  });

  it("reports no new changes for identical episode scripts", () => {
    const diff = diffEpisodeScript("Line 1\nLine 2", "Line 1\nLine 2");

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.summary).toEqual({
      hasChanges: false,
      addedCount: 0,
      removedCount: 0,
      changedCount: 0,
      totalChanges: 0,
      headline: "本集暂无新改动",
      details: ["剧本文本与上一版一致。"]
    });
  });

  it("supports retroactive submissions where only episodes 11 and 12 changed out of 20", () => {
    const oldSubmissions = Array.from({ length: 20 }, (_, index) => {
      const episodeNo = index + 1;
      return {
        episodeNo,
        content: [`Episode ${episodeNo}`, "Opening beat.", "Closing beat."].join("\n")
      };
    });
    const newSubmissions = oldSubmissions.map((submission) => {
      if (submission.episodeNo === 11) {
        return {
          ...submission,
          content: [`Episode ${submission.episodeNo}`, "Opening beat with new clue.", "Closing beat."].join("\n")
        };
      }

      if (submission.episodeNo === 12) {
        return {
          ...submission,
          content: [`Episode ${submission.episodeNo}`, "Opening beat.", "Closing beat.", "New tag scene."].join("\n")
        };
      }

      return submission;
    });

    const changedEpisodeNos = newSubmissions
      .map((submission) => ({
        episodeNo: submission.episodeNo,
        diff: diffEpisodeScript(
          oldSubmissions[submission.episodeNo - 1].content,
          submission.content
        )
      }))
      .filter((item) => item.diff.summary.hasChanges)
      .map((item) => item.episodeNo);

    expect(changedEpisodeNos).toEqual([11, 12]);
  });
});
