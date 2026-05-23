import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedWorkspace } from "@aigc/domain";
import { createDeliveryImportJob, getDeliveryImportWorkspace } from "../delivery-import-jobs/service";
import { mutateDeliveryPackage } from "../delivery-packages/service";
import { listAssetLockRecords, mutateAssetLockRecord } from "./service";

describe("asset lock record service", () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-asset-lock-records-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storeDir, { recursive: true });
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
  });

  afterEach(async () => {
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    await rm(storeDir, { recursive: true, force: true });
  });

  it("creates an asset lock record and persists it in the workspace", async () => {
    const deliveryPackageId = await createDraft();
    const result = await createAssetRecord(deliveryPackageId);
    const persisted = await getDeliveryImportWorkspace();

    expect(result.record).toMatchObject({
      projectId: "project-jincheng",
      deliveryPackageId,
      episodeNos: [1, 2],
      assetName: "Mine Lift",
      assetType: "scene",
      changeType: "new",
      risk: "attention",
      status: "draft"
    });
    expect(persisted.state.assetLockRecords).toContainEqual(result.record);
  });

  it("lists records by project and returns a summary", async () => {
    const deliveryPackageId = await createDraft();
    const created = await createAssetRecord(deliveryPackageId);
    await createAssetRecord(deliveryPackageId, "Mine Lift Backup");
    const listed = await listAssetLockRecords("project-jincheng");
    const allRecords = await listAssetLockRecords();

    expect(listed.records).toContainEqual(created.record);
    expect(allRecords.summary.total).toBe(2);
    expect(listed.summary).toMatchObject({
      total: 2,
      byStatus: {
        draft: 2
      },
      byRisk: {
        attention: 2
      },
      pendingWriterCount: 2,
      pendingProductionCount: 2
    });
    await expect(listAssetLockRecords("project-tide")).resolves.toMatchObject({
      records: [],
      summary: {
        total: 0
      }
    });
  });

  it("prepares demo delivery package and asset records for acceptance testing", async () => {
    const result = await mutateAssetLockRecord({
      action: "prepare_demo",
      projectId: "project-jincheng",
      actorUserId: "user-owner"
    });
    const workspace = await getDeliveryImportWorkspace();

    expect(result.summary.total).toBeGreaterThan(0);
    expect(result.records.length).toBeGreaterThan(0);
    expect(workspace.state.deliveryPackages).toContainEqual(
      expect.objectContaining({
        projectId: "project-jincheng",
        status: "published",
        sourceFileName: "asset-lock-demo.docx"
      })
    );
    expect(workspace.state.assetLockRecords?.length).toBeGreaterThan(0);
  });

  it("generates asset records from a published delivery package", async () => {
    const deliveryPackageId = await createCandidateDraft();
    const result = await mutateAssetLockRecord({
      action: "generate_from_package",
      projectId: "project-jincheng",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });

    expect(result.records.length).toBeGreaterThan(1);
    expect(result.records.every((record) => record.deliveryPackageId === deliveryPackageId)).toBe(true);
    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetType: "scene",
          episodeNos: [1]
        }),
        expect.objectContaining({
          assetType: "prop"
        })
      ])
    );
  });

  it("does not duplicate records when generating from the same package repeatedly", async () => {
    const deliveryPackageId = await createCandidateDraft();
    const first = await mutateAssetLockRecord({
      action: "generate_from_package",
      projectId: "project-jincheng",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });
    const second = await mutateAssetLockRecord({
      action: "generate_from_package",
      projectId: "project-jincheng",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });

    expect(second.records).toHaveLength(first.records.length);
    expect(new Set(second.records.map((record) => record.assetName)).size).toBe(second.records.length);
  });

  it("rejects generate_from_package for draft packages", async () => {
    const deliveryPackageId = await createCandidateDraft({ publish: false });

    await expect(
      mutateAssetLockRecord({
        action: "generate_from_package",
        projectId: "project-jincheng",
        deliveryPackageId,
        actorUserId: "user-head-writer"
      })
    ).rejects.toThrow("published");
  });

  it("rejects generate_from_package when no candidates are found", async () => {
    const deliveryPackageId = await createDraft();

    await expect(
      mutateAssetLockRecord({
        action: "generate_from_package",
        projectId: "project-jincheng",
        deliveryPackageId,
        actorUserId: "user-head-writer"
      })
    ).rejects.toThrow("asset_lock_candidates_empty");
  });

  it("prepares demo records from an existing published package using its real episodes", async () => {
    const deliveryPackageId = await createCandidateDraft();
    const result = await mutateAssetLockRecord({
      action: "prepare_demo",
      projectId: "project-jincheng",
      actorUserId: "user-head-writer"
    });

    expect(result.records.every((record) => record.deliveryPackageId === deliveryPackageId)).toBe(true);
    expect(result.records.flatMap((record) => record.episodeNos).every((episodeNo) => episodeNo === 1 || episodeNo === 2)).toBe(true);
  });

  it("ignores client-controlled state fields on create", async () => {
    const deliveryPackageId = await createDraft();
    const result = await mutateAssetLockRecord({
      action: "create",
      projectId: "project-jincheng",
      deliveryPackageId,
      episodeNos: [1, 2],
      assetName: "Client Spoof",
      assetType: "scene",
      changeType: "new",
      createdByUserId: "user-head-writer",
      risk: "attention",
      writerNote: "writer note",
      status: "locked",
      finalLockedByUserId: "user-owner",
      writerConfirmation: "confirmed",
      productionConfirmation: "confirmed"
    } as Parameters<typeof mutateAssetLockRecord>[0]);

    expect(result.record).toMatchObject({
      status: "draft",
      writerConfirmation: "pending",
      productionConfirmation: "pending"
    });
    expect(result.record.finalLockedByUserId).toBeUndefined();
  });

  it("rejects cross-project packages, draft packages, and episode numbers outside the package", async () => {
    const draftDeliveryPackageId = await createDraft({ publish: false });
    const publishedDeliveryPackageId = await createDraft();

    await expect(
      mutateAssetLockRecord({
        action: "create",
        projectId: "project-tide",
        deliveryPackageId: publishedDeliveryPackageId,
        episodeNos: [1],
        assetName: "Cross Project",
        assetType: "scene",
        changeType: "new",
        createdByUserId: "user-creator-a"
      })
    ).rejects.toThrow();
    await expect(
      mutateAssetLockRecord({
        action: "create",
        projectId: "project-jincheng",
        deliveryPackageId: draftDeliveryPackageId,
        episodeNos: [1],
        assetName: "Draft Package",
        assetType: "scene",
        changeType: "new",
        createdByUserId: "user-head-writer"
      })
    ).rejects.toThrow("published");
    await expect(
      mutateAssetLockRecord({
        action: "create",
        projectId: "project-jincheng",
        deliveryPackageId: publishedDeliveryPackageId,
        episodeNos: [3],
        assetName: "Wrong Episode",
        assetType: "scene",
        changeType: "new",
        createdByUserId: "user-head-writer"
      })
    ).rejects.toThrow();
  });

  it("records writer and production confirmations", async () => {
    const record = (await createAssetRecord(await createDraft())).record;
    const writerConfirmed = await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-head-writer",
      note: "writer ok"
    });
    const productionConfirmed = await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-creator-a",
      note: "production ok"
    });

    expect(writerConfirmed.record).toMatchObject({
      writerConfirmation: "confirmed",
      writerConfirmedByUserId: "user-head-writer",
      writerNote: "writer ok",
      status: "draft"
    });
    expect(productionConfirmed.record).toMatchObject({
      productionConfirmation: "confirmed",
      productionConfirmedByUserId: "user-creator-a",
      productionNote: "production ok",
      status: "ready_to_lock"
    });
  });

  it("marks records as needing information or disputed", async () => {
    const needsInfoRecord = (await createAssetRecord(await createDraft())).record;
    const needsInfo = await mutateAssetLockRecord({
      action: "needs_info",
      assetLockRecordId: needsInfoRecord.id,
      markedByUserId: "user-creator-a",
      missingInfo: "front reference missing"
    });
    const disputedRecord = (await createAssetRecord(await createDraft())).record;
    const disputed = await mutateAssetLockRecord({
      action: "dispute",
      assetLockRecordId: disputedRecord.id,
      markedByUserId: "user-head-writer",
      disputeReason: "asset scope unclear"
    });

    expect(needsInfo.record).toMatchObject({
      status: "needs_info",
      missingInfo: "front reference missing"
    });
    expect(disputed.record).toMatchObject({
      status: "disputed",
      risk: "high",
      disputeReason: "asset scope unclear"
    });
  });

  it("final locks only after required confirmations", async () => {
    const record = (await createAssetRecord(await createDraft())).record;

    await expect(
      mutateAssetLockRecord({
        action: "final_lock",
        assetLockRecordId: record.id,
        lockedByUserId: "user-owner"
      })
    ).rejects.toThrow();

    await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-head-writer"
    });
    await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-creator-a"
    });
    const locked = await mutateAssetLockRecord({
      action: "final_lock",
      assetLockRecordId: record.id,
      lockedByUserId: "user-owner"
    });

    expect(locked.record).toMatchObject({
      status: "locked",
      finalLockedByUserId: "user-owner"
    });
    expect(locked.record.finalLockedAt).toBeTruthy();
  });

  it("does not final lock records that still need information or are disputed", async () => {
    const needsInfoRecord = (await createAssetRecord(await createDraft())).record;
    await mutateAssetLockRecord({
      action: "needs_info",
      assetLockRecordId: needsInfoRecord.id,
      markedByUserId: "user-creator-a",
      missingInfo: "front reference missing"
    });

    await expect(
      mutateAssetLockRecord({
        action: "final_lock",
        assetLockRecordId: needsInfoRecord.id,
        lockedByUserId: "user-owner"
      })
    ).rejects.toThrow();

    const disputedRecord = (await createAssetRecord(await createDraft())).record;
    await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId: disputedRecord.id,
      confirmedByUserId: "user-head-writer"
    });
    await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId: disputedRecord.id,
      confirmedByUserId: "user-creator-a"
    });
    await mutateAssetLockRecord({
      action: "dispute",
      assetLockRecordId: disputedRecord.id,
      markedByUserId: "user-head-writer",
      disputeReason: "asset scope unclear"
    });

    await expect(
      mutateAssetLockRecord({
        action: "final_lock",
        assetLockRecordId: disputedRecord.id,
        lockedByUserId: "user-owner"
      })
    ).rejects.toThrow();
  });

  it("returns clear errors for missing records and does not corrupt the workspace", async () => {
    const before = await getDeliveryImportWorkspace();

    await expect(
      mutateAssetLockRecord({
        action: "writer_confirm",
        assetLockRecordId: "missing-record",
        confirmedByUserId: "user-head-writer"
      })
    ).rejects.toThrow();
    await expect(getDeliveryImportWorkspace()).resolves.toEqual(before);
  });

  it("rejects actors without the required role for each action", async () => {
    const record = (await createAssetRecord(await createDraft())).record;

    await expect(
      mutateAssetLockRecord({
        action: "writer_confirm",
        assetLockRecordId: record.id,
        confirmedByUserId: "user-creator-a"
      })
    ).rejects.toThrow();
    await expect(
      mutateAssetLockRecord({
        action: "production_confirm",
        assetLockRecordId: record.id,
        confirmedByUserId: "user-writer"
      })
    ).rejects.toThrow();
    await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-head-writer"
    });
    await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-creator-a"
    });
    await expect(
      mutateAssetLockRecord({
        action: "final_lock",
        assetLockRecordId: record.id,
        lockedByUserId: "user-writer"
      })
    ).rejects.toThrow();
    await expect(
      mutateAssetLockRecord({
        action: "final_lock",
        assetLockRecordId: record.id,
        lockedByUserId: "user-creator-a"
      })
    ).rejects.toThrow();
  });

  it("handles legacy workspaces without asset lock records", async () => {
    const { assetLockRecords, ...legacyWorkspace } = seedWorkspace;
    await writeFile(
      join(storeDir, "store.json"),
      JSON.stringify({
        version: 1,
        results: [],
        workspace: legacyWorkspace,
        deliveryParseIssuesByPackageId: {}
      }),
      "utf8"
    );

    await expect(listAssetLockRecords("project-jincheng")).resolves.toMatchObject({
      records: [],
      summary: {
        total: 0
      }
    });

    const result = await createAssetRecord(await createDraft());
    const persisted = await getDeliveryImportWorkspace();

    expect(Array.isArray(persisted.state.assetLockRecords)).toBe(true);
    expect(persisted.state.assetLockRecords).toContainEqual(result.record);
  });
});

