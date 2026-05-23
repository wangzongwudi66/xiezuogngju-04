import { describe, expect, it } from "vitest";
import {
  canCreateAssetLockRecordFromPackage,
  filterAssetChanges,
  getAssetLockBulkHint,
  getAssetLockEmptyState,
  getAssetLockFinalLockHint,
  getMockAssetChanges,
  getAssetLockRoleActions,
  getNextAssetLockOwner,
  summarizeAssetLock,
  toAssetLockChangeItems
} from "./asset-lock-workbench-data";
import { formatAssetLockError } from "./asset-lock-api";
import type { AssetLockRecord } from "@aigc/domain";

describe("asset lock workbench data helpers", () => {
  it("filters asset changes by episode, type, status, owner and risk", () => {
    const items = getMockAssetChanges();
    const filtered = filterAssetChanges(items, {
      episode: "5",
      owner: "沈制作 A",
      risk: "high",
      status: "disputed",
      type: "effect"
    });

    expect(filtered).toHaveLength(1);
  });

  it("blocks final lock when any side still has pending, disputed, or missing-info items", () => {
    const summary = summarizeAssetLock(getMockAssetChanges());

    expect(summary.canLock).toBe(false);
    expect(summary.writerPendingCount).toBeGreaterThan(0);
    expect(summary.productionPendingCount).toBeGreaterThan(0);
    expect(summary.disputeCount).toBe(1);
    expect(summary.needsInfoCount).toBe(1);
  });

  it("allows final lock only after writer and production are confirmed and blockers are gone", () => {
    const readyItems = getMockAssetChanges().map((item) => ({
      ...item,
      productionConfirmation: "confirmed" as const,
      reviewStatus: "ready_to_lock" as const,
      risk: "normal" as const,
      writerConfirmation: "confirmed" as const
    }));
    const summary = summarizeAssetLock(readyItems);

    expect(summary.canLock).toBe(true);
    expect(getNextAssetLockOwner(readyItems)).toBe("统筹定版");
  });

  it("routes the next owner to coordination before ordinary pending confirmations when there is a dispute", () => {
    expect(getNextAssetLockOwner(getMockAssetChanges())).toBe("统筹协调争议项");
  });

  it("does not treat an empty asset list as ready to lock", () => {
    const summary = summarizeAssetLock([]);

    expect(summary.canLock).toBe(false);
    expect(getNextAssetLockOwner([])).toBe("先生成资产核对记录");
    expect(getAssetLockFinalLockHint(summary)).toBe("没有资产核对记录，不能定版。");
  });

  it("maps API records into workbench items instead of requiring mock state", () => {
    const record = buildAssetLockRecord({
      status: "draft",
      writerConfirmation: "confirmed",
      productionConfirmation: "pending"
    });

    const [item] = toAssetLockChangeItems([record]);

    expect(item.id).toBe(record.id);
    expect(item.assetName).toBe(record.assetName);
    expect(item.reviewStatus).toBe("production_pending");
    expect(item.productionConfirmation).toBe("pending");
  });

  it("keeps final lock blocked for API records with unfinished confirmations", () => {
    const items = toAssetLockChangeItems([
      buildAssetLockRecord({
        status: "draft",
        writerConfirmation: "confirmed",
        productionConfirmation: "pending"
      })
    ]);

    expect(summarizeAssetLock(items).canLock).toBe(false);
  });

  it("formats API failures without pretending local success", () => {
    expect(formatAssetLockError(new Error("asset_lock_records_request_failed"))).toBe("资产定版记录加载失败，请稍后重试。");
    expect(formatAssetLockError(new Error("交稿包状态必须是 published"))).toBe("只能基于已发布交稿包生成资产核对记录。请先完成交稿发布。");
    expect(formatAssetLockError(new Error("编剧和制作确认完成后才能定版"))).toBe("仍有未完成确认、争议或需补资料项，暂不能最终定版。");
    expect(formatAssetLockError(new Error("asset_lock_record_not_found"))).not.toContain("asset_lock_record_not_found");
  });

  it("explains empty states and only exposes generation for published delivery packages", () => {
    expect(canCreateAssetLockRecordFromPackage({ status: "published" })).toBe(true);
    expect(canCreateAssetLockRecordFromPackage({ status: "pending_review" })).toBe(false);

    expect(getAssetLockEmptyState({ hasPublishedPackage: true, packageTitle: "第 1-2 集交稿包" })).toEqual({
      title: "当前项目还没有资产核对记录",
      body: "已找到已发布交稿包“第 1-2 集交稿包”。资产核对记录会把交稿包里的资产变更整理成待确认清单。",
      actionLabel: "生成资产核对记录"
    });
    expect(getAssetLockEmptyState({ hasPublishedPackage: false }).actionLabel).toBe("去交稿中心");
    expect(getAssetLockEmptyState({ hasPublishedPackage: false }).body).toContain("生成演示资产记录");
  });

  it("keeps role-specific asset lock actions separated", () => {
    expect(getAssetLockRoleActions("writer")).toMatchObject({
      canWriterConfirm: true,
      canProductionConfirm: false,
      canCoordinate: false,
      writerConfirmLabel: "我已确认编剧侧"
    });
    expect(getAssetLockRoleActions("creator")).toMatchObject({
      canWriterConfirm: false,
      canProductionConfirm: true,
      canCoordinate: false,
      productionConfirmLabel: "我已确认制作侧"
    });
    expect(getAssetLockRoleActions("coordinator")).toMatchObject({
      canWriterConfirm: true,
      canProductionConfirm: true,
      canCoordinate: true
    });
  });

  it("shows clear disabled-state hints for bulk actions and final lock", () => {
    const blockedSummary = summarizeAssetLock(getMockAssetChanges());
    expect(getAssetLockBulkHint(0, false)).toBe("先勾选资产核对记录，再进行批量处理。");
    expect(getAssetLockBulkHint(2, false)).toBe("已选择 2 项，可批量处理。");
    expect(getAssetLockBulkHint(2, true)).toBe("正在处理上一项操作，请稍等。");
    expect(getAssetLockFinalLockHint(blockedSummary)).toBe("还有争议或需补资料项，先处理完再定版。");

    const readySummary = summarizeAssetLock(
      getMockAssetChanges().map((item) => ({
        ...item,
        writerConfirmation: "confirmed",
        productionConfirmation: "confirmed",
        reviewStatus: "ready_to_lock",
        risk: "normal"
      }))
    );
    expect(getAssetLockFinalLockHint(readySummary)).toBe("编剧和制作都已确认，可以由统筹最终定版。");
  });
});

function buildAssetLockRecord(patch: Partial<AssetLockRecord> = {}): AssetLockRecord {
  return {
    id: "asset-lock-1",
    projectId: "project-jincheng",
    deliveryPackageId: "delivery-published",
    episodeNos: [12, 13],
    assetName: "矿井入口",
    assetType: "scene",
    changeType: "modified",
    writerConfirmation: "pending",
    writerNote: "入口位置需要确认。",
    productionConfirmation: "pending",
    productionNote: "制作侧待核对。",
    risk: "normal",
    status: "draft",
    createdByUserId: "user-owner",
    createdAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    ...patch
  };
}
