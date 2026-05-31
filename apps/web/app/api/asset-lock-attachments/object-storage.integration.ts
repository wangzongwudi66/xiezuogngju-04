import { createHash, randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  NoSuchKey,
  S3Client
} from "@aws-sdk/client-s3";
import type {
  GetObjectCommandOutput,
  HeadObjectCommandOutput,
  ListObjectsV2CommandOutput,
  S3ClientConfig
} from "@aws-sdk/client-s3";
import { seedWorkspace } from "@aigc/domain";
import type { AssetLockRecord, WorkspaceState } from "@aigc/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashAssetAttachmentAuditKey, runAssetAttachmentOrphanAudit } from "./orphan-audit";
import type { AssetAttachmentReferencedRow } from "./orphan-audit";
import { uploadAssetAttachment } from "./service";
import { createS3AssetAttachmentStorage } from "./storage";
import type { AssetAttachmentStorage } from "./storage";
import { createS3AssetAttachmentStorageAuditAdapter } from "./storage-audit";
import type { AssetAttachmentStorageAuditObject } from "./storage-audit";
import type { AssetAttachmentRepository, AssetAttachmentRepositorySnapshot } from "./repository";

const integrationEnabled = process.env.ASSET_ATTACHMENT_OBJECT_STORAGE_INTEGRATION === "1";
const describeIntegration = integrationEnabled ? describe : describe.skip;
const contentType = "image/png";

describeIntegration("asset attachment S3-compatible object storage integration", () => {
  let context: IntegrationContext;

  beforeAll(() => {
    context = createIntegrationContext();
  });

  afterAll(async () => {
    if (!context) {
      return;
    }

    await cleanupRunPrefix(context);
  });

  it("uploads, verifies, and downloads bytes with real object storage commands", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const storage = createS3AssetAttachmentStorage({
      bucket: context.bucket,
      client: context.client,
      prefix: context.runPrefix
    });
    const key = storage.makeKey({ fileId: createFileId(), extension: ".png" });

    await runSanitized("asset_attachment_object_storage_put_failed", () => storage.put({ key, bytes, mime: contentType }));

    const head = await headExistingObject(context, key);
    const headChecksumSha256 = readCaseInsensitiveMetadata(head.Metadata, "checksum-sha256");
    const storageDownloaded = await runSanitized("asset_attachment_object_storage_get_failed", () => storage.get({ key }));
    const directDownloaded = await getObjectBytes(context, key);

    expect(head.ContentLength).toBe(bytes.byteLength);
    expect(headChecksumSha256).toBe(sha256Hex(bytes));
    expect(Buffer.from(storageDownloaded)).toEqual(Buffer.from(bytes));
    expect(Buffer.from(directDownloaded)).toEqual(Buffer.from(bytes));

    await runSanitized("asset_attachment_object_storage_delete_failed", () => storage.delete({ key }));
  });

  it("compensates with a real object delete when metadata persistence fails", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const storage = createS3AssetAttachmentStorage({
      bucket: context.bucket,
      client: context.client,
      prefix: context.runPrefix
    });
    const repository = createFailingMetadataRepository(createWorkspaceState());

    try {
      await uploadAssetAttachment(
        {
          assetLockRecordId: testRecord.id,
          attachmentType: "reference",
          fileName: "reference.png",
          fileBuffer: bytes,
          mime: contentType
        },
        { userId: "user-head-writer" },
        { repository, storage }
      );
      throw new Error("asset_attachment_object_storage_expected_metadata_failure");
    } catch (error) {
      if ((error as Error).message !== "asset_attachment_metadata_persist_failed_for_integration") {
        throw new Error("asset_attachment_object_storage_compensation_scenario_failed");
      }
    }

    const attemptedKey = repository.getAttemptedStorageKey();

    if (!attemptedKey) {
      throw new Error("asset_attachment_object_storage_compensation_key_missing");
    }

    await expectObjectMissing(context, attemptedKey);
  });

  it("lists the run prefix and audits referenced, orphan candidate, young, and unknown-age objects", async () => {
    const now = new Date();
    const storage = createS3AssetAttachmentStorage({
      bucket: context.bucket,
      client: context.client,
      prefix: context.runPrefix
    });
    const referencedKey = await putAuditObject(storage, new Uint8Array([10]));
    const orphanCandidateKey = await putAuditObject(storage, new Uint8Array([20, 21]));
    const youngKey = await putAuditObject(storage, new Uint8Array([30, 31, 32]));
    const unknownAgeKey = await putAuditObject(storage, new Uint8Array([40, 41, 42, 43]));
    const listedObjects = await listRunObjectsThroughAuditAdapter(context);

    assertListedObjectsStayUnderRunPrefix(listedObjects, context.runPrefix);

    const listedByKeyHash = new Map(listedObjects.map((object) => [hashAssetAttachmentAuditKey(object.key), object]));
    const report = await runAssetAttachmentOrphanAudit({
      adapter: {
        listObjects: () =>
          createAuditClassificationIterable({
            listedObjects,
            orphanCandidateKey,
            youngKey,
            unknownAgeKey,
            now
          })
      },
      gracePeriodMs: 24 * 60 * 60 * 1000,
      referencedRows: [referencedRow(referencedKey)],
      now
    });

    expect(listedByKeyHash.has(hashAssetAttachmentAuditKey(referencedKey))).toBe(true);
    expect(listedByKeyHash.has(hashAssetAttachmentAuditKey(orphanCandidateKey))).toBe(true);
    expect(listedByKeyHash.has(hashAssetAttachmentAuditKey(youngKey))).toBe(true);
    expect(listedByKeyHash.has(hashAssetAttachmentAuditKey(unknownAgeKey))).toBe(true);
    expect(report.counts).toMatchObject({
      providerObjectCount: listedObjects.length,
      referencedKeyCount: 1,
      referencedObjectCount: 1,
      unreferencedObjectCount: 3,
      orphanCandidateCount: 1,
      youngObjectCount: 1,
      unknownAgeObjectCount: 1
    });
    expect(report.reasonCounts).toEqual({
      orphan_candidate: 1,
      young: 1,
      unknown_age: 1
    });
    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyHash: hashAssetAttachmentAuditKey(orphanCandidateKey),
          reason: "orphan_candidate",
          sizeBytes: 2
        }),
        expect.objectContaining({
          keyHash: hashAssetAttachmentAuditKey(youngKey),
          reason: "young",
          sizeBytes: 3
        }),
        expect.objectContaining({
          keyHash: hashAssetAttachmentAuditKey(unknownAgeKey),
          reason: "unknown_age",
          sizeBytes: 4
        })
      ])
    );
    assertReportContainsNoRawStorageIdentifiers(report, context, [
      referencedKey,
      orphanCandidateKey,
      youngKey,
      unknownAgeKey
    ]);
  });
});

