import { describe, expect, it } from "vitest";
import { buildDeliveryPackageDraftFromParsed, buildTextDeliveryPackageDraft } from "./delivery-text-parser";

describe("M2 text delivery parser adapter", () => {
  it("builds a delivery draft from pasted Word text", () => {
    const result = buildTextDeliveryPackageDraft({
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-2",
      rawText: "第 1 集 开场\n场 1-1 金城矿山 日 外\n正文一\n第 2 集 追踪\n正文二"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.draft).toMatchObject({
      type: "range",
      declaredEpisodeFrom: 1,
      declaredEpisodeTo: 2,
      sourceFileName: "pasted-word-text.txt",
      confirmedEpisodeNos: [1, 2]
    });
    expect(result.draft.episodes).toHaveLength(2);
  });

  it("keeps out-of-range parse warnings while expanding the draft range for store validation", () => {
    const result = buildTextDeliveryPackageDraft({
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-2",
      rawText: "第 1 集\n正文一\n第 3 集\n正文三"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.draft.declaredEpisodeFrom).toBe(1);
    expect(result.draft.declaredEpisodeTo).toBe(3);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "episode_out_of_declared_range",
        episodeNo: 3
      })
    );
  });

  it("returns manual single-episode fallback guidance when text cannot be segmented", () => {
    const result = buildTextDeliveryPackageDraft({
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      rawText: "场 1-1 金城矿山 日 外\n没有集标题"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "episode_boundary_not_found"
      })
    );
    expect(result.remedies.some((item) => item.includes("手动") || item.includes("纯文本"))).toBe(true);
  });

  it("builds a delivery draft from a parsed docx result", () => {
    const result = buildDeliveryPackageDraftFromParsed({
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      sourceFileName: "delivery-1-2.docx",
      parsed: {
        ok: true,
        source: "docx",
        declaredRange: { from: 1, to: 2 },
        warnings: [],
        errors: [],
        episodes: [
          { episodeNo: 1, title: "第 1 集", content: "正文一", warnings: [] },
          { episodeNo: 2, title: "第 2 集", content: "正文二", warnings: [] }
        ]
      }
    });

    expect(result.draft).toMatchObject({
      type: "range",
      declaredEpisodeFrom: 1,
      declaredEpisodeTo: 2,
      sourceFileName: "delivery-1-2.docx",
      title: "Word 解析：第 1-2 集交稿",
      confirmedEpisodeNos: [1, 2]
    });
  });
});
