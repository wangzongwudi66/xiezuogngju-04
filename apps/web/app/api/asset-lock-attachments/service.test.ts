import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finalLockAssetRecord, loginAsUser, seedWorkspace } from "@aigc/domain";
import { createDeliveryImportJob, getDeliveryImportWorkspace } from "../delivery-import-jobs/service";
import { mutateDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { mutateDeliveryPackage } from "../delivery-packages/service";
import { mutateAssetLockRecord } from "../asset-lock-records/service";
import {
  deleteAssetAttachment as deleteAssetAttachmentForActor,
  downloadAssetAttachment as downloadAssetAttachmentForActor,
  listAssetAttachments as listAssetAttachmentsForActor,
  resolveAssetAttachmentFilePath,
  uploadAssetAttachment
} from "./service";

type UploadOverrides = {
  attachmentType: "reference" | "production" | "final";
  fileBuffer: Uint8Array;
  fileName: string;
  mime: string;
  note: string;
  actorUserId: string;
};

let currentActorUserId = "user-head-writer";

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

    const attachments = await list(record.id);

    expect(attachments).toHaveLength(1);
    expect(attachments[0].fileName).toBe("second.png");
  });

  it("rejects list requests without a logged-in project member", async () => {
    const record = (await createAssetRecord()).record;
    await upload(record.id);

    await mutateDeliveryImportWorkspace((state) => ({ ...state, currentUserId: null }));
    currentActorUserId = "";
    await expect(list(record.id)).rejects.toThrow("asset_attachment_unauthenticated");

    await addOutsider();
    await login("user-outsider");
    await expect(list(record.id)).rejects.toThrow("asset_attachment_project_member_required");
  });

  it("lists attachments only when writer and creator users can see the asset record", async () => {
    const visibleRecord = (await createAssetRecord({ episodeNos: [1] })).record;
    const hiddenRecord = (await createAssetRecord({ episodeNos: [30] })).record;
    const visibleAttachment = await upload(visibleRecord.id, { fileName: "visible.png" });
    await upload(hiddenRecord.id, { fileName: "hidden.png" });

    await login("user-writer");
    await expect(list(visibleRecord.id)).resolves.toEqual([visibleAttachment]);
    await expect(list(hiddenRecord.id)).rejects.toThrow("asset_attachment_forbidden");

    await login("user-creator-a");
    await expect(list(visibleRecord.id)).resolves.toEqual([visibleAttachment]);
    await expect(list(hiddenRecord.id)).rejects.toThrow("asset_attachment_forbidden");
  });

  it("downloads active attachment content for a visible project member", async () => {
    const record = (await createAssetRecord()).record;
    const attachment = await upload(record.id, { fileName: "layout.png", fileBuffer: pngBytes() });

    const downloaded = await download(attachment.id);
    const serialized = JSON.stringify(downloaded);

    expect(downloaded).toMatchObject({
      fileName: "layout.png",
      mime: "image/png",
      size: pngBytes().byteLength
    });
    expect(Buffer.from(downloaded.bytes)).toEqual(Buffer.from(pngBytes()));
    expect(serialized).not.toContain("filePath");
    expect(serialized).not.toContain(".local-data");
    expect(serialized).not.toContain(storeDir);
    expect(serialized).not.toContain(resolve(attachmentDir));
  });

  it("uses the explicit actor when workspace currentUserId differs for upload and delete", async () => {
    const record = (await createAssetRecord()).record;
    await mutateDeliveryImportWorkspace((state) => ({ ...state, currentUserId: "user-creator-b" }));
    currentActorUserId = "user-head-writer";

    const attachment = await upload(record.id);
    const deleted = await remove(attachment.id);

    expect(attachment.uploadedByUserId).toBe("user-head-writer");
    expect(deleted).toMatchObject({
      id: attachment.id,
      status: "deleted",
      deletedByUserId: "user-head-writer"
    });
  });

  it("allows writer downloads only for visible assigned records", async () => {
    const visibleRecord = (await createAssetRecord({ episodeNos: [1] })).record;
    const hiddenRecord = (await createAssetRecord({ episodeNos: [30] })).record;
    const visibleAttachment = await upload(visibleRecord.id, { fileName: "writer-visible.png" });
    const hiddenAttachment = await upload(hiddenRecord.id, { fileName: "writer-hidden.png" });

    await login("user-writer");

    await expect(download(visibleAttachment.id)).resolves.toMatchObject({ fileName: "writer-visible.png" });
    await expect(download(hiddenAttachment.id)).rejects.toThrow("asset_attachment_forbidden");
  });

  it("soft deletes active attachments without removing stored files", async () => {
    const record = (await createAssetRecord()).record;
    const attachment = await upload(record.id);
    const savedFilesBeforeDelete = await readSavedFileNames();

    const deleted = await remove(attachment.id);
    const workspace = await getDeliveryImportWorkspace();
    const persisted = workspace.state.assetAttachments?.find((item) => item.id === attachment.id);
    const serialized = JSON.stringify(deleted);

    expect(deleted).toMatchObject({
      id: attachment.id,
      status: "deleted",
      deletedByUserId: "user-head-writer",
      deletedAt: expect.any(String)
    });
    expect(persisted).toMatchObject({ status: "deleted", deletedByUserId: "user-head-writer" });
    await expect(list(record.id)).resolves.toEqual([]);
    await expect(readSavedFileNames()).resolves.toEqual(savedFilesBeforeDelete);
    expect(serialized).not.toContain("filePath");
    expect(serialized).not.toContain(".local-data");
    expect(serialized).not.toContain(storeDir);
    expect(serialized).not.toContain(resolve(attachmentDir));
  });

  it("allows owner and coordinator deletes but blocks head writer deletes for attachments uploaded by someone else", async () => {
    await addProjectOwner();
    const record = (await createAssetRecord()).record;
    await login("user-creator-a");
    const ownerDeletedAttachment = await upload(record.id, { fileName: "owner-delete.png" });
    const coordinatorDeletedAttachment = await upload(record.id, { fileName: "coordinator-delete.png" });
    const headWriterBlockedAttachment = await upload(record.id, { fileName: "head-writer-blocked.png" });

    await login("user-project-owner");
    await expect(remove(ownerDeletedAttachment.id)).resolves.toMatchObject({
      id: ownerDeletedAttachment.id,
      status: "deleted",
      deletedByUserId: "user-project-owner"
    });

    await login("user-owner");
    await expect(remove(coordinatorDeletedAttachment.id)).resolves.toMatchObject({
      id: coordinatorDeletedAttachment.id,
      status: "deleted",
      deletedByUserId: "user-owner"
    });

    await login("user-head-writer");
    await expect(remove(headWriterBlockedAttachment.id)).rejects.toThrow("asset_attachment_delete_forbidden");
  });

  it("requires membership and record visibility before downloading or deleting", async () => {
    const record = (await createAssetRecord()).record;
    const attachment = await upload(record.id);

    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      users: [...state.users, { id: "user-outsider", name: "Outsider", defaultRole: "creator", avatarTone: "ink" }]
    }));
    await login("user-outsider");
    await expect(download(attachment.id)).rejects.toThrow("asset_attachment_project_member_required");
    await expect(remove(attachment.id)).rejects.toThrow("asset_attachment_project_member_required");

    await login("user-creator-b");
    await expect(download(attachment.id)).rejects.toThrow("asset_attachment_forbidden");
    await expect(remove(attachment.id)).rejects.toThrow("asset_attachment_forbidden");

    await login("user-creator-a");
    await expect(download(attachment.id)).resolves.toMatchObject({ fileName: "reference.png" });
    await expect(remove(attachment.id)).rejects.toThrow("asset_attachment_delete_forbidden");
  });

  it("blocks every attachment delete for locked records while downloads still work", async () => {
    const record = (await createAssetRecord()).record;
    const first = await upload(record.id, { fileName: "first.png" });
    const second = await upload(record.id, { fileName: "second.png" });
    await lockRecord(record.id);
    await login("user-owner");

    await expect(remove(first.id)).rejects.toThrow("asset_attachment_locked_record_delete_forbidden");
    await expect(remove(second.id)).rejects.toThrow("asset_attachment_locked_record_delete_forbidden");
    await expect(download(first.id)).resolves.toMatchObject({ fileName: "first.png" });
    await expect(download(second.id)).resolves.toMatchObject({ fileName: "second.png" });

    const workspace = await getDeliveryImportWorkspace();
    expect(workspace.state.assetAttachments?.find((attachment) => attachment.id === first.id)?.status).toBe("active");
    expect(workspace.state.assetAttachments?.find((attachment) => attachment.id === second.id)?.status).toBe("active");
    await expect(readSavedFileNames()).resolves.toEqual(expect.arrayContaining([`${first.fileId}.png`, `${second.fileId}.png`]));
  });

  it("rejects inactive attachments for download and delete", async () => {
    const record = (await createAssetRecord()).record;
    const attachment = await upload(record.id);
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      assetAttachments: state.assetAttachments?.map((item) => (item.id === attachment.id ? { ...item, status: "deleted" } : item))
    }));

    await expect(download(attachment.id)).rejects.toThrow("asset_attachment_not_found");
    await expect(remove(attachment.id)).rejects.toThrow("asset_attachment_not_found");

    const workspace = await getDeliveryImportWorkspace();
    expect(workspace.state.assetAttachments?.find((item) => item.id === attachment.id)?.status).toBe("deleted");
    await expect(readSavedFileNames()).resolves.toEqual([`${attachment.fileId}.png`]);
    await expect(list(record.id)).resolves.toEqual([]);
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
    await expect(upload(record.id, { actorUserId: "user-outsider" })).rejects.toThrow();

    await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-head-writer"
    }, { userId: currentActorUserId });
    await login("user-creator-a");
    await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-creator-a"
    }, { userId: currentActorUserId });
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

  it("rejects damaged fileId metadata before resolving a download path", async () => {
    const record = (await createAssetRecord()).record;
    const attachment = await upload(record.id);
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      assetAttachments: state.assetAttachments?.map((item) =>
        item.id === attachment.id ? { ...item, fileId: "../asset-att-123e4567-e89b-12d3-a456-426614174000" } : item
      )
    }));

    await expect(download(attachment.id)).rejects.toThrow("asset_attachment_file_id_invalid");
  });

  it("cleans up the saved file if metadata persistence fails", async () => {
    const record = (await createAssetRecord()).record;

    await expect(
      uploadAssetAttachment(
        buildUploadInput(record.id),
        { userId: currentActorUserId },
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
    }, { userId: currentActorUserId });
  }

  async function login(userId: string) {
    currentActorUserId = userId;
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

  async function addProjectOwner() {
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      users: state.users.some((user) => user.id === "user-project-owner")
        ? state.users
        : [...state.users, { id: "user-project-owner", name: "Project Owner", defaultRole: "owner", avatarTone: "ink" }],
      members: state.members.some((member) => member.projectId === "project-jincheng" && member.userId === "user-project-owner")
        ? state.members
        : [
            ...state.members,
            {
              id: "member-owner-role-jc",
              projectId: "project-jincheng",
              userId: "user-project-owner",
              role: "owner",
              createdAt: new Date().toISOString()
            }
          ]
    }));
  }

  async function lockRecord(assetLockRecordId: string) {
    await login("user-head-writer");
    await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId
    }, { userId: currentActorUserId });
    await login("user-creator-a");
    await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId
    }, { userId: currentActorUserId });
    await login("user-owner");
    await mutateAssetLockRecord({
      action: "final_lock",
      assetLockRecordId
    }, { userId: currentActorUserId });
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

  function upload(recordId: string, overrides: Partial<UploadOverrides> = {}) {
    return uploadAssetAttachment(buildUploadInput(recordId, overrides), { userId: overrides.actorUserId ?? currentActorUserId });
  }

  function list(recordId: string) {
    return listAssetAttachmentsForActor(recordId, { userId: currentActorUserId });
  }

  function download(attachmentId: string) {
    return downloadAssetAttachmentForActor(attachmentId, { userId: currentActorUserId });
  }

  function remove(attachmentId: string) {
    return deleteAssetAttachmentForActor(attachmentId, { userId: currentActorUserId });
  }

  function buildUploadInput(recordId: string, overrides: Partial<UploadOverrides> = {}) {
    return {
      assetLockRecordId: recordId,
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
