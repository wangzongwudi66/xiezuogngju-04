import {
  confirmAssetLockRecordByProduction,
  confirmAssetLockRecordByWriter,
  createAssetLockRecord,
  finalLockAssetRecord,
  markAssetLockRecordDisputed,
  markAssetLockRecordNeedsInfo
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

  const record = records.find((item) => item.id === input.assetLockRecordId);

  if (!record) {
    throw new Error("asset_lock_record_not_found");
  }

  return record;
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
