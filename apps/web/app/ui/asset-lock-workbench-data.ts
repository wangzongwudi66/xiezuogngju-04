export type AssetChangeType = "new" | "modified" | "removed" | "reused";
export type AssetType = "character" | "scene" | "prop" | "vehicle" | "effect";
export type AssetConfirmation = "pending" | "confirmed" | "returned";
export type AssetReviewStatus = "writer_pending" | "production_pending" | "ready_to_lock" | "disputed" | "needs_info" | "locked";
export type AssetRisk = "normal" | "attention" | "high";

export type AssetLockChangeItem = {
  id: string;
  assetName: string;
  assetType: AssetType;
  changeType: AssetChangeType;
  episodeNos: number[];
  owner: string;
  writerConfirmation: AssetConfirmation;
  productionConfirmation: AssetConfirmation;
  reviewStatus: AssetReviewStatus;
  risk: AssetRisk;
  before: string;
  after: string;
  writerNote: string;
  productionNote: string;
  sourceParagraph: string;
  discussion: string[];
};

export type AssetLockFilters = {
  episode: string;
  owner: string;
  risk: "all" | AssetRisk;
  status: "all" | AssetReviewStatus;
  type: "all" | AssetType;
};

const mockAssetChanges: AssetLockChangeItem[] = [
  {
    id: "asset-miner-li-new-scar",
    assetName: "李砚旧伤妆",
    assetType: "character",
    changeType: "modified",
    episodeNos: [3, 4, 5],
    owner: "周编剧",
    writerConfirmation: "confirmed",
    productionConfirmation: "pending",
    reviewStatus: "production_pending",
    risk: "attention",
    before: "角色常规矿工妆，无明确外伤标记。",
    after: "左颧保留旧伤疤，进入矿洞后疤痕沾灰但不能完全遮盖。",
    writerNote: "旧伤是第 5 集反转线索，镜头不需要特写，但必须持续存在。",
    productionNote: "需要补一张正脸和 45 度侧脸参考，避免后续镜头不连续。",
    sourceParagraph: "第 5 集 12 场：李砚抹掉脸上的煤灰，旧疤露出，杜衡认出当年矿难幸存者。",
    discussion: ["林主编：旧伤不是新增设定，是前文线索回收。", "沈制作 A：请确认疤痕位置是否左右固定。"]
  },
  {
    id: "asset-mine-elevator",
    assetName: "北井升降笼",
    assetType: "scene",
    changeType: "new",
    episodeNos: [3, 5],
    owner: "沈制作 A",
    writerConfirmation: "pending",
    productionConfirmation: "pending",
    reviewStatus: "writer_pending",
    risk: "normal",
    before: "无独立资产，旧稿只写“矿井入口”。",
    after: "新增可开合铁笼升降机，锈蚀、手动拉闸，承担第 5 集困局空间。",
    writerNote: "制作侧提出可复用为第 8 集逃生段落，请编剧确认是否影响调度。",
    productionNote: "可沿用现有矿井材质库，重点补笼门结构和拉闸动画。",
    sourceParagraph: "第 3 集 4 场：升降笼卡在半空，铁链抖动，众人第一次听见井底敲击声。",
    discussion: ["陈统筹：确认是否进入资产池主资产。", "周编剧：第 8 集可能复用，但本次先锁第 3、5 集。"]
  },
  {
    id: "asset-red-lamp",
    assetName: "红色安全灯",
    assetType: "prop",
    changeType: "modified",
    episodeNos: [4],
    owner: "周编剧",
    writerConfirmation: "confirmed",
    productionConfirmation: "confirmed",
    reviewStatus: "ready_to_lock",
    risk: "normal",
    before: "普通手电筒，白光。",
    after: "改为红色安全灯，低照度，靠近瓦斯区时闪烁。",
    writerNote: "红光用于区分现实段落和回忆段落，不能改回白光。",
    productionNote: "灯光规则已确认，后续分镜按红色安全灯执行。",
    sourceParagraph: "第 4 集 9 场：红灯闪了两下，杜衡停步，示意所有人关掉明火。",
    discussion: ["沈制作 A：灯光材质可复用。", "林主编：规则确认。"]
  },
  {
    id: "asset-old-map",
    assetName: "旧矿区手绘图",
    assetType: "prop",
    changeType: "new",
    episodeNos: [5, 6],
    owner: "林主编",
    writerConfirmation: "confirmed",
    productionConfirmation: "returned",
    reviewStatus: "needs_info",
    risk: "attention",
    before: "旧稿没有地图道具。",
    after: "新增一张折叠手绘图，标出北井、废弃风道和禁入区。",
    writerNote: "地图只露出局部，不要提前暴露第 6 集禁入区全貌。",
    productionNote: "缺少地图可见范围和文字内容，需要补充局部图示。",
    sourceParagraph: "第 5 集 18 场：杜衡把地图压在灯下，只露出北井到风道的一段线。",
    discussion: ["王制作 B：如果看不清文字，可以只做线条和旧纸质感。", "林主编：同意，但禁入区名称不能出现。"]
  },
  {
    id: "asset-drone-vehicle",
    assetName: "巡检无人车",
    assetType: "vehicle",
    changeType: "removed",
    episodeNos: [3],
    owner: "陈统筹",
    writerConfirmation: "confirmed",
    productionConfirmation: "confirmed",
    reviewStatus: "ready_to_lock",
    risk: "normal",
    before: "第 3 集原有巡检无人车进入矿道探路。",
    after: "删除无人车，改为人工探路以强化人物压力。",
    writerNote: "删除后不影响第 9 集无人车首次登场。",
    productionNote: "已从本次资产清单移除，保留后续集资产规划。",
    sourceParagraph: "第 3 集 6 场：删除无人车探路段，改为李砚独自进入支道。",
    discussion: ["陈统筹：删除只针对第 3 集，不取消后续资产。"]
  },
  {
    id: "asset-dust-effect",
    assetName: "井底粉尘爆闪",
    assetType: "effect",
    changeType: "new",
    episodeNos: [5],
    owner: "沈制作 A",
    writerConfirmation: "returned",
    productionConfirmation: "pending",
    reviewStatus: "disputed",
    risk: "high",
    before: "旧稿为普通塌方扬尘。",
    after: "新增红灯下粉尘爆闪，持续 2 秒，作为塌方前兆。",
    writerNote: "担心爆闪过早暗示事故，需确认是否只在制作表现层处理。",
    productionNote: "镜头节奏依赖该效果，若取消需要调整后 3 个镜头。",
    sourceParagraph: "第 5 集 21 场：红灯忽暗，粉尘像火花一样闪过，随后支架断裂。",
    discussion: ["周编剧：不要像爆炸特效。", "沈制作 A：可降级为灯光扫过粉尘。", "陈统筹：待双方确认风险等级。"]
  },
  {
    id: "asset-mine-uniform",
    assetName: "矿山制服",
    assetType: "character",
    changeType: "reused",
    episodeNos: [3, 4, 5, 6],
    owner: "王制作 B",
    writerConfirmation: "confirmed",
    productionConfirmation: "confirmed",
    reviewStatus: "locked",
    risk: "normal",
    before: "M1 已定版矿山制服。",
    after: "本次沿用，不新增破损版；只在镜头内做灰尘覆盖。",
    writerNote: "沿用即可，不要做新制服款式。",
    productionNote: "已定版并归档到资产库。",
    sourceParagraph: "第 3-6 集多场沿用矿山制服，表现层按场景增加煤灰。",
    discussion: ["陈统筹：沿用项已锁定，不进入新增制作任务。"]
  }
];

