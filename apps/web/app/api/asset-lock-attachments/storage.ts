import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const attachmentFileDirEnvKey = "AIGC_ASSET_LOCK_ATTACHMENT_FILE_DIR";
const defaultAttachmentFileDir = path.join(process.cwd(), ".local-data", "asset-lock-attachments");

export const allowedAssetAttachmentFileTypes: Record<string, { extension: string; mime: string }> = {
  ".jpg": { extension: ".jpg", mime: "image/jpeg" },
  ".jpeg": { extension: ".jpeg", mime: "image/jpeg" },
  ".png": { extension: ".png", mime: "image/png" },
  ".webp": { extension: ".webp", mime: "image/webp" },
  ".pdf": { extension: ".pdf", mime: "application/pdf" }
};

export class AssetAttachmentStorageFileNotFoundError extends Error {
  constructor() {
    super("asset_attachment_file_not_found");
    this.name = "AssetAttachmentStorageFileNotFoundError";
  }
}

export interface AssetAttachmentStorage {
  makeKey(input: { fileId: string; extension: string }): string;
  put(input: { key: string; bytes: Uint8Array; mime: string }): Promise<void>;
  get(input: { key: string }): Promise<Uint8Array>;
  delete?(input: { key: string }): Promise<void>;
}

export function createLocalAssetAttachmentStorage(): AssetAttachmentStorage {
  return localAssetAttachmentStorage;
}

export function resolveAssetAttachmentFilePath(fileId: string, extension: string) {
  return resolveAssetAttachmentStoragePath(makeLocalAssetAttachmentKey({ fileId, extension }));
}

const localAssetAttachmentStorage: AssetAttachmentStorage = {
  makeKey: makeLocalAssetAttachmentKey,
  async put(input) {
    const filePath = resolveAssetAttachmentStoragePath(input.key);

    await mkdir(/* turbopackIgnore: true */ path.dirname(filePath), { recursive: true });
    await writeFile(/* turbopackIgnore: true */ filePath, input.bytes);
  },
  async get(input) {
    const filePath = resolveAssetAttachmentStoragePath(input.key);

    try {
      return await readFile(/* turbopackIgnore: true */ filePath);
    } catch {
      throw new AssetAttachmentStorageFileNotFoundError();
    }
  },
  async delete(input) {
    const filePath = resolveAssetAttachmentStoragePath(input.key);

    await rm(/* turbopackIgnore: true */ filePath, { force: true });
  }
};

function makeLocalAssetAttachmentKey(input: { fileId: string; extension: string }) {
  return `${assertAssetAttachmentFileId(input.fileId)}${assertSafeExtension(input.extension)}`;
}

function resolveAssetAttachmentStoragePath(key: string) {
  const baseDir = path.resolve(/* turbopackIgnore: true */ resolveAssetAttachmentFileDir());
  const filePath = path.resolve(/* turbopackIgnore: true */ baseDir, assertSafeStorageKey(key));
  const relativePath = path.relative(baseDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("asset_attachment_file_path_invalid");
  }

  return filePath;
}

function assertSafeStorageKey(key: string) {
  const normalizedKey = key.trim();
  const extension = path.extname(normalizedKey);
  const fileId = normalizedKey.slice(0, -extension.length);
  const safeKey = makeLocalAssetAttachmentKey({ fileId, extension });

  if (safeKey !== normalizedKey) {
    throw new Error("asset_attachment_storage_key_invalid");
  }

  return safeKey;
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

  if (!allowedAssetAttachmentFileTypes[normalized]) {
    throw new Error("asset_attachment_file_type_invalid");
  }

  return normalized;
}
