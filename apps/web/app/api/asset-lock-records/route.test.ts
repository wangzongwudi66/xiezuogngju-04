import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginAsUser } from "@aigc/domain";
import { createDeliveryImportJob } from "../delivery-import-jobs/service";
import { mutateDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { mutateDeliveryPackage } from "../delivery-packages/service";
import { GET, POST } from "./route";

describe("asset lock record route", () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-asset-lock-record-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storeDir, { recursive: true });
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
    await login("user-head-writer");
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
        createdByUserId: "user-owner",
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
      createdByUserId: "user-head-writer",
      writerConfirmation: "pending",
      productionConfirmation: "pending"
    });
    expect(created.record.finalLockedByUserId).toBeUndefined();
  });

  it("scopes GET records to the server session user instead of client-controlled identity", async () => {
    const deliveryPackageId = await createDraft();
    const createResponse = await POST(jsonRequest({ ...buildCreateBody(deliveryPackageId), createdByUserId: "user-owner" }));
    const created = await createResponse.json();

    expect(created.record).toMatchObject({
      createdByUserId: "user-head-writer",
      episodeNos: [1, 2]
    });

    await login("user-creator-b");
    const creatorBResponse = await GET(
      new Request("http://localhost/api/asset-lock-records?projectId=project-jincheng&viewerUserId=user-owner&assignedEpisodeNos=1")
    );
    await expect(creatorBResponse.json()).resolves.toMatchObject({
      records: [],
      summary: {
        total: 0
      }
    });

    await login("user-creator-a");
    const creatorAResponse = await GET(new Request("http://localhost/api/asset-lock-records?projectId=project-jincheng"));
    const creatorARecords = await creatorAResponse.json();

    expect(creatorARecords.records).toContainEqual(created.record);
    expect(creatorARecords.summary.total).toBe(1);
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
    await login("user-creator-a");
    const productionResponse = await POST(
      jsonRequest({
        action: "production_confirm",
        assetLockRecordId: recordId,
        confirmedByUserId: "user-owner",
        note: "production ok"
      })
    );
    await login("user-owner");
    const lockResponse = await POST(
      jsonRequest({
        action: "final_lock",
        assetLockRecordId: recordId,
        lockedByUserId: "user-owner"
      })
    );
    await login("user-head-writer");
    const lockedWriterResponse = await POST(
      jsonRequest({
        action: "writer_confirm",
        assetLockRecordId: recordId,
        confirmedByUserId: "user-head-writer"
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
        productionConfirmedByUserId: "user-creator-a",
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
    expect(lockedWriterResponse.status).toBe(400);
    await expect(lockedWriterResponse.json()).resolves.toMatchObject({
      error: "asset_lock_record_mutation_failed",
      message: "资产已定版，不能修改资产核对记录"
    });

    const needsInfoId = (await (await POST(jsonRequest(buildCreateBody(deliveryPackageId, "Needs Info Asset")))).json()).record.id;
    await login("user-creator-a");
    const needsInfoResponse = await POST(
      jsonRequest({
        action: "needs_info",
        assetLockRecordId: needsInfoId,
        markedByUserId: "user-creator-a",
        missingInfo: "front reference missing"
      })
    );
    await login("user-head-writer");
    const disputeId = (await (await POST(jsonRequest(buildCreateBody(deliveryPackageId, "Disputed Asset")))).json()).record.id;
    await login("user-head-writer");
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

  it("prepares demo records for acceptance testing when no published package exists", async () => {
    await login("user-owner");
    const response = await POST(
      jsonRequest({
        action: "prepare_demo",
        projectId: "project-jincheng",
        actorUserId: "user-owner"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records.length).toBeGreaterThan(0);
    expect(payload.summary.total).toBeGreaterThan(0);
  });

  it("generates asset lock records from a published package", async () => {
    const deliveryPackageId = await createCandidateDraft();
    const response = await POST(
      jsonRequest({
        action: "generate_from_package",
        projectId: "project-jincheng",
        deliveryPackageId,
        actorUserId: "user-head-writer"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.records.length).toBeGreaterThan(1);
    expect(payload.records.every((record: { deliveryPackageId: string }) => record.deliveryPackageId === deliveryPackageId)).toBe(true);
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

  it("requires a server workspace session for asset lock reads and writes", async () => {
    await mutateDeliveryImportWorkspace((state) => ({ ...state, currentUserId: null }));

    const listResponse = await GET(new Request("http://localhost/api/asset-lock-records?projectId=project-jincheng"));
    const mutateResponse = await POST(jsonRequest({ action: "prepare_demo", projectId: "project-jincheng" }));

    expect(listResponse.status).toBe(401);
    await expect(listResponse.json()).resolves.toMatchObject({
      error: "asset_lock_records_request_failed",
      message: "asset_lock_unauthenticated"
    });
    expect(mutateResponse.status).toBe(401);
    await expect(mutateResponse.json()).resolves.toMatchObject({
      error: "asset_lock_record_mutation_failed",
      message: "asset_lock_unauthenticated"
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

async function login(userId: string) {
  await mutateDeliveryImportWorkspace((state) => loginAsUser(state, userId));
}

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

async function createCandidateDraft() {
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
