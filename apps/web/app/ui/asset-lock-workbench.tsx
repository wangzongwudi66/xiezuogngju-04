"use client";

import {
  AlertTriangle,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileUp,
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
import type { ChangeEvent } from "react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  canUploadAssetAttachmentToRecord,
  filterAssetChanges,
  getAssetLockBulkHint,
  getAssetLockEmptyState,
  getAssetLockFinalLockHint,
  getAssetLockRoleActions,
  getNextAssetLockOwner,
  summarizeAssetLock,
  toAssetLockChangeItems
} from "./asset-lock-workbench-data";
import type {
  AssetLockActorRole,
  AssetChangeType,
  AssetConfirmation,
  AssetLockFilters,
  AssetReviewStatus,
  AssetRisk,
  AssetType
} from "./asset-lock-workbench-data";
import type { AssetAttachment, AssetAttachmentType, AssetLockRecord, ScriptSourceBinding } from "@aigc/domain";
import type { AssetLockCreateDraft, AssetLockRecordSummary, AssetSourceBindInput, AssetSourceRemoveInput } from "./asset-lock-api";
import { formatAssetLockError } from "./asset-lock-api";
import {
  fetchAssetLockAttachments,
  formatAssetAttachmentError,
  uploadAssetLockAttachment
} from "./asset-lock-attachment-api";
import { AssetSourceBindingPanel } from "./asset-source-binding-panel";
import { createDefaultSourceBindingDraft, getSourceBindingsForRecord, normalizeSourceBindingDraft } from "./asset-source-binding-data";
import type { AssetSourceBindingDraft } from "./asset-source-binding-data";

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