async function createDraft(input: { publish?: boolean } = {}) {
  const result = await createDeliveryImportJob({
    source: "text",
    projectId: "project-jincheng",
    uploadedByUserId: "user-head-writer",
    declaredRangeText: "1-2",
    rawText: "\u7b2c 1 \u96c6 \u5f00\u573a\n\u6b63\u6587\u4e00\n\u7b2c 2 \u96c6 \u8ffd\u8e2a\n\u6b63\u6587\u4e8c"
  });

  expect(result.ok).toBe(true);
  if (!result.ok || !result.job.deliveryPackageId) {
    throw new Error("delivery package draft was not created");
  }

  const deliveryPackageId = result.job.deliveryPackageId;

  if (input.publish === false) {
    return deliveryPackageId;
  }

  await mutateDeliveryPackage({
    action: "submit",
    deliveryPackageId,
    actorUserId: "user-head-writer"
  });
  await mutateDeliveryPackage({
    action: "publish",
    deliveryPackageId,
    actorUserId: "user-owner"
  });

  return deliveryPackageId;
}

async function createCandidateDraft(input: { publish?: boolean } = {}) {
  const result = await createDeliveryImportJob({
    source: "text",
    projectId: "project-jincheng",
    uploadedByUserId: "user-head-writer",
    declaredRangeText: "1-2",
    rawText:
      "\u7b2c 1 \u96c6\n\u9435\u7926\u4e95\u5165\u53e3\u65b0\u589e\u5347\u964d\u7b3c\uff0c\u4f17\u4eba\u7b2c\u4e00\u6b21\u8fdb\u5165\u5317\u4e95\u3002\n\u7b2c 2 \u96c6\n\u7ea2\u8272\u5b89\u5168\u706f\u6cbf\u7528\uff0c\u5730\u56fe\u5c55\u5f00\uff0c\u7c89\u5c18\u7206\u95ea\u4f5c\u4e3a\u584c\u65b9\u524d\u5146\u3002"
  });

  expect(result.ok).toBe(true);
  if (!result.ok || !result.job.deliveryPackageId) {
    throw new Error("delivery package draft was not created");
  }

  const deliveryPackageId = result.job.deliveryPackageId;

  if (input.publish === false) {
    return deliveryPackageId;
  }

  await mutateDeliveryPackage({
    action: "submit",
    deliveryPackageId,
    actorUserId: "user-head-writer"
  });
  await mutateDeliveryPackage({
    action: "publish",
    deliveryPackageId,
    actorUserId: "user-owner"
  });

  return deliveryPackageId;
}

async function createAssetRecord(deliveryPackageId: string, assetName = "Mine Lift") {
  return mutateAssetLockRecord({
    action: "create",
    projectId: "project-jincheng",
    deliveryPackageId,
    episodeNos: [1, 2],
    assetName,
    assetType: "scene",
    changeType: "new",
    createdByUserId: "user-head-writer",
    risk: "attention",
    writerNote: "writer note"
  });
}
