import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";

const attachmentFileDirEnvKey = "AIGC_ASSET_LOCK_ATTACHMENT_FILE_DIR";
const defaultAttachmentFileDir = path.join(process.cwd(), ".local-data", "asset-lock-attachments");
const defaultS3ObjectPrefix = "asset-lock-attachments";

export interface AssetAttachmentStorageAuditObject {
  key: string;
  sizeBytes: number;
  lastModified?: Date;
}

export interface AssetAttachmentStorageAuditAdapter {
  listObjects(): AsyncIterable<AssetAttachmentStorageAuditObject>;
}

export interface S3AssetAttachmentAuditClient {
  send(command: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput>;
}

export function createLocalAssetAttachmentStorageAuditAdapter(input: { dir?: string } = {}): AssetAttachmentStorageAuditAdapter {
  const dir = path.resolve(input.dir ?? resolveAssetAttachmentFileDir());

  return {
    listObjects() {
      return listLocalObjects(dir);
    }
  };
}

export function createS3AssetAttachmentStorageAuditAdapter(input: {
  bucket: string;
  client: S3AssetAttachmentAuditClient;
  prefix?: string;
}): AssetAttachmentStorageAuditAdapter {
  const bucket = assertS3Bucket(input.bucket);
  const prefix = normalizeS3Prefix(input.prefix ?? defaultS3ObjectPrefix);

  return {
    listObjects() {
      return listS3Objects({
        bucket,
        client: input.client,
        prefix
      });
    }
  };
}

async function* listLocalObjects(dir: string, keyPrefix = ""): AsyncIterable<AssetAttachmentStorageAuditObject> {
  let entries: Dirent[];

  try {
    entries = await readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT") && !keyPrefix) {
      return;
    }

    throw new Error("asset_attachment_local_audit_list_failed");
  }

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    const key = keyPrefix ? `${keyPrefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      yield* listLocalObjects(filePath, key);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    let fileStats: Awaited<ReturnType<typeof stat>>;

    try {
      fileStats = await stat(/* turbopackIgnore: true */ filePath);
    } catch {
      throw new Error("asset_attachment_local_audit_list_failed");
    }

    yield {
      key: key.replace(/\\/g, "/"),
      sizeBytes: fileStats.size,
      lastModified: fileStats.mtime
    };
  }
}

async function* listS3Objects(input: {
  bucket: string;
  client: S3AssetAttachmentAuditClient;
  prefix: string;
}): AsyncIterable<AssetAttachmentStorageAuditObject> {
  let continuationToken: string | undefined;

  do {
    let output: ListObjectsV2CommandOutput;

    try {
      output = await input.client.send(
        new ListObjectsV2Command({
          Bucket: input.bucket,
          ...(input.prefix ? { Prefix: `${input.prefix}/` } : {}),
          ...(continuationToken ? { ContinuationToken: continuationToken } : {})
        })
      );
    } catch {
      throw new Error("asset_attachment_s3_audit_list_failed");
    }

    for (const object of output.Contents ?? []) {
      if (!object.Key) {
        continue;
      }

      yield {
        key: object.Key,
        sizeBytes: object.Size ?? 0,
        ...(object.LastModified ? { lastModified: object.LastModified } : {})
      };
    }

    continuationToken = output.IsTruncated ? output.NextContinuationToken : undefined;
  } while (continuationToken);
}

function resolveAssetAttachmentFileDir() {
  return process.env[attachmentFileDirEnvKey] || defaultAttachmentFileDir;
}

function assertS3Bucket(bucket: string) {
  const normalized = bucket.trim();

  if (!normalized) {
    throw new Error("asset_attachment_storage_bucket_required");
  }

  return normalized;
}

function normalizeS3Prefix(prefix: string) {
  const normalized = prefix.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

  if (!normalized) {
    return "";
  }

  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("asset_attachment_storage_prefix_invalid");
  }

  return normalized;
}

function isNodeErrorCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
