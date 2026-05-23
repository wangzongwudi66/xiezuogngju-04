import type {
  AssetChangeType,
  AssetLockRecordCandidate,
  AssetRiskLevel,
  AssetType,
  DeliveryPackageEpisode
} from "./types";

export interface ExtractAssetLockCandidatesInput {
  projectId: string;
  deliveryPackageId: string;
  createdByUserId: string;
  episodes: Pick<DeliveryPackageEpisode, "episodeNo" | "content">[];
}

type AssetKeywordRule = {
  assetName: string;
  assetType: AssetType;
  keywords: string[];
  risk?: AssetRiskLevel;
};

const assetKeywordRules: AssetKeywordRule[] = [
  {
    assetName: "角色/妆造",
    assetType: "character",
    keywords: ["角色", "妆造", "制服"]
  },
  {
    assetName: "场景",
    assetType: "scene",
    keywords: ["场景", "矿井", "入口"]
  },
  {
    assetName: "升降笼",
    assetType: "scene",
    keywords: ["升降笼"]
  },
  {
    assetName: "地图",
    assetType: "prop",
    keywords: ["地图"]
  },
  {
    assetName: "安全灯",
    assetType: "prop",
    keywords: ["安全灯"]
  },
  {
    assetName: "车辆/无人车",
    assetType: "vehicle",
    keywords: ["车辆", "无人车"]
  },
  {
    assetName: "粉尘爆闪",
    assetType: "effect",
    keywords: ["特效", "粉尘", "爆闪"],
    risk: "high"
  }
];

export function extractAssetLockCandidatesFromDeliveryEpisodes(
  input: ExtractAssetLockCandidatesInput
): AssetLockRecordCandidate[] {
  const candidatesByName = new Map<string, AssetLockRecordCandidate>();

  for (const episode of input.episodes) {
    for (const rule of assetKeywordRules) {
      const matchedKeywords = rule.keywords.filter((keyword) => episode.content.includes(keyword));

      if (matchedKeywords.length === 0) {
        continue;
      }

      const existing = candidatesByName.get(rule.assetName);
      if (existing) {
        existing.episodeNos = mergeEpisodeNos(existing.episodeNos, [episode.episodeNo]);
        existing.matchedKeywords = mergeStrings(existing.matchedKeywords, matchedKeywords);
        existing.risk = mergeRisk(existing.risk ?? "normal", rule.risk ?? riskFromKeywords(matchedKeywords));
        continue;
      }

      const risk = rule.risk ?? riskFromKeywords(matchedKeywords);
      candidatesByName.set(rule.assetName, {
        projectId: input.projectId,
        deliveryPackageId: input.deliveryPackageId,
        episodeNos: [episode.episodeNo],
        assetName: rule.assetName,
        assetType: rule.assetType,
        changeType: inferChangeType(episode.content, matchedKeywords),
        createdByUserId: input.createdByUserId,
        risk,
        writerNote: buildWriterNote(rule.assetName, matchedKeywords),
        productionNote: buildProductionNote(rule.assetName, risk),
        matchedKeywords
      });
    }
  }

  return Array.from(candidatesByName.values()).sort((a, b) => a.assetName.localeCompare(b.assetName, "zh-CN"));
}

function inferChangeType(content: string, matchedKeywords: string[]): AssetChangeType {
  if (content.includes("删除") || content.includes("移除") || content.includes("取消")) {
    return "removed";
  }

  if (content.includes("沿用") || content.includes("复用")) {
    return "reused";
  }

  if (content.includes("新增") || content.includes("第一次") || content.includes("首次")) {
    return "new";
  }

  if (matchedKeywords.some((keyword) => keyword === "制服")) {
    return "reused";
  }

  return "modified";
}

function riskFromKeywords(keywords: string[]): AssetRiskLevel {
  if (keywords.some((keyword) => keyword === "爆闪" || keyword === "粉尘" || keyword === "特效")) {
    return "high";
  }

  if (keywords.some((keyword) => keyword === "妆造" || keyword === "地图" || keyword === "升降笼")) {
    return "attention";
  }

  return "normal";
}

function mergeRisk(current: AssetRiskLevel, incoming: AssetRiskLevel): AssetRiskLevel {
  const order: AssetRiskLevel[] = ["normal", "attention", "high"];
  return order.indexOf(incoming) > order.indexOf(current) ? incoming : current;
}

function mergeEpisodeNos(current: number[], incoming: number[]) {
  return Array.from(new Set([...current, ...incoming])).sort((a, b) => a - b);
}

function mergeStrings(current: string[], incoming: string[]) {
  return Array.from(new Set([...current, ...incoming]));
}

function buildWriterNote(assetName: string, keywords: string[]) {
  return `规则提取候选：${assetName}。命中关键词：${keywords.join("、")}。请编剧确认是否为本次交稿的有效资产变更。`;
}

function buildProductionNote(assetName: string, risk: AssetRiskLevel) {
  return risk === "high"
    ? `规则提取候选：${assetName}。该项包含高风险表现关键词，制作侧需确认实现方式和影响镜头。`
    : `规则提取候选：${assetName}。请制作侧确认是否需要新增、修改或沿用资产。`;
}
