"use client";

import {
  AlertTriangle,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileWarning,
  Filter,
  Flag,
  Layers3,
  LockKeyhole,
  MessageSquare,
  RotateCcw,
  Search,
  ShieldCheck,
  UserCheck
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  filterAssetChanges,
  getMockAssetChanges,
  getNextAssetLockOwner,
  summarizeAssetLock
} from "./asset-lock-workbench-data";
import type {
  AssetChangeType,
  AssetLockChangeItem,
  AssetConfirmation,
  AssetLockFilters,
  AssetReviewStatus,
  AssetRisk,
  AssetType
} from "./asset-lock-workbench-data";

type AssetLockPackage = {
  id: string;
  title: string;
  declaredEpisodeFrom: number;
  declaredEpisodeTo: number;
  confirmedEpisodeNos: number[];
  status: string;
};

const assetTypeLabels: Record<AssetType, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  vehicle: "载具",
  effect: "特效"
};

const changeTypeLabels: Record<AssetChangeType, string> = {
  new: "新增",
  modified: "修改",
  removed: "删除",
  reused: "沿用"
};

const confirmationLabels: Record<AssetConfirmation, string> = {
  pending: "待确认",
  confirmed: "已确认",
  returned: "已退回"
};

const reviewStatusLabels: Record<AssetReviewStatus, string> = {
  writer_pending: "待编剧确认",
  production_pending: "待制作确认",
  ready_to_lock: "可定版",
  disputed: "有争议",
  needs_info: "需补资料",
  locked: "已定版"
};

const riskLabels: Record<AssetRisk, string> = {
  normal: "常规",
  attention: "需关注",
  high: "高风险"
};

const emptyFilters: AssetLockFilters = {
  episode: "all",
  owner: "all",
  risk: "all",
  status: "all",
  type: "all"
};

