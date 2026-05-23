import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAssetAttachmentMetadata, listAssetAttachmentsForRecord } from "@aigc/domain";
import type { AssetAttachment, AssetAttachmentType, WorkspaceState } from "@aigc/domain";
import { mutateDeliveryImportWorkspace, readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";

const attachmentFileDirEnvKey = "AIGC_ASSET_LOCK_ATTACHMENT_FILE_DIR";
const defaultAttachmentFileDir = path.join(process.cwd(), ".local-data", "asset-lock-attachments");
const maxAttachmentBytes = 20 * 1024 * 1024;
const allowedAttachmentTypes: Record<string, { extension: string; mime: string }> = {
  ".jpg": { extension: ".jpg", mime: "image/jpeg" },
  ".jpeg": { extension: ".jpeg", mime: "image/jpeg" },
  ".png": { extension: ".png", mime: "image/png" },
  ".webp": { extension: ".webp", mime: "image/webp" },
  ".pdf": { extension: ".pdf", mime: "application/pdf" }
};

export interface AssetAttachmentUploadInput {
  assetLockRecordId: string;
  uploadedByUserId: string;
  attachmentType: AssetAttachmentType;
  note?: string;
  fileName: string;
  mime: string;
  fileBuffer: ArrayBuffer | Uint8Array;
}

export async function uploadAssetAttachment(
  input: AssetAttachmentUploadInput,
  options: {
    persistMetadata?: typeof mutateDeliveryImportWorkspace;
  } = {}
): Promise<AssetAttachment> {
  const bytes = input.fileBuffer instanceof Uint8Array ? input.fileBuffer : new Uint8Array(input.fileBuffer);
  const fileRule = validateAttachmentFile({
    fileName: input.fileName,
    mime: input.mime,
    size: bytes.byteLength
  });
  const fileId = createAssetAttachmentFileId();
  const metadataInput = {
    assetLockRecordId: input.assetLockRecordId,
    fileId,
    fileName: input.fileName,
    mime: fileRule.mime,
    size: bytes.byteLength,
    attachmentType: input.attachmentType,
    uploadedByUserId: input.uploadedByUserId,
    note: input.note
  };

  const workspace = await readDeliveryImportWorkspace();
  createAssetAttachmentMetadata(workspace.state, metadataInput);
  const filePath = resolveAssetAttachmentFilePath(fileId, fileRule.extension);
  const persistMetadata = options.persistMetadata ?? mutateDeliveryImportWorkspace;

  await mkdir(/* turbopackIgnore: true */ path.dirname(filePath), { recursive: true });
  await writeFile(/* turbopackIgnore: true */ filePath, bytes);

  try {
    const snapshot = await persistMetadata((state) => createAssetAttachmentMetadata(state, metadataInput));
    const attachment = findCreatedAttachment(snapshot.state, fileId);

    if (!attachment) {
      throw new Error("asset_attachment_metadata_not_created");
    }

    return attachment;
  } catch (error) {
    await rm(/* turbopackIgnore: true */ filePath, { force: true });
    throw error;
  }
}

export async function listAssetAttachments(recordId: string) {
  const workspace = await readDeliveryImportWorkspace();
  return listAssetAttachmentsForRecord(workspace.state, recordId);
}

export function resolveAssetAttachmentFilePath(fileId: string, extension: string) {
  const baseDir = path.resolve(/* turbopackIgnore: true */ resolveAssetAttachmentFileDir());
  const filePath = path.resolve(/* turbopackIgnore: true */ baseDir, `${assertAssetAttachmentFileId(fileId)}${assertSafeExtension(extension)}`);
  const relativePath = path.relative(baseDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("asset_attachment_file_path_invalid");
  }

  return filePath;
}

function validateAttachmentFile(input: { fileName: string; mime: string; size: number }) {
  if (!input.fileName.trim()) {
    throw new Error("asset_attachment_file_required");
  }

  if (input.size <= 0) {
    throw new Error("asset_attachment_file_empty");
  }

  if (input.size > maxAttachmentBytes) {
    throw new Error("asset_attachment_file_too_large");
  }

  const extension = path.extname(input.fileName).toLowerCase();
  const fileRule = allowedAttachmentTypes[extension];

  if (!fileRule) {
    throw new Error("asset_attachment_file_type_invalid");
  }

  if (input.mime.trim().toLowerCase() !== fileRule.mime) {
    throw new Error("asset_attachment_file_type_invalid");
  }

  return fileRule;
}

function findCreatedAttachment(state: WorkspaceState, fileId: string) {
  return (state.assetAttachments ?? []).find((attachment) => attachment.fileId === fileId) ?? null;
}

function resolveAssetAttachmentFileDir() {
  return process.env[attachmentFileDirEnvKey] || defaultAttachmentFileDir;
}

function assertAssetAttachmentFileId(fileId: string) {
  if (!/^asset-att-[a-f0-9-]{36}$/i.test(fileId)) {
    throw new Error("asset_attachment_file_id_invalid");
  }

  return fileId;
}

function assertSafeExtension(extension: string) {
  const normalized = extension.toLowerCase();

  if (!allowedAttachmentTypes[normalized]) {
    throw new Error("asset_attachment_file_type_invalid");
  }

  return normalized;
}

function createAssetAttachmentFileId() {
  return `asset-att-${randomUUID()}`;
}