interface IntegrationContext {
  bucket: string;
  client: S3Client;
  runPrefix: string;
  sensitiveValues: string[];
}

const testRecord: AssetLockRecord = {
  id: "asset-lock-object-storage-integration",
  projectId: "project-jincheng",
  deliveryPackageId: "delivery-object-storage-integration",
  episodeNos: [1],
  assetName: "Object Storage Integration",
  assetType: "scene",
  changeType: "new",
  writerConfirmation: "pending",
  productionConfirmation: "pending",
  risk: "attention",
  status: "draft",
  createdByUserId: "user-head-writer",
  createdAt: "2026-05-31T00:00:00.000Z",
  updatedAt: "2026-05-31T00:00:00.000Z"
};

function createIntegrationContext(): IntegrationContext {
  const provider = requireEnv("ASSET_LOCK_ATTACHMENT_STORAGE_PROVIDER").trim().toLowerCase();

  if (provider !== "s3") {
    throw new Error("asset_attachment_object_storage_integration_provider_required");
  }

  const bucket = requireEnv("ASSET_LOCK_ATTACHMENT_S3_BUCKET");
  const basePrefix = normalizeConfiguredBasePrefix(requireEnv("ASSET_LOCK_ATTACHMENT_S3_PREFIX"));
  const region = requireEnv("ASSET_LOCK_ATTACHMENT_S3_REGION");
  const endpoint = requireEnv("ASSET_LOCK_ATTACHMENT_S3_ENDPOINT");
  const forcePathStyle = requireEnv("ASSET_LOCK_ATTACHMENT_S3_FORCE_PATH_STYLE");
  requireEnv("AWS_ACCESS_KEY_ID");
  requireEnv("AWS_SECRET_ACCESS_KEY");

  const runPrefix = `${basePrefix}/integration/${yyyyMMdd(new Date())}/${randomUUID()}`;
  const config: S3ClientConfig = {
    endpoint,
    forcePathStyle: isTruthy(forcePathStyle),
    region
  };

  return {
    bucket,
    client: new S3Client(config),
    runPrefix,
    sensitiveValues: [bucket, endpoint, basePrefix, runPrefix].filter(Boolean)
  };
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`asset_attachment_object_storage_integration_env_required:${name}`);
  }

  return value;
}

