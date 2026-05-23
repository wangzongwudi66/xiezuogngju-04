import { describe, expect, it } from "vitest";
import { extractAssetLockCandidatesFromDeliveryEpisodes } from "./asset-lock-candidates";

describe("asset lock candidate extraction", () => {
  it("extracts conservative asset candidates from delivery package episodes", () => {
    const candidates = extractAssetLockCandidatesFromDeliveryEpisodes({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-jc-3-5",
      createdByUserId: "user-head-writer",
      episodes: [
        {
          episodeNo: 3,
          content: "第 3 集\n矿井入口新增升降笼，众人第一次进入北井。"
        },
        {
          episodeNo: 4,
          content: "第 4 集\n红色安全灯沿用，制服沾满煤灰。"
        },
        {
          episodeNo: 5,
          content: "第 5 集\n地图展开，粉尘爆闪作为塌方前兆。"
        }
      ]
    });

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetName: "场景",
          assetType: "scene",
          changeType: "new",
          episodeNos: [3],
          risk: "normal"
        }),
        expect.objectContaining({
          assetName: "升降笼",
          assetType: "scene",
          changeType: "new",
          episodeNos: [3],
          risk: "attention"
        }),
        expect.objectContaining({
          assetName: "安全灯",
          assetType: "prop",
          changeType: "reused",
          episodeNos: [4]
        }),
        expect.objectContaining({
          assetName: "角色/妆造",
          assetType: "character",
          changeType: "reused",
          episodeNos: [4]
        }),
        expect.objectContaining({
          assetName: "粉尘爆闪",
          assetType: "effect",
          episodeNos: [5],
          risk: "high"
        })
      ])
    );
  });

  it("deduplicates the same asset name within one delivery package", () => {
    const candidates = extractAssetLockCandidatesFromDeliveryEpisodes({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-jc-3-5",
      createdByUserId: "user-head-writer",
      episodes: [
        { episodeNo: 3, content: "第 3 集\n新增地图，道具组需要确认。" },
        { episodeNo: 5, content: "第 5 集\n地图复用，但不要提前露出禁入区。" }
      ]
    });
    const mapCandidate = candidates.find((candidate) => candidate.assetName === "地图");

    expect(candidates.filter((candidate) => candidate.assetName === "地图")).toHaveLength(1);
    expect(mapCandidate?.episodeNos).toEqual([3, 5]);
    expect(mapCandidate?.matchedKeywords).toEqual(["地图"]);
  });

  it("returns AssetLockRecordInput-compatible candidates", () => {
    const [candidate] = extractAssetLockCandidatesFromDeliveryEpisodes({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-jc-3",
      createdByUserId: "user-head-writer",
      episodes: [{ episodeNo: 3, content: "第 3 集\n无人车删除，改成人工探路。" }]
    });

    expect(candidate).toMatchObject({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-jc-3",
      createdByUserId: "user-head-writer",
      assetName: "车辆/无人车",
      assetType: "vehicle",
      changeType: "removed",
      episodeNos: [3],
      risk: "normal"
    });
    expect(candidate.writerNote).toContain("规则提取候选");
    expect(candidate.productionNote).toContain("制作侧确认");
  });
});
