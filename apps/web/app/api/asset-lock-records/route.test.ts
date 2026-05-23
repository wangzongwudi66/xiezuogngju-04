import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeliveryImportJob } from "../delivery-import-jobs/service";
import { mutateDeliveryPackage } from "../delivery-packages/service";
import { GET, POST } from "./route";

describe("asset lock record route", () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-asset-lock-record-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storeDir, { recursive: true });
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
  });

  afterEach(async () => {
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    await rm(storeDir, { recursive: true, force: true });
  });

  it("creates and lists asset lock records without exposing persistence internals", async () => {
    const deliveryPackageId = await createDraft();
    const createResponse = await POST(jsonRequest(buildCreateBody(deliveryPackageId)));
    const created = await createResponse.json();

    expect(createResponse.status).toBe(200);
    expect(created).toMatchObject({
      record: {
        projectId: "project-jincheng",
        deliveryPackageId,
        assetName: "Mine Lift",
        status: "draft"
      },
      summary: {
        total: 1
      }
    });
    expect(JSON.stringify(created)).not.toContain("filePath");
    expect(JSON.stringify(created)).not.toContain(storeDir);

    const listResponse = await GET(new Request("http://localhost/api/asset-lock-records?projectId=project-jincheng"));
    const listed = await listResponse.json();
    const allResponse = await GET(new Request("http://localhost/api/asset-lock-records"));
    const allListed = await allResponse.json();

    expect(listed.records).toContainEqual(created.record);
    expect(listed.summary.total).toBe(1);
    expect(allListed.records).toContainEqual(created.record);
    expect(allListed.summary.total).toBe(1);
  });

  it("ignores client-controlled record state fields on create", async () => {
    const deliveryPackageId = await createDraft();
    const response = await POST(
      jsonRequest({
        ...buildCreateBody(deliveryPackageId),
        status: "locked",
        finalLockedByUserId: "user-owner",
        writerConfirmation: "confirmed",
        productionConfirmation: "confirmed"
      })
    );
    const created = await response.json();

    expect(response.status).toBe(200);
    expect(created.record).toMatchObject({
      status: "draft",
      writerConfirmation: "pending",
      productionConfirmation: "pending"
    });
    expect(created.record.finalLockedByUserId).toBeUndefined();
  });

  it("runs confirmation, needs-info, dispute, and final-lock actions", async () => {
    const deliveryPackageId = await createDraft();
    const createResponse = await POST(jsonRequest(buildCreateBody(deliveryPackageId)));
    const created = await createResponse.json();
    const recordId = created.record.id;
    const writerResponse = await POST(
      jsonRequest({
        action: "writer_confirm",
        assetLockRecordId: recordId,
        confirmedByUserId: "user-head-writer",
        note: "writer ok"
      })
    );
    const productionResponse = await POST(
      jsonRequest({
        action: "production_confirm",
        assetLockRecordId: recordId,
        confirmedByUserId: "user-creator-a",
        note: "production ok"
      })
    );
    const lockResponse = await POST(
      jsonRequest({
        action: "final_lock",
        assetLockRecordId: recordId,
        lockedByUserId: "user-owner"
      })
    );

    await expect(writerResponse.json()).resolves.toMatchObject({
      record: {
        writerConfirmation: "confirmed",
        writerNote: "writer ok"
      }
    });
    await expect(productionResponse.json()).resolves.toMatchObject({
      record: {
        productionConfirmation: "confirmed",
        productionNote: "production ok",
        status: "ready_to_lock"
      }
    });
    await expect(lockResponse.json()).resolves.toMatchObject({
      record: {
        status: "locked",
        finalLockedByUserId: "user-owner"
      }
    });

    const needsInfoId = (await (await POST(jsonRequest(buildCreateBody(deliveryPackageId, "Needs Info Asset")))).json()).record.id;
    const needsInfoResponse = await POST(
      jsonRequest({
        action: "needs_info",
        assetLockRecordId: needsInfoId,
        markedByUserId: "user-creator-a",
        missingInfo: "front reference missing"
      })
    );
    const disputeId = (await (await POST(jsonRequest(buildCreateBody(deliveryPackageId, "Disputed Asset")))).json()).record.id;
    const disputeResponse = await POST(
      jsonRequest({
        action: "dispute",
        assetLockRecordId: disputeId,
        markedByUserId: "user-head-writer",
        disputeReason: "asset scope unclear"
      })
    );

    await expect(needsInfoResponse.json()).resolves.toMatchObject({
      record: {
        status: "needs_info",
        missingInfo: "front reference missing"
      }
    });
    await expect(disputeResponse.json()).resolves.toMatchObject({
      record: {
        status: "disputed",
        risk: "high",
        disputeReason: "asset scope unclear"
      }
    });
  });

  it("returns validation and mutation errors with 400 status", async () => {
    const invalidJson = await POST(new Request("http://localhost/api/asset-lock-records", { method: "POST", body: "{" }));
    const invalidBody = await POST(jsonRequest({ action: "create" }));
    const missingRecord = await POST(
      jsonRequest({
        action: "writer_confirm",
        assetLockRecordId: "missing-record",
        confirmedByUserId: "user-head-writer"
      })
    );

    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toEqual({ error: "invalid_asset_lock_record_request" });
    expect(invalidBody.status).toBe(400);
    await expect(invalidBody.json()).resolves.toEqual({ error: "invalid_asset_lock_record_request" });
    expect(missingRecord.status).toBe(400);
    await expect(missingRecord.json()).resolves.toMatchObject({
      error: "asset_lock_record_mutation_failed"
    });
  });

  it("returns an empty list for legacy workspaces without asset lock records", async () => {
    const response = await GET(new Request("http://localhost/api/asset-lock-records?projectId=project-jincheng"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      records: [],
      summary: {
        total: 0
      }
    });
  });
});

async function createDraft() {
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

function buildCreateBody(deliveryPackageId: string, assetName = "Mine Lift") {
  return {
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
  };
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/asset-lock-records", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}