function normalizeConfiguredBasePrefix(prefix: string) {
  const normalized = prefix.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("asset_attachment_object_storage_integration_prefix_invalid");
  }

  return normalized;
}

function createWorkspaceState(): WorkspaceState {
  return {
    ...seedWorkspace,
    assetLockRecords: [testRecord],
    assetAttachments: []
  };
}

function createFailingMetadataRepository(initialState: WorkspaceState) {
  const snapshot: AssetAttachmentRepositorySnapshot = {
    state: initialState,
    assetAttachments: initialState.assetAttachments ?? []
  };
  let attemptedStorageKey = "";

  const repository: AssetAttachmentRepository & { getAttemptedStorageKey(): string } = {
    mode: "db",
    async read() {
      return snapshot;
    },
    async createAssetAttachmentMetadata(command) {
      attemptedStorageKey = command.storage.storageKey;
      throw new Error("asset_attachment_metadata_persist_failed_for_integration");
    },
    async softDeleteAssetAttachmentMetadata() {
      throw new Error("asset_attachment_object_storage_unexpected_soft_delete");
    },
    getAttemptedStorageKey() {
      return attemptedStorageKey;
    }
  };

  return repository;
}

async function putAuditObject(storage: AssetAttachmentStorage, bytes: Uint8Array) {
  const key = storage.makeKey({ fileId: createFileId(), extension: ".png" });

  await runSanitized("asset_attachment_object_storage_audit_put_failed", () => storage.put({ key, bytes, mime: contentType }));

  return key;
}

async function listRunObjectsThroughAuditAdapter(context: IntegrationContext) {
  const adapter = createS3AssetAttachmentStorageAuditAdapter({
    bucket: context.bucket,
    client: context.client,
    prefix: context.runPrefix
  });
  const objects: AssetAttachmentStorageAuditObject[] = [];

  await runSanitized("asset_attachment_object_storage_audit_list_failed", async () => {
    for await (const object of adapter.listObjects()) {
      objects.push(object);
    }
  });

  return objects;
}

async function cleanupRunPrefix(context: IntegrationContext) {
  const keys = await listKeys(context);

  for (const key of keys) {
    await runSanitized("asset_attachment_object_storage_cleanup_delete_failed", () =>
      context.client.send(new DeleteObjectCommand({ Bucket: context.bucket, Key: key }))
    );
  }

  const remainingCount = (await listKeys(context)).length;

  if (remainingCount > 0) {
    throw new Error(`asset_attachment_object_storage_cleanup_remaining_count:${remainingCount}`);
  }
}

async function listKeys(context: IntegrationContext) {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const output = await runSanitized("asset_attachment_object_storage_cleanup_list_failed", () =>
      context.client.send(
        new ListObjectsV2Command({
          Bucket: context.bucket,
          Prefix: `${context.runPrefix}/`,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {})
        })
      )
    ) as ListObjectsV2CommandOutput;

    for (const object of output.Contents ?? []) {
      if (object.Key) {
        keys.push(object.Key);
      }
    }

    continuationToken = output.IsTruncated ? output.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function headExistingObject(context: IntegrationContext, key: string) {
  return runSanitized("asset_attachment_object_storage_head_failed", () =>
    context.client.send(new HeadObjectCommand({ Bucket: context.bucket, Key: key }))
  ) as Promise<HeadObjectCommandOutput>;
}

async function getObjectBytes(context: IntegrationContext, key: string) {
  const output = await runSanitized("asset_attachment_object_storage_direct_get_failed", () =>
    context.client.send(new GetObjectCommand({ Bucket: context.bucket, Key: key }))
  ) as GetObjectCommandOutput;

  return toUint8Array(output.Body);
}

async function expectObjectMissing(context: IntegrationContext, key: string) {
  try {
    await context.client.send(new HeadObjectCommand({ Bucket: context.bucket, Key: key }));
  } catch (error) {
    if (isS3ObjectMissing(error)) {
      return;
    }

    throw new Error("asset_attachment_object_storage_missing_check_failed");
  }

  throw new Error("asset_attachment_object_storage_compensation_object_still_exists");
}

async function runSanitized<T>(message: string, action: () => Promise<T>) {
  try {
    return await action();
  } catch {
    throw new Error(message);
  }
}