export function AssetLockWorkbench({
  activeDeliveryPackage,
  deliveryPackages,
  onOpenDeliveryCenter,
  projectName
}: {
  activeDeliveryPackage: AssetLockPackage | null;
  deliveryPackages: AssetLockPackage[];
  onOpenDeliveryCenter: () => void;
  projectName: string;
}) {
  const [items, setItems] = useState(() => getMockAssetChanges());
  const [filters, setFilters] = useState<AssetLockFilters>(emptyFilters);
  const [selectedAssetId, setSelectedAssetId] = useState(items[0]?.id ?? "");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const packageForView = activeDeliveryPackage ?? deliveryPackages[0] ?? null;
  const filteredItems = useMemo(() => filterAssetChanges(items, filters), [filters, items]);
  const summary = useMemo(() => summarizeAssetLock(items), [items]);
  const selectedAsset = items.find((item) => item.id === selectedAssetId) ?? filteredItems[0] ?? items[0];
  const episodeOptions = Array.from(new Set(items.flatMap((item) => item.episodeNos))).sort((a, b) => a - b);
  const ownerOptions = Array.from(new Set(items.map((item) => item.owner))).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const selectedPackageEpisodes = packageForView?.confirmedEpisodeNos.length
    ? packageForView.confirmedEpisodeNos
    : episodeOptions;

  function updateSelectedAssets(patch: Partial<AssetLockChangeItem>) {
    if (selectedIds.length === 0) {
      return;
    }

    setItems((current) => current.map((item) => (selectedIds.includes(item.id) ? { ...item, ...patch } : item)));
    setSelectedIds([]);
  }

  function updateAsset(assetId: string, patch: Partial<AssetLockChangeItem>) {
    setItems((current) => current.map((item) => (item.id === assetId ? { ...item, ...patch } : item)));
  }

  return (
    <section className="panel module-panel asset-lock-workbench">
      <div className="asset-lock-top">
        <div>
          <span>{projectName} · 资产核对闭环</span>
          <h2>资产核对与定版工作台</h2>
          <p>{packageForView ? packageForView.title : "演示交稿包"} · 涉及第 {selectedPackageEpisodes.join("、")} 集</p>
        </div>
        <button className="secondary-button" onClick={onOpenDeliveryCenter} type="button">
          回到交稿中心
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="asset-lock-overview">
        <AssetMetric label="资产变更" value={summary.totalCount.toString()} />
        <AssetMetric label="待编剧确认" tone={summary.writerPendingCount ? "amber" : "green"} value={summary.writerPendingCount.toString()} />
        <AssetMetric label="待制作确认" tone={summary.productionPendingCount ? "amber" : "green"} value={summary.productionPendingCount.toString()} />
        <AssetMetric label="争议/缺资料" tone={summary.disputeCount + summary.needsInfoCount ? "red" : "green"} value={`${summary.disputeCount}/${summary.needsInfoCount}`} />
        <div className={`asset-lock-status ${summary.canLock ? "ready" : "blocked"}`}>
          <LockKeyhole size={18} />
          <div>
            <strong>{summary.canLock ? "可以定版" : "暂不可定版"}</strong>
            <span>下一步：{getNextAssetLockOwner(items)}</span>
          </div>
        </div>
      </div>

      <div className="asset-lock-actions">
        <span>{selectedIds.length > 0 ? `已选择 ${selectedIds.length} 项` : "可批量处理筛选后的资产项"}</span>
        <button className="secondary-button compact" disabled={selectedIds.length === 0} onClick={() => updateSelectedAssets({ writerConfirmation: "confirmed" })} type="button">
          <UserCheck size={14} />
          批量编剧确认
        </button>
        <button className="secondary-button compact" disabled={selectedIds.length === 0} onClick={() => updateSelectedAssets({ reviewStatus: "needs_info" })} type="button">
          <FileWarning size={14} />
          标记需补充
        </button>
        <button
          className="secondary-button compact"
          disabled={selectedIds.length === 0}
          onClick={() => updateSelectedAssets({ productionConfirmation: "confirmed", reviewStatus: "ready_to_lock" })}
          type="button"
        >
          <ClipboardCheck size={14} />
          制作确认完成
        </button>
        <button className="primary-button" disabled={!summary.canLock} type="button">
          <LockKeyhole size={15} />
          统筹定版
        </button>
      </div>

      <div className="asset-lock-layout">
        <aside className="asset-filter-panel">
          <div className="asset-filter-head">
            <Filter size={16} />
            <strong>筛选</strong>
            <button className="text-link" onClick={() => setFilters(emptyFilters)} type="button">
              重置
            </button>
          </div>
          <label>
            集数
            <select value={filters.episode} onChange={(event) => setFilters((current) => ({ ...current, episode: event.target.value }))}>
              <option value="all">全部集数</option>
              {episodeOptions.map((episodeNo) => (
                <option key={episodeNo} value={episodeNo}>
                  第 {episodeNo} 集
                </option>
              ))}
            </select>
          </label>
          <label>
            资产类型
            <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value as AssetLockFilters["type"] }))}>
              <option value="all">全部类型</option>
              {Object.entries(assetTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as AssetLockFilters["status"] }))}>
              <option value="all">全部状态</option>
              {Object.entries(reviewStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            负责人
            <select value={filters.owner} onChange={(event) => setFilters((current) => ({ ...current, owner: event.target.value }))}>
              <option value="all">全部负责人</option>
              {ownerOptions.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
          </label>
          <label>
            风险
            <select value={filters.risk} onChange={(event) => setFilters((current) => ({ ...current, risk: event.target.value as AssetLockFilters["risk"] }))}>
              <option value="all">全部风险</option>
              {Object.entries(riskLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </aside>

        <div className="asset-change-list">
          <div className="asset-list-head">
            <div>
              <Search size={15} />
              <span>{filteredItems.length} 项资产变更</span>
            </div>
            <span>编剧 / 制作 / 统筹状态</span>
          </div>
          {filteredItems.map((item) => (
            <article
              className={`asset-row ${selectedAsset?.id === item.id ? "active" : ""} ${item.reviewStatus}`}
              key={item.id}
              onClick={() => setSelectedAssetId(item.id)}
            >
              <input
                aria-label={`选择 ${item.assetName}`}
                checked={selectedIds.includes(item.id)}
                onChange={(event) => {
                  event.stopPropagation();
                  setSelectedIds((current) =>
                    current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]
                  );
                }}
                onClick={(event) => event.stopPropagation()}
                type="checkbox"
              />
              <div>
                <strong>{item.assetName}</strong>
                <span>{assetTypeLabels[item.assetType]} · {changeTypeLabels[item.changeType]} · 第 {item.episodeNos.join("、")} 集</span>
              </div>
              <AssetTag tone={item.changeType}>{changeTypeLabels[item.changeType]}</AssetTag>
              <AssetTag tone={item.reviewStatus}>{reviewStatusLabels[item.reviewStatus]}</AssetTag>
              <div className="asset-owner">
                <strong>{item.owner}</strong>
                <span className={`risk-dot ${item.risk}`}>{riskLabels[item.risk]}</span>
              </div>
            </article>
          ))}
        </div>

        {selectedAsset ? (
          <aside className="asset-detail-panel">
            <div className="asset-detail-head">
              <div>
                <span>{assetTypeLabels[selectedAsset.assetType]} · {changeTypeLabels[selectedAsset.changeType]}</span>
                <h3>{selectedAsset.assetName}</h3>
              </div>
              <AssetTag tone={selectedAsset.reviewStatus}>{reviewStatusLabels[selectedAsset.reviewStatus]}</AssetTag>
            </div>

            <div className="confirmation-grid">
              <ConfirmationBox label="编剧确认" value={selectedAsset.writerConfirmation} />
              <ConfirmationBox label="制作确认" value={selectedAsset.productionConfirmation} />
            </div>

            <div className="asset-before-after">
              <div>
                <span>变更前</span>
                <p>{selectedAsset.before}</p>
              </div>
              <div>
                <span>变更后</span>
                <p>{selectedAsset.after}</p>
              </div>
            </div>

            <DetailBlock icon={Flag} title="编剧说明" body={selectedAsset.writerNote} />
            <DetailBlock icon={ShieldCheck} title="制作备注" body={selectedAsset.productionNote} />
            <DetailBlock icon={Layers3} title="来源段落" body={selectedAsset.sourceParagraph} />

            <div className="discussion-box">
              <div>
                <MessageSquare size={15} />
                <strong>讨论记录</strong>
              </div>
              {selectedAsset.discussion.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>

            <div className="asset-detail-actions">
              <button
                className="primary-button"
                onClick={() =>
                  updateAsset(selectedAsset.id, {
                    productionConfirmation: "confirmed",
                    reviewStatus: selectedAsset.writerConfirmation === "confirmed" ? "ready_to_lock" : "writer_pending"
                  })
                }
                type="button"
              >
                <Check size={15} />
                确认
              </button>
              <button
                className="secondary-button"
                onClick={() => updateAsset(selectedAsset.id, { productionConfirmation: "returned", reviewStatus: "needs_info" })}
                type="button"
              >
                <RotateCcw size={15} />
                退回补充
              </button>
              <button className="secondary-button" onClick={() => updateAsset(selectedAsset.id, { reviewStatus: "disputed", risk: "high" })} type="button">
                <AlertTriangle size={15} />
                标记争议
              </button>
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

function AssetMetric({ label, tone = "blue", value }: { label: string; tone?: "blue" | "amber" | "green" | "red"; value: string }) {
  return (
    <div className={`asset-metric ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function AssetTag({ children, tone }: { children: ReactNode; tone: AssetChangeType | AssetReviewStatus }) {
  return <span className={`asset-tag ${tone}`}>{children}</span>;
}

function ConfirmationBox({ label, value }: { label: string; value: AssetConfirmation }) {
  return (
    <div className={`confirmation-box ${value}`}>
      <span>{label}</span>
      <strong>{confirmationLabels[value]}</strong>
    </div>
  );
}

function DetailBlock({ body, icon: Icon, title }: { body: string; icon: LucideIcon; title: string }) {
  return (
    <div className="asset-detail-block">
      <div>
        <Icon size={15} />
        <strong>{title}</strong>
      </div>
      <p>{body}</p>
    </div>
  );
}

