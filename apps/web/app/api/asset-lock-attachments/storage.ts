import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import type { GetObjectCommandOutput, S3ClientConfig } from "@aws-sdk/client-s3";

const attachmentFileDirEnvKey = "AIGC_ASSET_LOCK_ATTACHMENT_FILE_DIR";
const attachmentStorageProviderEnvKey = "ASSET_LOCK_ATTACHMENT_STORAGE_PROVIDER";
const attachmentS3BucketEnvKey = "ASSET_LOCK_ATTACHMENT_S3_BUCKET";
const attachmentS3PrefixEnvKey = "ASSET_LOCK_ATTACHMENT_S3_PREFIX";
const attachmentS3RegionEnvKey = "ASSET_LOCK_ATTACHMENT_S3_REGION";
const attachmentS3EndpointEnvKey = "ASSET_LOCK_ATTACHMENT_S3_ENDPOINT";
const attachmentS3ForcePathStyleEnvKey = "ASSET_LOCK_ATTACHMENT_S3_FORCE_PATH_STYLE";
const defaultAttachmentFileDir = path.join(process.cwd(), ".local-data", "asset-lock-attachments");
const defaultS3ObjectPrefix = "asset-lock-attachments";

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
  delete(input: { key: string }): Promise<void>;
}

export type AssetAttachmentStorageProvider = "local" | "s3";
export type AssetAttachmentStorageEnv = Record<string, string | undefined>;
type S3AssetAttachmentCommand = PutObjectCommand | GetObjectCommand | DeleteObjectCommand;
export interface S3AssetAttachmentClient {
  send(command: S3AssetAttachmentCommand): Promise<unknown>;
}

export function createLocalAssetAttachmentStorage(): AssetAttachmentStorage {
  return localAssetAttachmentStorage;
}

export function createS3AssetAttachmentStorage(input: {
  bucket: string;
  client?: S3AssetAttachmentClient;
  prefix?: string;
}): AssetAttachmentStorage {
  const bucket = assertS3Bucket(input.bucket);
  const prefix = normalizeS3Prefix(input.prefix ?? defaultS3ObjectPrefix);
  const client = input.client ?? createS3ClientFromEnv();

  return {
    makeKey({ fileId, extension }) {
      return joinS3KeyPrefix(prefix, makeLocalAssetAttachmentKey({ fileId, extension }));
    },
    async put({ key, bytes, mime }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: assertSafeS3ObjectKey(key, prefix),
          Body: bytes,
          ContentType: mime
        })
      );
    },
    async get({ key }) {
      try {
        const output = (await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: assertSafeS3ObjectKey(key, prefix)
          })
        )) as GetObjectCommandOutput;

        return toUint8Array(output.Body);
      } catch (error) {
        if (isS3ObjectMissing(error)) {
          throw new AssetAttachmentStorageFileNotFoundError();
        }

        throw error;
      }
    },
    async delete({ key }) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: assertSafeS3ObjectKey(key, prefix)
        })
      );
    }
  };
}

export function resolveAssetAttachmentStorage(env: AssetAttachmentStorageEnv = process.env): AssetAttachmentStorage {
  const provider = resolveAssetAttachmentStorageProvider(env);

  if (provider === "local") {
    return createLocalAssetAttachmentStorage();
  }

  return createS3AssetAttachmentStorage({
    bucket: env[attachmentS3BucketEnvKey] ?? "",
    prefix: env[attachmentS3PrefixEnvKey]
  });
}

export function resolveAssetAttachmentStorageProvider(
  env: AssetAttachmentStorageEnv = process.env
): AssetAttachmentStorageProvider {
  const provider = env[attachmentStorageProviderEnvKey]?.trim().toLowerCase();

  if (!provider || provider === "local") {
    return "local";
  }

  if (provider === "s3") {
    if (!env[attachmentS3BucketEnvKey]?.trim()) {
      throw new Error("asset_attachment_storage_bucket_required");
    }

    return "s3";
  }

  throw new Error("asset_attachment_storage_provider_invalid");
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

function createS3ClientFromEnv(env: AssetAttachmentStorageEnv = process.env) {
  const config: S3ClientConfig = {
    region: env[attachmentS3RegionEnvKey]?.trim() || env.AWS_REGION || env.AWS_DEFAULT_REGION || "us-east-1"
  };
  const endpoint = env[attachmentS3EndpointEnvKey]?.trim();

  if (endpoint) {
    config.endpoint = endpoint;
  }

  if (isTruthy(env[attachmentS3ForcePathStyleEnvKey])) {
    config.forcePathStyle = true;
  }

  return new S3Client(config);
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

function joinS3KeyPrefix(prefix: string, key: string) {
  return prefix ? `${prefix}/${key}` : key;
}

function assertSafeS3ObjectKey(key: string, prefix: string) {
  const normalized = key.trim().replace(/\\/g, "/");
  const localKey = prefix ? normalized.slice(`${prefix}/`.length) : normalized;

  if (prefix && !normalized.startsWith(`${prefix}/`)) {
    throw new Error("asset_attachment_storage_key_invalid");
  }

  if (joinS3KeyPrefix(prefix, assertSafeStorageKey(localKey)) !== normalized) {
    throw new Error("asset_attachment_storage_key_invalid");
  }

  return normalized;
}

async function toUint8Array(body: GetObjectCommandOutput["Body"]) {
  if (!body) {
    return new Uint8Array();
  }

  if (body instanceof Uint8Array) {
    return body;
  }

  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }

  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }

  const streamBody = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
    transformToWebStream?: () => ReadableStream<Uint8Array>;
  };

  if (streamBody.transformToByteArray) {
    return streamBody.transformToByteArray();
  }

  if (streamBody.transformToWebStream) {
    return readWebStream(streamBody.transformToWebStream());
  }

  if (Symbol.asyncIterator in Object(body)) {
    return readAsyncIterable(body as AsyncIterable<Uint8Array | Buffer | string>);
  }

  throw new Error("asset_attachment_storage_body_invalid");
}

async function readWebStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return concatChunks(chunks);
}

async function readAsyncIterable(iterable: AsyncIterable<Uint8Array | Buffer | string>) {
  const chunks: Uint8Array[] = [];

  for await (const chunk of iterable) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
  }

  return concatChunks(chunks);
}

function concatChunks(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

function isS3ObjectMissing(error: unknown) {
  const metadata = getErrorProperty(error, "$metadata");

  return (
    error instanceof NoSuchKey ||
    getErrorProperty(error, "name") === "NoSuchKey" ||
    (metadata !== null && typeof metadata === "object" && "statusCode" in metadata && metadata.statusCode === 404)
  );
}

function getErrorProperty(error: unknown, key: string) {
  if (!error || typeof error !== "object" || !(key in error)) {
    return undefined;
  }

  return (error as Record<string, unknown>)[key];
}

function isTruthy(value: string | undefined) {
  return value?.trim().toLowerCase() === "true" || value?.trim() === "1";
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