function assertListedObjectsStayUnderRunPrefix(objects: AssetAttachmentStorageAuditObject[], runPrefix: string) {
  if (objects.some((object) => !object.key.startsWith(`${runPrefix}/`))) {
    throw new Error("asset_attachment_object_storage_audit_list_outside_run_prefix");
  }
}

async function* createAuditClassificationIterable(input: {
  listedObjects: AssetAttachmentStorageAuditObject[];
  orphanCandidateKey: string;
  youngKey: string;
  unknownAgeKey: string;
  now: Date;
}) {
  for (const object of input.listedObjects) {
    if (object.key === input.orphanCandidateKey) {
      yield {
        ...object,
        lastModified: new Date(input.now.getTime() - 48 * 60 * 60 * 1000)
      };
      continue;
    }

    if (object.key === input.youngKey) {
      yield {
        ...object,
        lastModified: new Date(input.now.getTime() - 60 * 60 * 1000)
      };
      continue;
    }

    if (object.key === input.unknownAgeKey) {
      const { lastModified: _lastModified, ...unknownAgeObject } = object;

      yield unknownAgeObject;
      continue;
    }

    yield object;
  }
}

function referencedRow(storageKey: string): AssetAttachmentReferencedRow {
  return {
    fileId: "asset-att-00000000-0000-4000-8000-000000000000",
    fileName: "reference.png",
    status: "active",
    storageKey
  };
}

function assertReportContainsNoRawStorageIdentifiers(
  report: unknown,
  context: IntegrationContext,
  rawObjectKeys: string[]
) {
  const serialized = JSON.stringify(report);
  const sensitiveValues = [...context.sensitiveValues, ...rawObjectKeys];

  for (const value of sensitiveValues) {
    if (value && serialized.includes(value)) {
      throw new Error("asset_attachment_object_storage_audit_report_leaked_sensitive_value");
    }
  }

  assertAuditReportItemsContainOnlySafeFields(report);
}

function assertAuditReportItemsContainOnlySafeFields(report: unknown) {
  if (!report || typeof report !== "object" || !("items" in report) || !Array.isArray(report.items)) {
    throw new Error("asset_attachment_object_storage_audit_report_shape_invalid");
  }

  const allowedItemFields = new Set(["keyHash", "sizeBytes", "reason", "ageMs", "ageBucket"]);

  for (const item of report.items) {
    if (!item || typeof item !== "object") {
      throw new Error("asset_attachment_object_storage_audit_report_item_invalid");
    }

    if (Object.keys(item).some((key) => !allowedItemFields.has(key))) {
      throw new Error("asset_attachment_object_storage_audit_report_item_unsafe_field");
    }
  }
}

async function toUint8Array(body: GetObjectCommandOutput["Body"]) {
  if (!body) {
    return new Uint8Array();
  }

  if (body instanceof Uint8Array) {
    return body;
  }

  const transformableBody = body as { transformToByteArray?: () => Promise<Uint8Array> };

  if (transformableBody.transformToByteArray) {
    return transformableBody.transformToByteArray();
  }

  if (Symbol.asyncIterator in Object(body)) {
    const chunks: Uint8Array[] = [];

    for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
      chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
    }

    return concatChunks(chunks);
  }

  throw new Error("asset_attachment_object_storage_body_invalid");
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

function createFileId() {
  return `asset-att-${randomUUID()}`;
}

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readCaseInsensitiveMetadata(metadata: Record<string, string> | undefined, key: string) {
  if (!metadata) {
    return undefined;
  }

  const normalizedKey = key.toLowerCase();
  const entry = Object.entries(metadata).find(([name]) => name.toLowerCase() === normalizedKey);

  return entry?.[1];
}

function isS3ObjectMissing(error: unknown) {
  const metadata = getErrorProperty(error, "$metadata");

  return (
    error instanceof NoSuchKey ||
    error instanceof NotFound ||
    getErrorProperty(error, "name") === "NoSuchKey" ||
    getErrorProperty(error, "name") === "NotFound" ||
    (metadata !== null && typeof metadata === "object" && "statusCode" in metadata && metadata.statusCode === 404)
  );
}

function getErrorProperty(error: unknown, key: string) {
  if (!error || typeof error !== "object" || !(key in error)) {
    return undefined;
  }

  return (error as Record<string, unknown>)[key];
}

function yyyyMMdd(date: Date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function isTruthy(value: string) {
  return value.trim().toLowerCase() === "true" || value.trim() === "1";
}
