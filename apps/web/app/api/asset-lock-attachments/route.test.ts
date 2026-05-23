import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeliveryImportJob } from "../delivery-import-jobs/service";
import { mutateDeliveryPackage } from "../delivery-packages/service";
import { mutateAssetLockRecord } from "../asset-lock-records/service";
import { GET, POST } from "./route";

describe("asset lock attachment route", () => {
  let storeDir: string;
  let attachmentDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-asset-lock-attachment-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    attachmentDir = join(storeDir, "attachments");
    await mkdir(storeDir, { recursive: true });
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
    process.env.AIGC_ASSET_LOCK_ATTACHMENT_FILE_DIR = attachmentDir;
  });

  afterEach(async () => {
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    delete process.env.AIGC_ASSET_LOCK_ATTACHMENT_FILE_DIR;
    await rm(storeDir, { recursive: true, force: true });
  });

  it("uploads an attachment and lists active attachments without exposing storage paths", async () => {
    const recordId = (await createAssetRecord()).record.id;
    const uploadResponse = await POST(formRequest(buildUploadForm(recordId)));
    const created = await uploadResponse.json();
    const listResponse = await GET(new Request(`http://localhost/api/asset-lock-attachments?recordId=${recordId}`));
    const listed = await listResponse.json();
    const serialized = JSON.stringify(created);

    expect(uploadResponse.status).toBe(200);
    expect(created).toMatchObject({
      attachment: {
        assetLockRecordId: recordId,
        fileId: expect.stringMatching(/^asset-att-/),
        fileName: "reference.png",
        mime: "image/png",
        status: "active"
      }
    });
    expect(serialized).not.toContain("filePath");
    expect(serialized).not.toContain(".local-data");
    expect(serialized).not.toContain(storeDir);
    expect(serialized).not.toContain(resolve(attachmentDir));
    expect(listResponse.status).toBe(200);
    expect(listed.attachments).toContainEqual(created.attachment);
    await expect(readSavedFileNames()).resolves.toEqual([`${created.attachment.fileId}.png`]);
  });

  it("supports JPEG and PDF multipart uploads", async () => {
    const recordId = (await createAssetRecord()).record.id;
    const jpegResponse = await POST(formRequest(buildUploadForm(recordId, { fileName: "reference.jpg", mime: "image/jpeg" })));
    const pdfResponse = await POST(formRequest(buildUploadForm(recordId, { fileName: "brief.pdf", mime: "application/pdf" })));

    expect(jpegResponse.status).toBe(200);
    await expect(jpegResponse.json()).resolves.toMatchObject({
      attachment: {
        mime: "image/jpeg"
      }
    });
    expect(pdfResponse.status).toBe(200);
    await expect(pdfResponse.json()).resolves.toMatchObject({
      attachment: {
        mime: "application/pdf"
      }
    });
  });

  it("returns clear validation errors for missing files and invalid bodies", async () => {
    const recordId = (await createAssetRecord()).record.id;
    const missingFileForm = buildUploadForm(recordId);
    missingFileForm.delete("file");
    const missingFileResponse = await POST(formRequest(missingFileForm));
    const invalidBodyResponse = await POST(new Request("http://localhost/api/asset-lock-attachments", { method: "POST", body: "{" }));
    const missingRecordIdResponse = await GET(new Request("http://localhost/api/asset-lock-attachments"));

    expect(missingFileResponse.status).toBe(400);
    await expect(missingFileResponse.json()).resolves.toEqual({ error: "asset_attachment_file_required" });
    expect(invalidBodyResponse.status).toBe(400);
    await expect(invalidBodyResponse.json()).resolves.toEqual({ error: "invalid_asset_attachment_request" });
    expect(missingRecordIdResponse.status).toBe(400);
    await expect(missingRecordIdResponse.json()).resolves.toEqual({ error: "asset_attachment_record_id_required" });
    await expect(readSavedFileNames()).resolves.toEqual([]);
  });

  it("returns upload errors and does not save invalid files", async () => {
    const recordId = (await createAssetRecord()).record.id;
    const invalidMimeResponse = await POST(formRequest(buildUploadForm(recordId, { fileName: "bad.png", mime: "application/pdf" })));
    const missingRecordResponse = await POST(formRequest(buildUploadForm("missing-record")));

    expect(invalidMimeResponse.status).toBe(400);
    await expect(invalidMimeResponse.json()).resolves.toMatchObject({
      error: "asset_attachment_file_type_invalid"
    });
    expect(missingRecordResponse.status).toBe(400);
    await expect(missingRecordResponse.json()).resolves.toMatchObject({
      error: "asset_attachment_upload_failed"
    });
    await expect(readSavedFileNames()).resolves.toEqual([]);
  });

  async function createAssetRecord() {
    const deliveryPackageId = await createPublishedDeliveryPackage();

    return mutateAssetLockRecord({
      action: "create",
      projectId: "project-jincheng",
      deliveryPackageId,
      episodeNos: [1, 2],
      assetName: `Mine Lift ${Math.random().toString(36).slice(2)}`,
      assetType: "scene",
      changeType: "new",
      createdByUserId: "user-head-writer",
      risk: "attention"
    });
  }

  async function createPublishedDeliveryPackage() {
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

    await mutateDeliveryPackage({
      action: "submit",
      deliveryPackageId: result.job.deliveryPackageId,
      actorUserId: "user-head-writer"
    });
    await mutateDeliveryPackage({
      action: "publish",
      deliveryPackageId: result.job.deliveryPackageId,
      actorUserId: "user-owner"
    });

    return result.job.deliveryPackageId;
  }

  async function readSavedFileNames() {
    try {
      return await readdir(attachmentDir);
    } catch {
      return [];
    }
  }
});

function buildUploadForm(recordId: string, overrides: { fileName?: string; mime?: string } = {}) {
  const fileName = overrides.fileName ?? "reference.png";
  const mime = overrides.mime ?? "image/png";
  const form = new FormData();

  form.set("assetLockRecordId", recordId);
  form.set("uploadedByUserId", "user-head-writer");
  form.set("attachmentType", "reference");
  form.set("note", "reference note");
  form.set("file", new File([new Uint8Array([1, 2, 3])], fileName, { type: mime }));

  return form;
}

function formRequest(form: FormData) {
  return new Request("http://localhost/api/asset-lock-attachments", {
    method: "POST",
    body: form
  });
}
