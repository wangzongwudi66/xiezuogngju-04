import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finalLockAssetRecord, loginAsUser, seedWorkspace } from "@aigc/domain";
import { createDeliveryImportJob, getDeliveryImportWorkspace } from "../delivery-import-jobs/service";
import { mutateDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { mutateDeliveryPackage } from "../delivery-packages/service";
import { mutateAssetLockRecord } from "../asset-lock-records/service";
import { listAssetAttachments, resolveAssetAttachmentFilePath, uploadAssetAttachment } from "./service";

type UploadOverrides = {
  attachmentType: "reference" | "production" | "final";
  fileBuffer: Uint8Array;
  fileName: string;
  mime: string;
  note: string;
  uploadedByUserId: string;
};

describe("asset lock attachment service", () => {
  let storeDir: string;
  let attachmentDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-asset-lock-attachments-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  it("uploads valid PNG, JPEG, and PDF files and persists active metadata", async () => {
    const record = (await createAssetRecord()).record;
    const png = await upload(record.id, { fileName: "layout.png", mime: "image/png" });
    const jpeg = await upload(record.id, { fileName: "reference.jpeg", mime: "image/jpeg" });
    const pdf = await upload(record.id, { fileName: "brief.pdf", mime: "application/pdf" });
    const workspace = await getDeliveryImportWorkspace();

    expect([png, jpeg, pdf]).toEqual([
      expect.objectContaining({ fileId: expect.stringMatching(/^asset-att-/), version: 1, mime: "image/png" }),
      expect.objectContaining({ fileId: expect.stringMatching(/^asset-att-/), version: 2, mime: "image/jpeg" }),
      expect.objectContaining({ fileId: expect.stringMatching(/^asset-att-/), version: 3, mime: "application/pdf" })
    ]);
    expect(workspace.state.assetAttachments).toHaveLength(3);
    expect(await readSavedFileNames()).toHaveLength(3);
  });

  it("returns metadata without file paths or storage internals", async () => {
    const record = (await createAssetRecord()).record;
    const attachment = await upload(record.id);
    const serialized = JSON.stringify(attachment);

    expect(serialized).not.toContain("filePath");
    expect(serialized).not.toContain(".local-data");
    expect(serialized).not.toContain(storeDir);
    expect(serialized).not.toContain(resolve(attachmentDir));
  });

  it("lists only active attachments for a record", async () => {
    const record = (await createAssetRecord()).record;
    const first = await upload(record.id, { fileName: "first.png" });
    await upload(record.id, { fileName: "second.png" });
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      assetAttachments: state.assetAttachments?.map((attachment) =>
        attachment.id === first.id ? { ...attachment, status: "deleted" } : attachment
      )
    }));

    const attachments = await listAssetAttachments(record.id);

    expect(attachments).toHaveLength(1);
    expect(attachments[0].fileName).toBe("second.png");
  });

  it("rejects missing, empty, too large, and mismatched file types before writing metadata", async () => {
    const record = (await createAssetRecord()).record;

    await expect(upload(record.id, { fileName: "", fileBuffer: pngBytes() })).rejects.toThrow("asset_attachment_file_required");
    await expect(upload(record.id, { fileBuffer: new Uint8Array() })).rejects.toThrow("asset_attachment_file_empty");
    await expect(upload(record.id, { fileBuffer: new Uint8Array(20 * 1024 * 1024 + 1) })).rejects.toThrow(
      "asset_attachment_file_too_large"
    );
    await expect(upload(record.id, { fileName: "bad.gif", mime: "image/png" })).rejects.toThrow("asset_attachment_file_type_invalid");
    await expect(upload(record.id, { fileName: "bad.png", mime: "application/pdf" })).rejects.toThrow(
      "asset_attachment_file_type_invalid"
    );

    const workspace = await getDeliveryImportWorkspace();
    expect(workspace.state.assetAttachments ?? []).toHaveLength(0);
    await expect(readSavedFileNames()).resolves.toEqual([]);
  });

  it("rejects missing records, unauthorized actors, and locked records before writing files", async () => {
    const record = (await createAssetRecord()).record;

    await expect(upload("missing-record")).rejects.toThrow();
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      users: [...state.users, { id: "user-outsider", name: "Outsider", defaultRole: "creator", avatarTone: "ink" }]
    }));
    await expect(upload(record.id, { uploadedByUserId: "user-outsider" })).rejects.toThrow();

    await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-head-writer"
    });
    await login("user-creator-a");
    await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-creator-a"
    });
    await mutateDeliveryImportWorkspace((state) =>
      finalLockAssetRecord(state, {
        assetLockRecordId: record.id,
        lockedByUserId: "user-owner"
      })
    );

    await expect(upload(record.id)).rejects.toThrow();
    const workspace = await getDeliveryImportWorkspace();

    expect(workspace.state.assetAttachments ?? []).toHaveLength(0);
    await expect(readSavedFileNames()).resolves.toEqual([]);
  });

  it("uses server-generated paths even for malicious original file names", async () => {
    const record = (await createAssetRecord()).record;
    const attachment = await upload(record.id, { fileName: "../../x.png" });
    const savedFiles = await readSavedFileNames();

    expect(attachment.fileName).toBe("../../x.png");
    expect(savedFiles).toEqual([`${attachment.fileId}.png`]);
    expect(await readFile(join(attachmentDir, savedFiles[0]))).toEqual(Buffer.from(pngBytes()));
  });

  it("rejects resolved attachment paths that escape the base directory", async () => {
    expect(() => resolveAssetAttachmentFilePath("asset-att-123e4567-e89b-12d3-a456-426614174000", "../x.png")).toThrow(
      "asset_attachment_file_type_invalid"
    );
  });

  it("cleans up the saved file if metadata persistence fails", async () => {
    const record = (await createAssetRecord()).record;

    await expect(
      uploadAssetAttachment(
        buildUploadInput(record.id),
        {
          persistMetadata: async () => {
            throw new Error("forced_metadata_failure");
          }
        }
      )
    ).rejects.toThrow("forced_metadata_failure");

    const workspace = await getDeliveryImportWorkspace();
    expect(workspace.state.assetAttachments ?? []).toHaveLength(0);
    await expect(readSavedFileNames()).resolves.toEqual([]);
  });

  it("writes assetAttachments for legacy workspaces without the array", async () => {
    const { assetAttachments, ...legacyWorkspace } = seedWorkspace;
    await mutateDeliveryImportWorkspace(() => legacyWorkspace);
    const record = (await createAssetRecord()).record;
    const attachment = await upload(record.id);
    const workspace = await getDeliveryImportWorkspace();

    expect(workspace.state.assetAttachments).toContainEqual(attachment);
  });

  async function createAssetRecord() {
    const deliveryPackageId = await createPublishedDeliveryPackage();

    await login("user-head-writer");
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

  async function login(userId: string) {
    await mutateDeliveryImportWorkspace((state) => loginAsUser(state, userId));
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

  function upload(recordId: string, overrides: Partial<UploadOverrides> = {}) {
    return uploadAssetAttachment(buildUploadInput(recordId, overrides));
  }

  function buildUploadInput(recordId: string, overrides: Partial<UploadOverrides> = {}) {
    return {
      assetLockRecordId: recordId,
      uploadedByUserId: overrides.uploadedByUserId ?? "user-head-writer",
      attachmentType: overrides.attachmentType ?? "reference",
      note: overrides.note ?? "reference note",
      fileName: overrides.fileName ?? "reference.png",
      mime: overrides.mime ?? "image/png",
      fileBuffer: overrides.fileBuffer ?? pngBytes()
    } as const;
  }

  async function readSavedFileNames() {
    try {
      return await readdir(attachmentDir);
    } catch {
      return [];
    }
  }
});

function pngBytes() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
}