export function getMockAssetChanges() {
  return mockAssetChanges.map((item) => ({ ...item, episodeNos: [...item.episodeNos], discussion: [...item.discussion] }));
}

export function filterAssetChanges(items: AssetLockChangeItem[], filters: AssetLockFilters) {
  return items.filter((item) => {
    const matchesEpisode = filters.episode === "all" || item.episodeNos.includes(Number(filters.episode));
    const matchesType = filters.type === "all" || item.assetType === filters.type;
    const matchesStatus = filters.status === "all" || item.reviewStatus === filters.status;
    const matchesOwner = filters.owner === "all" || item.owner === filters.owner;
    const matchesRisk = filters.risk === "all" || item.risk === filters.risk;

    return matchesEpisode && matchesType && matchesStatus && matchesOwner && matchesRisk;
  });
}

export function summarizeAssetLock(items: AssetLockChangeItem[]) {
  const writerPendingCount = items.filter((item) => item.writerConfirmation !== "confirmed").length;
  const productionPendingCount = items.filter((item) => item.productionConfirmation !== "confirmed").length;
  const disputeCount = items.filter((item) => item.reviewStatus === "disputed").length;
  const needsInfoCount = items.filter((item) => item.reviewStatus === "needs_info").length;
  const readyCount = items.filter((item) => item.reviewStatus === "ready_to_lock" || item.reviewStatus === "locked").length;
  const canLock = writerPendingCount === 0 && productionPendingCount === 0 && disputeCount === 0 && needsInfoCount === 0;

  return {
    canLock,
    disputeCount,
    needsInfoCount,
    productionPendingCount,
    readyCount,
    totalCount: items.length,
    writerPendingCount
  };
}

export function getNextAssetLockOwner(items: AssetLockChangeItem[]) {
  if (items.some((item) => item.reviewStatus === "disputed")) {
    return "统筹协调争议项";
  }

  if (items.some((item) => item.writerConfirmation !== "confirmed")) {
    return "编剧确认";
  }

  if (items.some((item) => item.productionConfirmation !== "confirmed")) {
    return "制作确认";
  }

  if (items.some((item) => item.reviewStatus === "needs_info")) {
    return "负责人补资料";
  }

  return "统筹定版";
}
