import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finalLockAssetRecord, loginAsUser } from "@aigc/domain";
import { createDeliveryImportJob } from "../delivery-import-jobs/service";
import { mutateDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { mutateDeliveryPackage } from "../delivery-packages/service";
import { mutateAssetLockRecord } from "../asset-lock-records/service";
import { GET, POST } from "./route";
import { DELETE as DELETE_ATTACHMENT, GET as GET_ATTACHMENT } from "./[attachmentId]/route";

describe("asset lock attachment route", () => {
  let storeDir: string;
  let attachmentDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-asset-lock-attachment-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    attachmentDir = join(storeDir, "attachments");
    await mkdir(storeDir, { recursive: true });
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
    process.env.AIGC_ASSET_LOCK_ATTACHMENT_FILE_DIR = attachmentDir;
    await login("user-head-writer");
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

  it("enforces current-session visibility for list requests", async () => {
    const visibleRecordId = (await createAssetRecord({ episodeNos: [1] })).record.id;
    const hiddenRecordId = (await createAssetRecord({ episodeNos: [30] })).record.id;
    const uploadResponse = await POST(formRequest(buildUploadForm(visibleRecordId, { fileName: "visible.png" })));
    const created = await uploadResponse.json();
    await POST(formRequest(buildUploadForm(hiddenRecordId, { fileName: "hidden.png" })));

    await mutateDeliveryImportWorkspace((state) => ({ ...state, currentUserId: null }));
    const unauthenticated = await GET(listRequest(visibleRecordId));

    await addOutsider();
    await login("user-outsider");
    const nonMember = await GET(listRequest(visibleRecordId));

    await login("user-writer");
    const writerVisible = await GET(listRequest(visibleRecordId));
    const writerHidden = await GET(listRequest(hiddenRecordId));

    await login("user-creator-a");
    const creatorVisible = await GET(listRequest(visibleRecordId));
    const creatorHidden = await GET(listRequest(hiddenRecordId));

    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: "asset_attachment_unauthenticated" });
    expect(nonMember.status).toBe(403);
    await expect(nonMember.json()).resolves.toEqual({ error: "asset_attachment_project_member_required" });
    expect(writerVisible.status).toBe(200);
    await expect(writerVisible.json()).resolves.toEqual({ attachments: [created.attachment] });
    expect(writerHidden.status).toBe(403);
    await expect(writerHidden.json()).resolves.toEqual({ error: "asset_attachment_forbidden" });
    expect(creatorVisible.status).toBe(200);
    await expect(creatorVisible.json()).resolves.toEqual({ attachments: [created.attachment] });
    expect(creatorHidden.status).toBe(403);
    await expect(creatorHidden.json()).resolves.toEqual({ error: "asset_attachment_forbidden" });
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

  it("downloads an active attachment without exposing storage paths", async () => {
    const recordId = (await createAssetRecord()).record.id;
    const uploadResponse = await POST(formRequest(buildUploadForm(recordId, { fileName: "asset 参考.png" })));
    const created = await uploadResponse.json();

    const response = await GET_ATTACHMENT(attachmentRequest(created.attachment.id), attachmentContext(created.attachment.id));
    const bytes = new Uint8Array(await response.arrayBuffer());
    const serializedHeaders = JSON.stringify(Array.from(response.headers.entries()));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''asset%20%E5%8F%82%E8%80%83.png");
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(serializedHeaders).not.toContain("filePath");
    expect(serializedHeaders).not.toContain(".local-data");
    expect(serializedHeaders).not.toContain(storeDir);
    expect(serializedHeaders).not.toContain(resolve(attachmentDir));
  });

  it("soft deletes an attachment and leaves the stored file in place", async () => {
    const recordId = (await createAssetRecord()).record.id;
    const uploadResponse = await POST(formRequest(buildUploadForm(recordId)));
    const created = await uploadResponse.json();
    const savedFilesBeforeDelete = await readSavedFileNames();

    const response = await DELETE_ATTACHMENT(attachmentRequest(created.attachment.id), attachmentContext(created.attachment.id));
    const payload = await response.json();
    const listResponse = await GET(new Request(`http://localhost/api/asset-lock-attachments?recordId=${recordId}`));
    const listed = await listResponse.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      attachment: {
        id: created.attachment.id,
        status: "deleted",
        deletedByUserId: "user-head-writer"
      }
    });
    expect(listed.attachments).toEqual([]);
    await expect(readSavedFileNames()).resolves.toEqual(savedFilesBeforeDelete);
    expect(serialized).not.toContain("filePath");
    expect(serialized).not.toContain(".local-data");
    expect(serialized).not.toContain(storeDir);
    expect(serialized).not.toContain(resolve(attachmentDir));
  });

  it("refreshes the active attachment list after a successful delete", async () => {
    const recordId = (await createAssetRecord()).record.id;
    const firstUploadResponse = await POST(formRequest(buildUploadForm(recordId, { fileName: "first.png" })));
    const first = await firstUploadResponse.json();
    const secondUploadResponse = await POST(formRequest(buildUploadForm(recordId, { fileName: "second.png" })));
    const second = await secondUploadResponse.json();

    const beforeListResponse = await GET(listRequest(recordId));
    const beforeList = await beforeListResponse.json();
    const deleteResponse = await DELETE_ATTACHMENT(attachmentRequest(first.attachment.id), attachmentContext(first.attachment.id));
    const deletePayload = await deleteResponse.json();
    const afterListResponse = await GET(listRequest(recordId));
    const afterList = await afterListResponse.json();

    expect(beforeListResponse.status).toBe(200);
    expect(beforeList.attachments).toHaveLength(2);
    expect(beforeList.attachments).toEqual([first.attachment, second.attachment]);
    expect(deleteResponse.status).toBe(200);
    expect(deletePayload.attachment).toMatchObject({
      id: first.attachment.id,
      status: "deleted"
    });
    expect(afterListResponse.status).toBe(200);
    expect(afterList.attachments).toHaveLength(1);
    expect(afterList.attachments).toEqual([second.attachment]);
  });

  it("ignores spoofed DELETE request bodies and uses the session user", async () => {
    const recordId = (await createAssetRecord()).record.id;
    const uploadResponse = await POST(formRequest(buildUploadForm(recordId, { uploadedByUserId: "user-creator-a" })));
    const created = await uploadResponse.json();
    await login("user-head-writer");

    const spoofedByHeadWriter = await DELETE_ATTACHMENT(
      attachmentRequest(created.attachment.id, { deletedByUserId: "user-owner", actorUserId: "user-owner" }),
      attachmentContext(created.attachment.id)
    );

    await login("user-owner");
    const deletedByCoordinator = await DELETE_ATTACHMENT(
      attachmentRequest(created.attachment.id, { deletedByUserId: "user-head-writer", actorUserId: "user-head-writer" }),
      attachmentContext(created.attachment.id)
    );
    const payload = await deletedByCoordinator.json();

    expect(spoofedByHeadWriter.status).toBe(403);
    await expect(spoofedByHeadWriter.json()).resolves.toEqual({ error: "asset_attachment_delete_forbidden" });
    expect(deletedByCoordinator.status).toBe(200);
    expect(payload.attachment.deletedByUserId).toBe("user-owner");
  });

  it("maps GET and DELETE attachment errors to stable statuses", async () => {
    const recordId = (await createAssetRecord()).record.id;
    const uploadResponse = await POST(formRequest(buildUploadForm(recordId)));
    const created = await uploadResponse.json();

    const missingId = await GET_ATTACHMENT(attachmentRequest(""), attachmentContext(""));
    const missingAttachment = await GET_ATTACHMENT(attachmentRequest("missing-attachment"), attachmentContext("missing-attachment"));

    await mutateDeliveryImportWorkspace((state) => ({ ...state, currentUserId: null }));
    const unauthenticatedDownload = await GET_ATTACHMENT(attachmentRequest(created.attachment.id), attachmentContext(created.attachment.id));
    const unauthenticatedDelete = await DELETE_ATTACHMENT(attachmentRequest(created.attachment.id), attachmentContext(created.attachment.id));

    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      users: [...state.users, { id: "user-outsider", name: "Outsider", defaultRole: "creator", avatarTone: "ink" }]
    }));
    await login("user-outsider");
    const nonMember = await GET_ATTACHMENT(attachmentRequest(created.attachment.id), attachmentContext(created.attachment.id));

    await login("user-head-writer");
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      assetAttachments: state.assetAttachments?.map((attachment) =>
        attachment.id === created.attachment.id ? { ...attachment, status: "deleted" } : attachment
      )
    }));
    const inactiveDelete = await DELETE_ATTACHMENT(attachmentRequest(created.attachment.id), attachmentContext(created.attachment.id));

    expect(missingId.status).toBe(400);
    await expect(missingId.json()).resolves.toEqual({ error: "asset_attachment_id_required" });
    expect(missingAttachment.status).toBe(404);
    await expect(missingAttachment.json()).resolves.toEqual({ error: "asset_attachment_not_found" });
    expect(unauthenticatedDownload.status).toBe(401);
    await expect(unauthenticatedDownload.json()).resolves.toEqual({ error: "asset_attachment_unauthenticated" });
    expect(unauthenticatedDelete.status).toBe(401);
    await expect(unauthenticatedDelete.json()).resolves.toEqual({ error: "asset_attachment_unauthenticated" });
    expect(nonMember.status).toBe(403);
    await expect(nonMember.json()).resolves.toEqual({ error: "asset_attachment_project_member_required" });
    expect(inactiveDelete.status).toBe(404);
    await expect(inactiveDelete.json()).resolves.toEqual({ error: "asset_attachment_not_found" });
  });

  it("blocks DELETE for every locked record attachment but still downloads them", async () => {
    const recordId = (await createAssetRecord()).record.id;
    const firstUploadResponse = await POST(formRequest(buildUploadForm(recordId, { fileName: "first.png" })));
    const first = await firstUploadResponse.json();
    const secondUploadResponse = await POST(formRequest(buildUploadForm(recordId, { fileName: "second.png" })));
    const second = await secondUploadResponse.json();
    await lockRecord(recordId);
    await login("user-owner");

    const firstDelete = await DELETE_ATTACHMENT(attachmentRequest(first.attachment.id), attachmentContext(first.attachment.id));
    const secondDelete = await DELETE_ATTACHMENT(attachmentRequest(second.attachment.id), attachmentContext(second.attachment.id));
    const firstDownload = await GET_ATTACHMENT(attachmentRequest(first.attachment.id), attachmentContext(first.attachment.id));
    const secondDownload = await GET_ATTACHMENT(attachmentRequest(second.attachment.id), attachmentContext(second.attachment.id));

    expect(firstDelete.status).toBe(409);
    await expect(firstDelete.json()).resolves.toEqual({ error: "asset_attachment_locked_record_delete_forbidden" });
    expect(secondDelete.status).toBe(409);
    await expect(secondDelete.json()).resolves.toEqual({ error: "asset_attachment_locked_record_delete_forbidden" });
    expect(firstDownload.status).toBe(200);
    expect(secondDownload.status).toBe(200);
  });

  it("does not leak storage paths for missing files or damaged file metadata", async () => {
    const recordId = (await createAssetRecord()).record.id;
    const missingFileUploadResponse = await POST(formRequest(buildUploadForm(recordId)));
    const missingFile = await missingFileUploadResponse.json();
    await rm(join(attachmentDir, `${missingFile.attachment.fileId}.png`), { force: true });

    const missingFileResponse = await GET_ATTACHMENT(attachmentRequest(missingFile.attachment.id), attachmentContext(missingFile.attachment.id));
    const missingFilePayload = await missingFileResponse.json();
    const missingFileSerialized = JSON.stringify(missingFilePayload);

    const damagedUploadResponse = await POST(formRequest(buildUploadForm(recordId, { fileName: "damaged.png" })));
    const damaged = await damagedUploadResponse.json();
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      assetAttachments: state.assetAttachments?.map((attachment) =>
        attachment.id === damaged.attachment.id ? { ...attachment, fileId: "../asset-att-123e4567-e89b-12d3-a456-426614174000" } : attachment
      )
    }));

    const damagedResponse = await GET_ATTACHMENT(attachmentRequest(damaged.attachment.id), attachmentContext(damaged.attachment.id));
    const damagedPayload = await damagedResponse.json();
    const damagedSerialized = JSON.stringify(damagedPayload);

    expect(missingFileResponse.status).toBe(404);
    expect(missingFilePayload).toEqual({ error: "asset_attachment_file_not_found" });
    expect(missingFileSerialized).not.toContain("filePath");
    expect(missingFileSerialized).not.toContain(".local-data");
    expect(missingFileSerialized).not.toContain(storeDir);
    expect(missingFileSerialized).not.toContain(resolve(attachmentDir));
    expect(damagedResponse.status).toBe(400);
    expect(damagedPayload).toEqual({ error: "asset_attachment_file_id_invalid" });
    expect(damagedSerialized).not.toContain("filePath");
    expect(damagedSerialized).not.toContain(".local-data");
    expect(damagedSerialized).not.toContain(storeDir);
    expect(damagedSerialized).not.toContain(resolve(attachmentDir));
  });

  async function createAssetRecord(input: { episodeNos?: number[] } = {}) {
    const episodeNos = input.episodeNos ?? [1, 2];
    const deliveryPackageId = await createPublishedDeliveryPackage(episodeNos);

    await login("user-head-writer");
    return mutateAssetLockRecord({
      action: "create",
      projectId: "project-jincheng",
      deliveryPackageId,
      episodeNos,
      assetName: `Mine Lift ${Math.random().toString(36).slice(2)}`,
      assetType: "scene",
      changeType: "new",
      createdByUserId: "user-head-writer",
      risk: "attention"
    });
  }

  async function login(userId: string) {
    await mutateDeliveryImportWorkspace((state) => loginAsUser(state, userId));
  }

  async function addOutsider() {
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      users: state.users.some((user) => user.id === "user-outsider")
        ? state.users
        : [...state.users, { id: "user-outsider", name: "Outsider", defaultRole: "creator", avatarTone: "ink" }]
    }));
  }

  async function lockRecord(assetLockRecordId: string) {
    await login("user-head-writer");
    await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId,
      confirmedByUserId: "user-head-writer"
    });
    await login("user-creator-a");
    await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId,
      confirmedByUserId: "user-creator-a"
    });
    await mutateDeliveryImportWorkspace((state) =>
      finalLockAssetRecord(state, {
        assetLockRecordId,
        lockedByUserId: "user-owner"
      })
    );
  }

  async function createPublishedDeliveryPackage(episodeNos = [1, 2]) {
    const sortedEpisodeNos = [...episodeNos].sort((a, b) => a - b);
    const result = await createDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: `${sortedEpisodeNos[0]}-${sortedEpisodeNos.at(-1)}`,
      rawText: sortedEpisodeNos.map((episodeNo) => `第 ${episodeNo} 集 开场\n正文 ${episodeNo}`).join("\n")
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

function buildUploadForm(recordId: string, overrides: { fileName?: string; mime?: string; uploadedByUserId?: string } = {}) {
  const fileName = overrides.fileName ?? "reference.png";
  const mime = overrides.mime ?? "image/png";
  const form = new FormData();

  form.set("assetLockRecordId", recordId);
  form.set("uploadedByUserId", overrides.uploadedByUserId ?? "user-head-writer");
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

function listRequest(recordId: string) {
  return new Request(`http://localhost/api/asset-lock-attachments?recordId=${recordId}`);
}

function attachmentRequest(attachmentId: string, body?: unknown) {
  return new Request(`http://localhost/api/asset-lock-attachments/${attachmentId}`, body === undefined ? undefined : {
    method: "DELETE",
    body: JSON.stringify(body)
  });
}

function attachmentContext(attachmentId: string) {
  return { params: { attachmentId } };
}
