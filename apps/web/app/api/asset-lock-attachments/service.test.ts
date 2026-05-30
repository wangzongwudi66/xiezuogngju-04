import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finalLockAssetRecord, loginAsUser, seedWorkspace } from "@aigc/domain";
import type { AssetAttachment, AssetLockRecord, WorkspaceState } from "@aigc/domain";
import { createDeliveryImportJob, getDeliveryImportWorkspace } from "../delivery-import-jobs/service";
import { mutateDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { mutateDeliveryPackage } from "../delivery-packages/service";
import { mutateAssetLockRecord } from "../asset-lock-records/service";
import type { AssetAttachmentRepositorySnapshot, DbAssetAttachmentRepository } from "./repository";
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
    vi.restoreAllMocks();
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

    await expect(upload(record.id)).rejects.toThrow("asset_attachment_locked_record_upload_forbidden");
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

  it("uses only DB metadata for list, download, and delete when local metadata is stale", async () => {
    const record = (await createAssetRecord()).record;
    const staleLocal = buildAttachmentForRecord(record, {
      id: "asset-attachment-local-stale",
      fileId: "asset-att-123e4567-e89b-12d3-a456-426614174001",
      fileName: "stale-local.png"
    });
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      assetAttachments: [staleLocal]
    }));

    const workspace = await getDeliveryImportWorkspace();
    const dbAttachment = buildAttachmentForRecord(record, {
      id: "asset-attachment-db",
      fileId: "asset-att-123e4567-e89b-12d3-a456-426614174002",
      fileName: "db-reference.png"
    });
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(resolveAssetAttachmentFilePath(dbAttachment.fileId, ".png"), pngBytes());
    await writeFile(resolveAssetAttachmentFilePath(staleLocal.fileId, ".png"), new Uint8Array([9, 9, 9]));

    const repository = createMockDbAssetAttachmentRepository(
      snapshotFromState({
        ...workspace.state,
        assetAttachments: [dbAttachment]
      })
    );

    const listed = await listAssetAttachmentsForActor(record.id, { userId: currentActorUserId }, { repository });
    const downloaded = await downloadAssetAttachmentForActor(dbAttachment.id, { userId: currentActorUserId }, { repository });
    const deleted = await deleteAssetAttachmentForActor(dbAttachment.id, { userId: currentActorUserId }, { repository });
    const listedAfterDelete = await listAssetAttachmentsForActor(record.id, { userId: currentActorUserId }, { repository });

    expect(listed).toEqual([dbAttachment]);
    await expect(downloadAssetAttachmentForActor(staleLocal.id, { userId: currentActorUserId }, { repository })).rejects.toThrow(
      "asset_attachment_not_found"
    );
    expect(Buffer.from(downloaded.bytes)).toEqual(Buffer.from(pngBytes()));
    expect(deleted).toMatchObject({
      id: dbAttachment.id,
      status: "deleted",
      deletedByUserId: "user-head-writer"
    });
    expect(listedAfterDelete).toEqual([]);
    await expect(getDeliveryImportWorkspace()).resolves.toMatchObject({
      state: {
        assetAttachments: [staleLocal]
      }
    });
  });

  it("uploads through the DB repository without mutating local workspace metadata", async () => {
    const record = (await createAssetRecord()).record;
    const workspace = await getDeliveryImportWorkspace();
    const repository = createMockDbAssetAttachmentRepository(snapshotFromState(workspace.state));

    const attachment = await uploadAssetAttachment(buildUploadInput(record.id), { userId: currentActorUserId }, { repository });
    const persisted = await getDeliveryImportWorkspace();

    expect(repository.read).toHaveBeenCalledTimes(1);
    expect(repository.createAssetAttachmentMetadata).toHaveBeenCalledTimes(1);
    expect(attachment).toMatchObject({
      assetLockRecordId: record.id,
      fileId: expect.stringMatching(/^asset-att-/),
      status: "active"
    });
    expect(persisted.state.assetAttachments ?? []).toEqual([]);
    await expect(readSavedFileNames()).resolves.toEqual([`${attachment.fileId}.png`]);
  });

  it("returns DB-committed attachment metadata when DB upload reallocates version", async () => {
    const record = (await createAssetRecord()).record;
    const workspace = await getDeliveryImportWorkspace();
    const repository = createMockDbAssetAttachmentRepository(snapshotFromState(workspace.state), {
      createCommittedAttachment: (command) => ({ ...command.attachment, version: command.attachment.version + 1 })
    });

    const attachment = await uploadAssetAttachment(buildUploadInput(record.id), { userId: currentActorUserId }, { repository });

    expect(repository.createAssetAttachmentMetadata).toHaveBeenCalledTimes(1);
    expect(repository.createAssetAttachmentMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: expect.objectContaining({ version: 1 })
      })
    );
    expect(attachment).toMatchObject({
      assetLockRecordId: record.id,
      version: 2,
      status: "active"
    });
    await expect(readSavedFileNames()).resolves.toEqual([`${attachment.fileId}.png`]);
  });

  it("uses DB-only asset lock records for DB attachment upload, list, download, and delete validation", async () => {
    const deliveryPackageId = await createPublishedDeliveryPackage([1, 2]);
    const workspace = await getDeliveryImportWorkspace();
    const dbOnlyRecord = buildDbOnlyAssetLockRecord({ deliveryPackageId });
    const repository = createMockDbAssetAttachmentRepository(
      snapshotFromState({
        ...workspace.state,
        assetLockRecords: [dbOnlyRecord],
        assetAttachments: []
      })
    );

    const attachment = await uploadAssetAttachment(
      buildUploadInput(dbOnlyRecord.id, { fileName: "db-only.png", fileBuffer: pngBytes() }),
      { userId: currentActorUserId },
      { repository }
    );
    const listed = await listAssetAttachmentsForActor(dbOnlyRecord.id, { userId: currentActorUserId }, { repository });
    const downloaded = await downloadAssetAttachmentForActor(attachment.id, { userId: currentActorUserId }, { repository });
    const deleted = await deleteAssetAttachmentForActor(attachment.id, { userId: currentActorUserId }, { repository });
    const listedAfterDelete = await listAssetAttachmentsForActor(dbOnlyRecord.id, { userId: currentActorUserId }, { repository });
    const persisted = await getDeliveryImportWorkspace();

    expect(workspace.state.assetLockRecords ?? []).not.toContainEqual(dbOnlyRecord);
    expect(attachment).toMatchObject({
      assetLockRecordId: dbOnlyRecord.id,
      deliveryPackageId,
      status: "active"
    });
    expect(listed).toEqual([attachment]);
    expect(Buffer.from(downloaded.bytes)).toEqual(Buffer.from(pngBytes()));
    expect(deleted).toMatchObject({
      id: attachment.id,
      status: "deleted",
      deletedByUserId: "user-head-writer"
    });
    expect(listedAfterDelete).toEqual([]);
    expect(persisted.state.assetLockRecords ?? []).not.toContainEqual(dbOnlyRecord);
    expect(persisted.state.assetAttachments ?? []).toEqual([]);
  });

  it("cleans up the saved file if DB metadata commit fails", async () => {
    const record = (await createAssetRecord()).record;
    const workspace = await getDeliveryImportWorkspace();
    const repository = createMockDbAssetAttachmentRepository(snapshotFromState(workspace.state), {
      createError: new Error("forced_db_metadata_failure")
    });

    await expect(
      uploadAssetAttachment(buildUploadInput(record.id), { userId: currentActorUserId }, { repository })
    ).rejects.toThrow("forced_db_metadata_failure");

    const persisted = await getDeliveryImportWorkspace();
    expect(repository.createAssetAttachmentMetadata).toHaveBeenCalledTimes(1);
    expect(persisted.state.assetAttachments ?? []).toHaveLength(0);
    await expect(readSavedFileNames()).resolves.toEqual([]);
  });

  it("validates DB upload and delete permission before writing metadata", async () => {
    const record = (await createAssetRecord()).record;
    await addOutsider();
    const workspace = await getDeliveryImportWorkspace();
    const dbAttachment = buildAttachmentForRecord(record, {
      uploadedByUserId: "user-creator-a"
    });
    const uploadRepository = createMockDbAssetAttachmentRepository(snapshotFromState(workspace.state));

    await expect(
      uploadAssetAttachment(buildUploadInput(record.id), { userId: "user-outsider" }, { repository: uploadRepository })
    ).rejects.toThrow("asset_attachment_project_member_required");

    const deleteRepository = createMockDbAssetAttachmentRepository(
      snapshotFromState({
        ...workspace.state,
        assetAttachments: [dbAttachment]
      })
    );

    await expect(
      deleteAssetAttachmentForActor(dbAttachment.id, { userId: "user-head-writer" }, { repository: deleteRepository })
    ).rejects.toThrow("asset_attachment_delete_forbidden");
    expect(uploadRepository.createAssetAttachmentMetadata).not.toHaveBeenCalled();
    expect(deleteRepository.softDeleteAssetAttachmentMetadata).not.toHaveBeenCalled();
    await expect(readSavedFileNames()).resolves.toEqual([]);
  });

  it("validates locked records before DB upload and soft delete writes", async () => {
    const record = (await createAssetRecord()).record;
    await lockRecord(record.id);
    const workspace = await getDeliveryImportWorkspace();
    const lockedRecord = (workspace.state.assetLockRecords ?? []).find((item) => item.id === record.id);

    if (!lockedRecord) {
      throw new Error("locked record missing");
    }

    const dbAttachment = buildAttachmentForRecord(lockedRecord);
    const uploadRepository = createMockDbAssetAttachmentRepository(snapshotFromState(workspace.state));
    const deleteRepository = createMockDbAssetAttachmentRepository(
      snapshotFromState({
        ...workspace.state,
        assetAttachments: [dbAttachment]
      })
    );

    await expect(
      uploadAssetAttachment(buildUploadInput(record.id), { userId: currentActorUserId }, { repository: uploadRepository })
    ).rejects.toThrow("asset_attachment_locked_record_upload_forbidden");
    await expect(
      deleteAssetAttachmentForActor(dbAttachment.id, { userId: currentActorUserId }, { repository: deleteRepository })
    ).rejects.toThrow("asset_attachment_locked_record_delete_forbidden");
    expect(uploadRepository.createAssetAttachmentMetadata).not.toHaveBeenCalled();
    expect(deleteRepository.softDeleteAssetAttachmentMetadata).not.toHaveBeenCalled();
    await expect(readSavedFileNames()).resolves.toEqual([]);
  });

  it("propagates a stable DB soft-delete miss when the active row is already gone", async () => {
    const record = (await createAssetRecord()).record;
    const workspace = await getDeliveryImportWorkspace();
    const dbAttachment = buildAttachmentForRecord(record);
    const repository = createMockDbAssetAttachmentRepository(
      snapshotFromState({
        ...workspace.state,
        assetAttachments: [dbAttachment]
      }),
      {
        softDeleteError: new Error("asset_attachment_not_found")
      }
    );

    await expect(
      deleteAssetAttachmentForActor(dbAttachment.id, { userId: currentActorUserId }, { repository })
    ).rejects.toThrow("asset_attachment_not_found");
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

  function buildAttachmentForRecord(record: AssetLockRecord, overrides: Partial<AssetAttachment> = {}): AssetAttachment {
    return {
      id: "asset-attachment-1",
      projectId: record.projectId,
      assetLockRecordId: record.id,
      deliveryPackageId: record.deliveryPackageId,
      fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000",
      fileName: "reference.png",
      mime: "image/png",
      size: pngBytes().byteLength,
      version: 1,
      attachmentType: "reference",
      uploadedByUserId: "user-head-writer",
      uploadedAt: "2026-05-29T00:00:00.000Z",
      status: "active",
      ...overrides
    };
  }

  function buildDbOnlyAssetLockRecord(overrides: Partial<AssetLockRecord> = {}): AssetLockRecord {
    return {
      id: "asset-lock-db-only",
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-1",
      episodeNos: [1, 2],
      assetName: "DB Only Mine Lift",
      assetType: "scene",
      changeType: "new",
      writerConfirmation: "pending",
      productionConfirmation: "pending",
      risk: "attention",
      status: "draft",
      createdByUserId: "user-head-writer",
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z",
      ...overrides
    };
  }

  function createMockDbAssetAttachmentRepository(
    initialSnapshot: AssetAttachmentRepositorySnapshot,
    options: {
      createError?: Error;
      softDeleteError?: Error;
      createCommittedAttachment?: (
        command: Parameters<DbAssetAttachmentRepository["createAssetAttachmentMetadata"]>[0],
        snapshot: AssetAttachmentRepositorySnapshot
      ) => AssetAttachment;
    } = {}
  ): DbAssetAttachmentRepository {
    let currentSnapshot = initialSnapshot;

    return {
      mode: "db",
      read: vi.fn(async () => currentSnapshot),
      createAssetAttachmentMetadata: vi.fn(async (command) => {
        if (options.createError) {
          throw options.createError;
        }

        const committedAttachment = options.createCommittedAttachment?.(command, currentSnapshot) ?? command.attachment;

        currentSnapshot = snapshotFromState({
          ...currentSnapshot.state,
          assetAttachments: [...currentSnapshot.assetAttachments, committedAttachment]
        });

        return committedAttachment;
      }),
      softDeleteAssetAttachmentMetadata: vi.fn(async (input) => {
        if (options.softDeleteError) {
          throw options.softDeleteError;
        }

        const attachment = currentSnapshot.assetAttachments.find(
          (item) => item.id === input.assetAttachmentId && item.status === "active"
        );

        if (!attachment) {
          throw new Error("asset_attachment_not_found");
        }

        const deleted: AssetAttachment = {
          ...attachment,
          status: "deleted",
          deletedByUserId: input.deletedByUserId,
          deletedAt: "2026-05-29T03:00:00.000Z"
        };

        currentSnapshot = snapshotFromState({
          ...currentSnapshot.state,
          assetAttachments: currentSnapshot.assetAttachments.map((item) => (item.id === deleted.id ? deleted : item))
        });

        return deleted;
      })
    };
  }

  function snapshotFromState(state: WorkspaceState): AssetAttachmentRepositorySnapshot {
    const assetAttachments = state.assetAttachments ?? [];

    return {
      state: {
        ...state,
        assetAttachments
      },
      assetAttachments
    };
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