const attachmentTypeLabels: Record<AssetAttachmentType, string> = {
  reference: "参考资料",
  production: "制作文件",
  final: "定版附件"
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
  actorRole,
  actorUserId,
  errorText,
  isLoading,
  isMutating,
  onCreateRecord,
  onFinalLock,
  onBindSource,
  onMarkDispute,
  onMarkNeedsInfo,
  deliveryPackages,
  onOpenDeliveryCenter,
  onPrepareDemo,
  onProductionConfirm,
  onRefresh,
  onRemoveSourceBinding,
  onWriterConfirm,
  projectName,
  records,
  serverSummary,
  sourceBindings
}: {
  activeDeliveryPackage: AssetLockPackage | null;
  actorRole: AssetLockActorRole;
  actorUserId: string;
  errorText?: string | null;
  isLoading?: boolean;
  isMutating?: boolean;
  onCreateRecord: (draft: AssetLockCreateDraft) => Promise<void>;
  onBindSource: (input: AssetSourceBindInput) => Promise<void>;
  onFinalLock: (assetLockRecordId: string) => Promise<void>;
  onMarkDispute: (assetLockRecordId: string, disputeReason: string) => Promise<void>;
  onMarkNeedsInfo: (assetLockRecordId: string, missingInfo: string) => Promise<void>;
  deliveryPackages: AssetLockPackage[];
  onOpenDeliveryCenter: () => void;
  onPrepareDemo: () => Promise<void>;
  onProductionConfirm: (assetLockRecordId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onRemoveSourceBinding: (input: AssetSourceRemoveInput) => Promise<void>;
  onWriterConfirm: (assetLockRecordId: string) => Promise<void>;
  projectName: string;
  records: AssetLockRecord[];
  serverSummary: AssetLockRecordSummary | null;
  sourceBindings: ScriptSourceBinding[];
}) {
  const [filters, setFilters] = useState<AssetLockFilters>(emptyFilters);
  const items = useMemo(() => toAssetLockChangeItems(records), [records]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeOperation, setActiveOperation] = useState<string | null>(null);
  const [attachmentsByRecordId, setAttachmentsByRecordId] = useState<Record<string, AssetAttachment[]>>({});
  const [attachmentType, setAttachmentType] = useState<AssetAttachmentType>("reference");
  const [attachmentNote, setAttachmentNote] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentLoadingRecordId, setAttachmentLoadingRecordId] = useState<string | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [sourceBindingDraft, setSourceBindingDraft] = useState<AssetSourceBindingDraft>(() => createDefaultSourceBindingDraft(null));
  const [sourceBindingBusy, setSourceBindingBusy] = useState(false);
  const [sourceBindingError, setSourceBindingError] = useState<string | null>(null);
  const [sourceBindingSuccess, setSourceBindingSuccess] = useState<string | null>(null);
  const publishedPackages = deliveryPackages.filter((deliveryPackage) => deliveryPackage.status === "published");
  const packageForView =
    activeDeliveryPackage?.status === "published"
      ? activeDeliveryPackage
      : publishedPackages[0] ?? activeDeliveryPackage ?? deliveryPackages[0] ?? null;
  const filteredItems = useMemo(() => filterAssetChanges(items, filters), [filters, items]);
  const summary = useMemo(() => summarizeAssetLock(items), [items]);
  const selectedAsset = items.find((item) => item.id === selectedAssetId) ?? filteredItems[0] ?? items[0];
  const selectedRecord = selectedAsset ? records.find((record) => record.id === selectedAsset.id) ?? null : null;
  const episodeOptions = Array.from(new Set(items.flatMap((item) => item.episodeNos))).sort((a, b) => a - b);
  const ownerOptions = Array.from(new Set(items.map((item) => item.owner))).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const selectedPackageEpisodes = packageForView?.confirmedEpisodeNos.length
    ? packageForView.confirmedEpisodeNos
    : episodeOptions;
  const canCreateFromPackage = Boolean(packageForView && packageForView.status === "published");
  const emptyState = getAssetLockEmptyState({
    hasPublishedPackage: canCreateFromPackage,
    packageTitle: packageForView?.title
  });
  const roleActions = getAssetLockRoleActions(actorRole);
  const finalLockHint = getAssetLockFinalLockHint(summary);
  const bulkHint = getAssetLockBulkHint(selectedIds.length, Boolean(isMutating || activeOperation));
  const isBusy = Boolean(isMutating || activeOperation);
  const selectedAssetCanFinalLock = Boolean(selectedAsset && selectedAsset.reviewStatus !== "locked" && summary.canLock);
  const selectedAssetIsLocked = !canUploadAssetAttachmentToRecord(selectedAsset);
  const selectedAssetAttachments = selectedAsset ? attachmentsByRecordId[selectedAsset.id] ?? [] : [];
  const selectedSourceBindings = getSourceBindingsForRecord(selectedRecord?.id, sourceBindings);

  useEffect(() => {
    setSelectedAssetId((current) => (items.some((item) => item.id === current) ? current : items[0]?.id ?? ""));
    setSelectedIds((current) => current.filter((id) => items.some((item) => item.id === id && item.reviewStatus !== "locked")));
  }, [items]);

  useEffect(() => {
    setSourceBindingDraft(createDefaultSourceBindingDraft(selectedRecord));
    setSourceBindingError(null);
    setSourceBindingSuccess(null);
  }, [selectedRecord?.id]);

  useEffect(() => {
    if (!selectedAsset) {
      return;
    }

    let cancelled = false;
    setAttachmentLoadingRecordId(selectedAsset.id);
    setAttachmentError(null);

    fetchAssetLockAttachments(selectedAsset.id)
      .then(({ attachments }) => {
        if (!cancelled) {
          setAttachmentsByRecordId((current) => ({
            ...current,
            [selectedAsset.id]: attachments.filter((attachment) => attachment.status === "active")
          }));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAttachmentError(formatAssetAttachmentError(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAttachmentLoadingRecordId(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAsset]);

  async function runAssetOperation(label: string, operation: () => Promise<void>) {
    setActiveOperation(label);
    try {
      await operation();
    } finally {
      setActiveOperation(null);
    }
  }

  async function mutateSelectedAssets(label: string, mutator: (assetLockRecordId: string) => Promise<void>) {
    if (selectedIds.length === 0) {
      return;
    }

    await runAssetOperation(label, async () => {
      for (const assetLockRecordId of selectedIds) {
        await mutator(assetLockRecordId);
      }

      setSelectedIds([]);
    });
  }

  async function handleCreateDemoRecords() {
    await runAssetOperation("正在准备已发布交稿包并生成资产核对记录。", onPrepareDemo);
  }

  async function refreshSelectedAssetAttachments(assetLockRecordId: string) {
    const { attachments } = await fetchAssetLockAttachments(assetLockRecordId);
    setAttachmentsByRecordId((current) => ({
      ...current,
      [assetLockRecordId]: attachments.filter((attachment) => attachment.status === "active")
    }));
  }

  async function handleUploadAttachment() {
    if (!selectedAsset || !attachmentFile) {
      setAttachmentError(formatAssetAttachmentError("asset_attachment_file_required"));
      return;
    }

    setAttachmentUploading(true);
    setAttachmentError(null);

    try {
      await uploadAssetLockAttachment({
        assetLockRecordId: selectedAsset.id,
        attachmentType,
        file: attachmentFile,
        note: attachmentNote,
        uploadedByUserId: actorUserId
      });
      setAttachmentFile(null);
      setAttachmentNote("");
      await refreshSelectedAssetAttachments(selectedAsset.id);
    } catch (error) {
      setAttachmentError(formatAssetAttachmentError(error));
    } finally {
      setAttachmentUploading(false);
    }
  }

  async function handleBindSource() {
    if (!selectedRecord) {
      return;
    }

    const nextDraft = normalizeSourceBindingDraft(sourceBindingDraft, selectedRecord);
    setSourceBindingDraft(nextDraft);
    setSourceBindingBusy(true);
    setSourceBindingError(null);
    setSourceBindingSuccess(null);

    try {
      await onBindSource({
        assetLockRecordId: selectedRecord.id,
        deliveryPackageId: selectedRecord.deliveryPackageId,
        episodeNo: nextDraft.episodeNo,
        startLine: nextDraft.startLine,
        endLine: nextDraft.endLine
      });
      setSourceBindingSuccess("剧本来源绑定已更新。");
    } catch (error) {
      setSourceBindingError(formatAssetLockError(error) || "剧本来源绑定失败，请检查集数和行号后重试。");
    } finally {
      setSourceBindingBusy(false);
    }
  }

  async function handleRemoveSourceBinding(scriptSourceBindingId: string) {
    setSourceBindingBusy(true);
    setSourceBindingError(null);
    setSourceBindingSuccess(null);

    try {
      await onRemoveSourceBinding({ scriptSourceBindingId });
      setSourceBindingSuccess("剧本来源绑定已移除。");
    } catch (error) {
      setSourceBindingError(formatAssetLockError(error) || "剧本来源绑定移除失败，请稍后重试。");
    } finally {
      setSourceBindingBusy(false);
    }
  }

  function handleAttachmentFileChange(event: ChangeEvent<HTMLInputElement>) {
    setAttachmentFile(event.target.files?.[0] ?? null);
    setAttachmentError(null);
  }

  return (
    <section className="panel module-panel asset-lock-workbench">
      <div className="asset-lock-top">
        <div>
          <span>{projectName} · 资产核对闭环</span>
          <h2>资产核对与定版工作台</h2>
          <p>{packageForView ? packageForView.title : "暂无已发布交稿包"} · 涉及第 {selectedPackageEpisodes.join("、") || "-"} 集</p>
        </div>
        <div className="asset-lock-top-actions">
          <button className="secondary-button" disabled={isLoading || isBusy} onClick={onRefresh} type="button">
            {isLoading ? "正在刷新..." : "刷新记录"}
          </button>
          <button className="secondary-button" onClick={onOpenDeliveryCenter} type="button">
            回到交稿中心
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {errorText ? <p className="inline-warning">{errorText}</p> : null}
      {isLoading ? <p className="inline-help">正在读取服务端资产定版记录...</p> : null}
      {activeOperation ? <p className="inline-help" role="status">{activeOperation}</p> : null}

      <div className="asset-lock-overview">
        <AssetMetric label="资产变更" value={(serverSummary?.total ?? summary.totalCount).toString()} />
        <AssetMetric
          label="待编剧确认"
          tone={(serverSummary?.pendingWriterCount ?? summary.writerPendingCount) ? "amber" : "green"}
          value={(serverSummary?.pendingWriterCount ?? summary.writerPendingCount).toString()}
        />
        <AssetMetric
          label="待制作确认"
          tone={(serverSummary?.pendingProductionCount ?? summary.productionPendingCount) ? "amber" : "green"}
          value={(serverSummary?.pendingProductionCount ?? summary.productionPendingCount).toString()}
        />
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
        <span title={bulkHint}>{bulkHint}</span>
        {roleActions.canWriterConfirm ? (
          <button
            className="secondary-button compact"
            disabled={selectedIds.length === 0 || isBusy}
            onClick={() => mutateSelectedAssets("正在提交编剧侧批量确认。", onWriterConfirm)}
            title={selectedIds.length === 0 ? "先勾选资产核对记录，再进行批量确认。" : "批量提交编剧侧确认。"}
            type="button"
          >
            <UserCheck size={14} />
            批量编剧侧确认
          </button>
        ) : null}
        {roleActions.canCoordinate ? (
          <button
            className="secondary-button compact"
            disabled={selectedIds.length === 0 || isBusy}
            onClick={() => mutateSelectedAssets("正在批量标记需补资料。", (assetLockRecordId) => onMarkNeedsInfo(assetLockRecordId, "批量标记：请补充资产核对资料。"))}
            title={selectedIds.length === 0 ? "先勾选资产核对记录，再标记需补资料。" : "把选中记录退回补充资料。"}
            type="button"
          >
            <FileWarning size={14} />
            标记需补充
          </button>
        ) : null}
        {roleActions.canProductionConfirm ? (
          <button
            className="secondary-button compact"
            disabled={selectedIds.length === 0 || isBusy}
            onClick={() => mutateSelectedAssets("正在提交制作侧批量确认。", onProductionConfirm)}
            title={selectedIds.length === 0 ? "先勾选资产核对记录，再进行批量确认。" : "批量提交制作侧确认。"}
            type="button"
          >
            <ClipboardCheck size={14} />
            批量制作侧确认
          </button>
        ) : null}
        {roleActions.canCoordinate ? (
          <button
            className="primary-button"
            disabled={!selectedAssetCanFinalLock || isBusy}
            onClick={() => selectedAsset && runAssetOperation("正在提交统筹最终定版。", () => onFinalLock(selectedAsset.id))}
            title={finalLockHint}
            type="button"
          >
            <LockKeyhole size={15} />
            统筹定版
          </button>
        ) : null}
      </div>
      <p className={`asset-lock-gate-note ${summary.canLock ? "ready" : "blocked"}`}>{finalLockHint}</p>

      {items.length === 0 ? (
        <div className="empty-card soft">
          <ShieldCheck size={22} />
          <strong>{emptyState.title}</strong>
          {canCreateFromPackage ? (
            <>
              <p>{emptyState.body}</p>
              <button className="primary-button" disabled={isBusy || !actorUserId} onClick={handleCreateDemoRecords} type="button">
                {activeOperation ? "正在生成..." : emptyState.actionLabel}
              </button>
            </>
          ) : (
            <>
              <p>{emptyState.body}</p>
              <p className="inline-help">当前阶段还没有真实资产文件上传和自动资产解析；请先用演示数据验证确认、补资料、争议和定版流程。</p>
              <div className="asset-empty-actions">
                <button className="primary-button" disabled={isBusy || !actorUserId} onClick={() => runAssetOperation("正在准备演示交稿包和资产核对记录。", onPrepareDemo)} type="button">
                  {activeOperation ? "正在准备..." : "生成演示资产记录"}
                </button>
                <button className="secondary-button" onClick={onOpenDeliveryCenter} type="button">
                  {emptyState.actionLabel}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

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
          {filteredItems.length === 0 ? <p className="empty-state">当前筛选条件下没有资产核对记录。</p> : null}
          {filteredItems.map((item) => (
            <article
              className={`asset-row ${selectedAsset?.id === item.id ? "active" : ""} ${item.reviewStatus}`}
              key={item.id}
              onClick={() => setSelectedAssetId(item.id)}
            >
              <input
                aria-label={`选择 ${item.assetName}`}
                checked={selectedIds.includes(item.id)}
                disabled={item.reviewStatus === "locked"}
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
            {selectedRecord ? (
              <AssetSourceBindingPanel
                actorRole={actorRole}
                bindingError={sourceBindingError}
                bindingSuccess={sourceBindingSuccess}
                bindings={selectedSourceBindings}
                draft={sourceBindingDraft}
                isBusy={sourceBindingBusy}
                isLocked={selectedAssetIsLocked}
                onBind={() => void handleBindSource()}
                onDraftChange={setSourceBindingDraft}
                onRemove={(scriptSourceBindingId) => void handleRemoveSourceBinding(scriptSourceBindingId)}
                record={selectedRecord}
              />
            ) : null}

            <div className="discussion-box">
              <div>
                <MessageSquare size={15} />
                <strong>讨论记录</strong>
              </div>
              {selectedAsset.discussion.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>

            <AssetAttachmentPanel
              attachmentError={attachmentError}
              attachmentFile={attachmentFile}
              attachmentLoading={attachmentLoadingRecordId === selectedAsset.id}
              attachmentNote={attachmentNote}
              attachmentType={attachmentType}
              attachments={selectedAssetAttachments}
              attachmentUploading={attachmentUploading}
              isLocked={selectedAssetIsLocked}
              onFileChange={handleAttachmentFileChange}
              onNoteChange={setAttachmentNote}
              onTypeChange={setAttachmentType}
              onUpload={() => void handleUploadAttachment()}
            />

            <div className="asset-detail-actions">
              <button
                className="primary-button"
                disabled={isBusy || selectedAssetIsLocked || !roleActions.canWriterConfirm}
                onClick={() => runAssetOperation("正在提交编剧侧确认。", () => onWriterConfirm(selectedAsset.id))}
                title={
                  selectedAssetIsLocked
                    ? "这条资产记录已定版，不能继续修改。"
                    : roleActions.canWriterConfirm
                      ? "确认编剧侧已经核对该资产记录。"
                      : "当前角色不能提交编剧侧确认。"
                }
                type="button"
              >
                <Check size={15} />
                {roleActions.writerConfirmLabel}
              </button>
              <button
                className="primary-button"
                disabled={isBusy || selectedAssetIsLocked || !roleActions.canProductionConfirm}
                onClick={() => runAssetOperation("正在提交制作侧确认。", () => onProductionConfirm(selectedAsset.id))}
                title={
                  selectedAssetIsLocked
                    ? "这条资产记录已定版，不能继续修改。"
                    : roleActions.canProductionConfirm
                      ? "确认制作侧已经核对该资产记录。"
                      : "当前角色不能提交制作侧确认。"
                }
                type="button"
              >
                <ClipboardCheck size={15} />
                {roleActions.productionConfirmLabel}
              </button>
              {roleActions.canCoordinate ? (
                <button
                  className="secondary-button"
                  disabled={isBusy || selectedAssetIsLocked}
                  onClick={() => runAssetOperation("正在标记需补资料。", () => onMarkNeedsInfo(selectedAsset.id, "请补充资产参考、可见范围或制作侧所需资料。"))}
                  title={selectedAssetIsLocked ? "这条资产记录已定版，不能继续修改。" : "退回补充资产核对资料。"}
                  type="button"
                >
                  <RotateCcw size={15} />
                  退回补充
                </button>
              ) : null}
              {roleActions.canCoordinate ? (
                <button
                  className="secondary-button"
                  disabled={isBusy || selectedAssetIsLocked}
                  onClick={() => runAssetOperation("正在标记争议项。", () => onMarkDispute(selectedAsset.id, "编剧侧与制作侧对资产变更存在争议，请统筹协调。"))}
                  title={selectedAssetIsLocked ? "这条资产记录已定版，不能继续修改。" : "标记为资产争议项。"}
                  type="button"
                >
                  <AlertTriangle size={15} />
                  标记争议
                </button>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

function AssetAttachmentPanel({
  attachmentError,
  attachmentFile,
  attachmentLoading,
  attachmentNote,
  attachmentType,
  attachments,
  attachmentUploading,
  isLocked,
  onFileChange,
  onNoteChange,
  onTypeChange,
  onUpload
}: {
  attachmentError: string | null;
  attachmentFile: File | null;
  attachmentLoading: boolean;
  attachmentNote: string;
  attachmentType: AssetAttachmentType;
  attachments: AssetAttachment[];
  attachmentUploading: boolean;
  isLocked: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onNoteChange: (note: string) => void;
  onTypeChange: (type: AssetAttachmentType) => void;
  onUpload: () => void;
}) {
  return (
    <div className="asset-attachment-panel">
      <div className="asset-attachment-head">
        <div>
          <FileUp size={15} />
          <strong>附件</strong>
        </div>
        <span>{attachmentLoading ? "加载中" : `${attachments.length} 个有效附件`}</span>
      </div>

      {attachments.length === 0 ? (
        <p className="asset-attachment-empty">当前资产记录还没有有效附件。</p>
      ) : (
        <div className="asset-attachment-list">
          {attachments.map((attachment) => (
            <article key={attachment.id}>
              <div>
                <strong>{attachment.fileName}</strong>
                <span>
                  {attachmentTypeLabels[attachment.attachmentType]} · v{attachment.version} · {formatFileSize(attachment.size)}
                </span>
              </div>
              {attachment.note ? <p>{attachment.note}</p> : null}
            </article>
          ))}
        </div>
      )}

      <div className="asset-attachment-form">
        {isLocked ? <p className="inline-help">这条资产记录已定版，不能新增附件。</p> : null}
        {!isLocked ? <p className="inline-help">支持 JPG、PNG、WEBP、PDF，单个文件最大 20MB。</p> : null}
        <label>
          类型
          <select
            disabled={isLocked}
            value={attachmentType}
            onChange={(event) => onTypeChange(event.target.value as AssetAttachmentType)}
          >
            {Object.entries(attachmentTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          说明
          <input
            disabled={isLocked}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="可选，例如：正脸参考、制作拆解、最终定版说明"
            value={attachmentNote}
          />
        </label>
        <label>
          文件
          <input
            accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
            disabled={isLocked}
            onChange={onFileChange}
            type="file"
          />
        </label>
        {attachmentFile ? <p className="asset-attachment-selected">已选择：{attachmentFile.name}</p> : null}
        {attachmentError ? <p className="inline-warning">{attachmentError}</p> : null}
        <button className="secondary-button" disabled={isLocked || !attachmentFile || attachmentUploading} onClick={onUpload} type="button">
          <FileUp size={15} />
          {attachmentUploading ? "上传中..." : "上传附件"}
        </button>
      </div>
    </div>
  );
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)}MB`;
  }

  if (size >= 1024) {
    return `${Math.ceil(size / 1024)}KB`;
  }

  return `${size}B`;
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

