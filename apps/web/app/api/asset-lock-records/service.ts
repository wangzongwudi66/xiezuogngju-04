import {
  confirmAssetLockRecordByProduction,
  confirmAssetLockRecordByWriter,
  createDeliveryPackageDraft,
  createAssetLockRecord,
  finalLockAssetRecord,
  markAssetLockRecordDisputed,
  markAssetLockRecordNeedsInfo,
  publishDeliveryPackage,
  submitDeliveryPackageForReview
} from "@aigc/domain";
import type {
  AssetChangeType,
  AssetLockRecord,
  AssetRiskLevel,
  AssetType,
  WorkspaceState
} from "@aigc/domain";
import { mutateDeliveryImportWorkspace, readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";

export type AssetLockRecordMutationRequest =
  | {
      action: "create";
      projectId: string;
      deliveryPackageId: string;
      episodeNos: number[];
      assetName: string;
      assetType: AssetType;
      changeType: AssetChangeType;
      createdByUserId: string;
      risk?: AssetRiskLevel;
      writerNote?: string;
      productionNote?: string;
    }
  | {
      action: "writer_confirm";
      assetLockRecordId: string;
      confirmedByUserId: string;
      note?: string;
    }
  | {
      action: "production_confirm";
      assetLockRecordId: string;
      confirmedByUserId: string;
      note?: string;
    }
  | {
      action: "needs_info";
      assetLockRecordId: string;
      markedByUserId: string;
      missingInfo: string;
    }
  | {
      action: "dispute";
      assetLockRecordId: string;
      markedByUserId: string;
      disputeReason: string;
    }
  | {
      action: "final_lock";
      assetLockRecordId: string;
      lockedByUserId: string;
    }
  | {
      action: "prepare_demo";
      projectId: string;
      actorUserId: string;
    };

export interface AssetLockRecordListResponse {
  records: AssetLockRecord[];
  summary: AssetLockRecordSummary;
}

export interface AssetLockRecordMutationResponse extends AssetLockRecordListResponse {
  record: AssetLockRecord;
}

export interface AssetLockRecordSummary {
  total: number;
  byStatus: Record<AssetLockRecord["status"], number>;
  byRisk: Record<AssetLockRecord["risk"], number>;
  pendingWriterCount: number;
  pendingProductionCount: number;
}

export async function listAssetLockRecords(projectId?: string): Promise<AssetLockRecordListResponse> {
  const workspace = await readDeliveryImportWorkspace();
  const records = selectAssetLockRecords(workspace.state, projectId);

  return {
    records,
    summary: summarizeAssetLockRecords(records)
  };
}

export async function mutateAssetLockRecord(input: AssetLockRecordMutationRequest): Promise<AssetLockRecordMutationResponse> {
  const snapshot = await mutateDeliveryImportWorkspace((state) => applyAssetLockRecordMutation(state, input));
  const record = findMutatedRecord(snapshot.state, input);
  const records = selectAssetLockRecords(snapshot.state, record.projectId);

  return {
    record,
    records,
    summary: summarizeAssetLockRecords(records)
  };
}

function applyAssetLockRecordMutation(state: WorkspaceState, input: AssetLockRecordMutationRequest) {
  switch (input.action) {
    case "create":
      return createAssetLockRecord(state, {
        projectId: input.projectId,
        deliveryPackageId: input.deliveryPackageId,
        episodeNos: input.episodeNos,
        assetName: input.assetName,
        assetType: input.assetType,
        changeType: input.changeType,
        createdByUserId: input.createdByUserId,
        risk: input.risk,
        writerNote: input.writerNote,
        productionNote: input.productionNote
      });
    case "writer_confirm":
      return confirmAssetLockRecordByWriter(state, {
        assetLockRecordId: input.assetLockRecordId,
        confirmedByUserId: input.confirmedByUserId,
        note: input.note
      });
    case "production_confirm":
      return confirmAssetLockRecordByProduction(state, {
        assetLockRecordId: input.assetLockRecordId,
        confirmedByUserId: input.confirmedByUserId,
        note: input.note
      });
    case "needs_info":
      return markAssetLockRecordNeedsInfo(state, {
        assetLockRecordId: input.assetLockRecordId,
        markedByUserId: input.markedByUserId,
        missingInfo: input.missingInfo
      });
    case "dispute":
      return markAssetLockRecordDisputed(state, {
        assetLockRecordId: input.assetLockRecordId,
        markedByUserId: input.markedByUserId,
        disputeReason: input.disputeReason
      });
    case "final_lock":
      return finalLockAssetRecord(state, {
        assetLockRecordId: input.assetLockRecordId,
        lockedByUserId: input.lockedByUserId
      });
    case "prepare_demo":
      return prepareAssetLockDemoRecords(state, input.projectId, input.actorUserId);
  }
}

function findMutatedRecord(state: WorkspaceState, input: AssetLockRecordMutationRequest) {
  const records = state.assetLockRecords ?? [];

  if (input.action === "create") {
    const record = records.at(-1);

    if (!record) {
      throw new Error("asset_lock_record_not_created");
    }

    return record;
  }

  if (input.action === "prepare_demo") {
    const record = records.find((item) => item.projectId === input.projectId);

    if (!record) {
      throw new Error("asset_lock_record_not_created");
    }

    return record;
  }

  const record = records.find((item) => item.id === input.assetLockRecordId);

  if (!record) {
    throw new Error("asset_lock_record_not_found");
  }

  return record;
}

function prepareAssetLockDemoRecords(state: WorkspaceState, projectId: string, actorUserId: string) {
  const existingPublishedPackage = state.deliveryPackages.find(
    (deliveryPackage) => deliveryPackage.projectId === projectId && deliveryPackage.status === "published"
  );
  let nextState = state;
  let deliveryPackageId = existingPublishedPackage?.id ?? "";

  if (!deliveryPackageId) {
    nextState = createDeliveryPackageDraft(nextState, {
      projectId,
      uploadedByUserId: actorUserId,
      type: "range",
      declaredEpisodeFrom: 3,
      declaredEpisodeTo: 4,
      title: "资产定版验收：已发布演示交稿包",
      sourceFileName: "asset-lock-demo.docx",
      episodes: [
        {
          episodeNo: 3,
          title: "第 3 集",
          content: "第 3 集\n矿井入口段落更新，新增北井升降笼、红色安全灯和李砚旧伤妆。"
        },
        {
          episodeNo: 4,
          title: "第 4 集",
          content: "第 4 集\n旧矿区手绘图成为关键道具，制作侧需要确认资产尺寸和复用范围。"
        }
      ],
      confirmedEpisodeNos: [3, 4]
    });
    deliveryPackageId = nextState.deliveryPackages.at(-1)?.id ?? "";
    nextState = submitDeliveryPackageForReview(nextState, deliveryPackageId, actorUserId);
    nextState = publishDeliveryPackage(nextState, deliveryPackageId, actorUserId);
  }

  const existingNames = new Set((nextState.assetLockRecords ?? []).map((record) => `${record.deliveryPackageId}:${record.assetName}`));
  const demoRecords = [
    {
      assetName: "李砚旧伤妆",
      assetType: "character" as const,
      changeType: "modified" as const,
      episodeNos: [3],
      risk: "attention" as const,
      writerNote: "演示记录：编剧侧确认旧伤妆是否准确对应已发布剧本。",
      productionNote: "演示记录：制作侧确认妆造是否需要进入资产库。"
    },
    {
      assetName: "北井升降笼",
      assetType: "scene" as const,
      changeType: "new" as const,
      episodeNos: [3, 4],
      risk: "normal" as const,
      writerNote: "演示记录：确认场景是否覆盖第 3、4 集。",
      productionNote: "演示记录：确认是否作为可复用场景资产。"
    },
    {
      assetName: "旧矿区手绘图",
      assetType: "prop" as const,
      changeType: "modified" as const,
      episodeNos: [4],
      risk: "high" as const,
      writerNote: "演示记录：确认图上新增线索是否准确。",
      productionNote: "演示记录：请制作侧补齐尺寸和画面参考。"
    }
  ];

  for (const record of demoRecords) {
    if (existingNames.has(`${deliveryPackageId}:${record.assetName}`)) {
      continue;
    }

    nextState = createAssetLockRecord(nextState, {
      projectId,
      deliveryPackageId,
      createdByUserId: actorUserId,
      ...record
    });
  }

  return nextState;
}

function selectAssetLockRecords(state: WorkspaceState, projectId?: string) {
  return (state.assetLockRecords ?? [])
    .filter((record) => !projectId || record.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function summarizeAssetLockRecords(records: AssetLockRecord[]): AssetLockRecordSummary {
  return records.reduce<AssetLockRecordSummary>(
    (summary, record) => {
      summary.total += 1;
      summary.byStatus[record.status] += 1;
      summary.byRisk[record.risk] += 1;

      if (record.writerConfirmation !== "confirmed") {
        summary.pendingWriterCount += 1;
      }

      if (record.productionConfirmation !== "confirmed") {
        summary.pendingProductionCount += 1;
      }

      return summary;
    },
    {
      total: 0,
      byStatus: {
        draft: 0,
        needs_info: 0,
        disputed: 0,
        ready_to_lock: 0,
        locked: 0
      },
      byRisk: {
        normal: 0,
        attention: 0,
        high: 0
      },
      pendingWriterCount: 0,
      pendingProductionCount: 0
    }
  );
}
