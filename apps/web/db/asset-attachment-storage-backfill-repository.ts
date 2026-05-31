import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { assetAttachments } from "./schema/asset-lock-records";
import type { AssetLockDb } from "./runtime";
import type { AssetAttachmentStorageBackfillWrite } from "../app/api/asset-lock-attachments/storage-backfill";

const defaultMaxWriteAttempts = 3;
const advisoryLockKey = 514_240_881;
const transientDbErrorCodes = new Set(["40001", "40P01", "53300", "08000", "08001", "08006", "57P01"]);

export interface AssetAttachmentStorageBackfillBatchWriteResult {
  attemptedRowCount: number;
  updatedRowCount: number;
}

type AssetAttachmentStorageBackfillTx = Pick<AssetLockDb, "update" | "select">;

export async function writeAssetAttachmentStorageBackfillBatch(
  db: AssetLockDb,
  writes: AssetAttachmentStorageBackfillWrite[],
  options: { maxAttempts?: number } = {}
): Promise<AssetAttachmentStorageBackfillBatchWriteResult> {
  if (writes.length === 0) {
    return {
      attemptedRowCount: 0,
      updatedRowCount: 0
    };
  }

  const maxAttempts = options.maxAttempts ?? defaultMaxWriteAttempts;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.transaction(async (tx) => writeBatchInTransaction(tx, writes));
    } catch (error) {
      if (attempt < maxAttempts && isTransientDbError(error)) {
        continue;
      }

      if (isTransientDbError(error)) {
        throw new Error("asset_attachment_storage_backfill_retry_exhausted");
      }

      throw error;
    }
  }

  throw new Error("asset_attachment_storage_backfill_retry_exhausted");
}

export async function acquireAssetAttachmentStorageBackfillAdvisoryLock(db: Pick<AssetLockDb, "execute">) {
  const result = await db.execute(sql`select pg_try_advisory_lock(${advisoryLockKey}) as locked`);
  const [row] = readRows(result);

  if (row?.locked !== true) {
    throw new Error("asset_attachment_storage_backfill_concurrent_runner");
  }
}

export async function releaseAssetAttachmentStorageBackfillAdvisoryLock(db: Pick<AssetLockDb, "execute">) {
  await db.execute(sql`select pg_advisory_unlock(${advisoryLockKey})`);
}

async function writeBatchInTransaction(
  tx: AssetAttachmentStorageBackfillTx,
  writes: AssetAttachmentStorageBackfillWrite[]
): Promise<AssetAttachmentStorageBackfillBatchWriteResult> {
  for (const write of writes) {
    const updatedRows = await tx
      .update(assetAttachments)
      .set(createBackfillSetValues(write))
      .where(and(...createBackfillWhereConditions(write)))
      .returning({ id: assetAttachments.id });

    if (updatedRows.length !== 1) {
      throw new Error("asset_attachment_storage_backfill_no_rows_updated");
    }
  }

  await verifyBackfillBatch(tx, writes);

  return {
    attemptedRowCount: writes.length,
    updatedRowCount: writes.length
  };
}

function createBackfillSetValues(write: AssetAttachmentStorageBackfillWrite) {
  const values: {
    storageKey?: string;
    checksumSha256?: string;
  } = {};

  if (write.row.storageKey == null) {
    values.storageKey = write.targetStorageKey;
  }

  if (write.row.checksumSha256 == null) {
    values.checksumSha256 = write.targetChecksumSha256;
  }

  return values;
}

function createBackfillWhereConditions(write: AssetAttachmentStorageBackfillWrite): SQL[] {
  const conditions: SQL[] = [
    eq(assetAttachments.id, write.row.id),
    eq(assetAttachments.status, toReferencedStatus(write.row.status)),
    eq(assetAttachments.sizeBytes, write.row.sizeBytes),
    eq(assetAttachments.fileId, write.row.fileId),
    eq(assetAttachments.fileName, write.row.fileName)
  ];

  if (write.row.storageKey == null) {
    conditions.push(isNull(assetAttachments.storageKey));
  } else {
    conditions.push(eq(assetAttachments.storageKey, write.row.storageKey));
  }

  if (write.row.checksumSha256 == null) {
    conditions.push(isNull(assetAttachments.checksumSha256));
  } else {
    conditions.push(eq(assetAttachments.checksumSha256, write.row.checksumSha256));
  }

  return conditions;
}

async function verifyBackfillBatch(tx: AssetAttachmentStorageBackfillTx, writes: AssetAttachmentStorageBackfillWrite[]) {
  const rows = await tx
    .select({
      id: assetAttachments.id,
      storageKey: assetAttachments.storageKey,
      checksumSha256: assetAttachments.checksumSha256
    })
    .from(assetAttachments)
    .where(inArray(assetAttachments.id, writes.map((write) => write.row.id)));
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  for (const write of writes) {
    const row = rowsById.get(write.row.id);

    if (
      !row ||
      row.storageKey !== (write.row.storageKey ?? write.targetStorageKey) ||
      row.checksumSha256 !== (write.row.checksumSha256 ?? write.targetChecksumSha256)
    ) {
      throw new Error("asset_attachment_storage_backfill_verification_failed");
    }
  }

  const targetStorageKeys = writes.map((write) => write.targetStorageKey);
  const rowsWithTargetKeys = await tx
    .select({
      id: assetAttachments.id,
      storageKey: assetAttachments.storageKey
    })
    .from(assetAttachments)
    .where(inArray(assetAttachments.storageKey, targetStorageKeys));
  const keyCounts = new Map<string, number>();

  for (const row of rowsWithTargetKeys) {
    if (!row.storageKey) {
      continue;
    }

    const normalizedKey = normalizeStorageKey(row.storageKey);
    keyCounts.set(normalizedKey, (keyCounts.get(normalizedKey) ?? 0) + 1);
  }

  if (targetStorageKeys.some((storageKey) => (keyCounts.get(normalizeStorageKey(storageKey)) ?? 0) > 1)) {
    throw new Error("asset_attachment_storage_backfill_duplicate_storage_key");
  }
}

function toReferencedStatus(status: string) {
  if (status === "active" || status === "deleted") {
    return status;
  }

  throw new Error("asset_attachment_storage_backfill_status_invalid");
}

function normalizeStorageKey(storageKey: string) {
  return storageKey.trim().replace(/\\/g, "/");
}

function isTransientDbError(error: unknown): boolean {
  return findErrorCause(error, (candidate) => {
    const code = getErrorProperty(candidate, "code");

    return typeof code === "string" && transientDbErrorCodes.has(code);
  });
}

function findErrorCause(error: unknown, predicate: (candidate: unknown) => boolean): boolean {
  let candidate = error;

  while (candidate) {
    if (predicate(candidate)) {
      return true;
    }

    candidate = getErrorProperty(candidate, "cause");
  }

  return false;
}

function getErrorProperty(error: unknown, key: string) {
  if (!error || typeof error !== "object" || !(key in error)) {
    return undefined;
  }

  return (error as Record<string, unknown>)[key];
}

function readRows(result: unknown): Array<{ locked?: boolean }> {
  if (Array.isArray(result)) {
    return result as Array<{ locked?: boolean }>;
  }

  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;

    if (Array.isArray(rows)) {
      return rows as Array<{ locked?: boolean }>;
    }
  }

  return [];
}
