import {
  confirmAssetLockRecordByProduction,
  confirmAssetLockRecordByWriter,
  createAssetLockRecord,
  createDeliveryPackageDraft,
  extractAssetLockCandidatesFromDeliveryEpisodes,
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
    }
  | {
      action: "generate_from_package";
      projectId: string;
      deliveryPackageId: string;
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
    case "generate_from_package":
      return generateAssetLockRecordsFromPackage(state, {
        projectId: input.projectId,
        deliveryPackageId: input.deliveryPackageId,
        actorUserId: input.actorUserId,
        allowFallback: false
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

  if (input.action === "prepare_demo") {
    const record = records.find((item) => item.projectId === input.projectId);

    if (!record) {
      throw new Error("asset_lock_record_not_created");
    }

    return record;
  }

  if (input.action === "generate_from_package") {
    const record = records.find(
      (item) => item.projectId === input.projectId && item.deliveryPackageId === input.deliveryPackageId
    );

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
      title: "Asset lock demo delivery package",
      sourceFileName: "asset-lock-demo.docx",
      episodes: [
        {
          episodeNo: 3,
          title: "Episode 3",
          content:
            "\u7b2c 3 \u96c6\n\u9435\u7926\u4e95\u5165\u53e3\u65b0\u589e\u5347\u964d\u7b3c\uff0c\u7ea2\u8272\u5b89\u5168\u706f\u7b2c\u4e00\u6b21\u542f\u7528\u3002"
        },
        {
          episodeNo: 4,
          title: "Episode 4",
          content:
            "\u7b2c 4 \u96c6\n\u5730\u56fe\u5c55\u5f00\uff0c\u7c89\u5c18\u7206\u95ea\u4f5c\u4e3a\u584c\u65b9\u524d\u5146\uff0c\u5236\u4f5c\u4fa7\u9700\u8981\u786e\u8ba4\u8d44\u4ea7\u5c3a\u5bf8\u548c\u590d\u7528\u8303\u56f4\u3002"
        }
      ],
      confirmedEpisodeNos: [3, 4]
    });
    deliveryPackageId = nextState.deliveryPackages.at(-1)?.id ?? "";
    nextState = submitDeliveryPackageForReview(nextState, deliveryPackageId, actorUserId);
    nextState = publishDeliveryPackage(nextState, deliveryPackageId, actorUserId);
  }

  return generateAssetLockRecordsFromPackage(nextState, {
    projectId,
    deliveryPackageId,
    actorUserId,
    allowFallback: true
  });
}

function generateAssetLockRecordsFromPackage(
  state: WorkspaceState,
  input: { actorUserId: string; allowFallback: boolean; deliveryPackageId: string; projectId: string }
) {
  const deliveryPackage = state.deliveryPackages.find((item) => item.id === input.deliveryPackageId);

  if (!deliveryPackage) {
    throw new Error("delivery_package_not_found");
  }

  if (deliveryPackage.projectId !== input.projectId) {
    throw new Error("asset_lock_record_package_project_mismatch");
  }

  if (deliveryPackage.status !== "published") {
    throw new Error("asset_lock_record_requires_published_package");
  }

  const episodes = state.deliveryPackageEpisodes.filter((episode) => episode.deliveryPackageId === input.deliveryPackageId);
  const existingNames = new Set(
    (state.assetLockRecords ?? [])
      .filter((record) => record.deliveryPackageId === input.deliveryPackageId)
      .map((record) => record.assetName)
  );
  const candidates = extractAssetLockCandidatesFromDeliveryEpisodes({
    projectId: input.projectId,
    deliveryPackageId: input.deliveryPackageId,
    createdByUserId: input.actorUserId,
    episodes
  });
  const candidatesToCreate =
    candidates.length > 0
      ? candidates
      : input.allowFallback
        ? [
            {
              projectId: input.projectId,
              deliveryPackageId: input.deliveryPackageId,
              episodeNos: episodes.map((episode) => episode.episodeNo),
              assetName: "Manual review asset candidate",
              assetType: "prop" as const,
              changeType: "modified" as const,
              createdByUserId: input.actorUserId,
              risk: "attention" as const,
              writerNote: "No asset keywords were extracted. Writer should confirm whether this package contains asset changes.",
              productionNote: "No asset keywords were extracted. Production should confirm whether assets need to be added or changed."
            }
          ]
        : [];

  if (candidatesToCreate.length === 0) {
    throw new Error("asset_lock_candidates_empty");
  }

  let nextState = state;

  for (const candidate of candidatesToCreate) {
    if (existingNames.has(candidate.assetName)) {
      continue;
    }

    nextState = createAssetLockRecord(nextState, candidate);
    existingNames.add(candidate.assetName);
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
