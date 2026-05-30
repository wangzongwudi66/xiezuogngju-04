import type { AssetAttachment, WorkspaceState } from "@aigc/domain";
import { and, asc, desc, eq } from "drizzle-orm";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { assetAttachments } from "../../../db/schema";
import { readDbAssetLockRecordRepositorySnapshot } from "../asset-lock-records/db-repository";
import type { AssetAttachmentStorageMetadata, DbAssetAttachmentRepository } from "./repository";

export type AssetAttachmentDbRow = typeof assetAttachments.$inferSelect;
type AssetAttachmentDbInsert = typeof assetAttachments.$inferInsert;
type AssetAttachmentStorageMetadataLegacyKeyInput = Pick<AssetAttachmentDbRow, "fileId" | "fileName">;
export interface PersistedAssetAttachmentStorageMetadata {
  assetAttachmentId: string;
  checksumSha256?: string;
  sizeBytes: number;
  storageKey: string;
}
const createMetadataMaxAttempts = 3;

export function createDbAssetAttachmentRepository(): DbAssetAttachmentRepository {
  async function read() {
    const recordSnapshot = await readDbAssetLockRecordRepositorySnapshot();
    const { db } = getAssetLockDbRuntime();
    const rows = await db
      .select()
      .from(assetAttachments)
      .orderBy(
        asc(assetAttachments.assetLockRecordId),
        asc(assetAttachments.status),
        asc(assetAttachments.version),
        asc(assetAttachments.uploadedAt),
        asc(assetAttachments.id)
      );

    return toDbRepositorySnapshot(recordSnapshot.state, mapAssetAttachmentRows(rows));
  }

  return {
    mode: "db",
    read,
    async createAssetAttachmentMetadata(command) {
      const { db } = getAssetLockDbRuntime();

      for (let attempt = 1; attempt <= createMetadataMaxAttempts; attempt += 1) {
        try {
          const inserted = await db.transaction(async (tx) => {
            const nextVersion = await readNextAssetAttachmentVersion(tx, command.attachment.assetLockRecordId);
            const insertedRows = await tx
              .insert(assetAttachments)
              .values(mapAssetAttachmentToDbRow({ ...command.attachment, version: nextVersion }, command.storage))
              .returning();
            return mapAssetAttachmentRows(insertedRows)[0];
          });

          if (!inserted) {
            throw new Error("asset_attachment_metadata_not_created");
          }

          return inserted;
        } catch (error) {
          if (isRecordVersionUniqueViolation(error)) {
            if (attempt < createMetadataMaxAttempts) {
              continue;
            }

            throw new Error("asset_attachment_version_conflict");
          }

          if (isUniqueViolation(error)) {
            throw new Error("asset_attachment_metadata_conflict");
          }

          throw error;
        }
      }

      throw new Error("asset_attachment_version_conflict");
    },
    async softDeleteAssetAttachmentMetadata(input) {
      const { db } = getAssetLockDbRuntime();
      const deletedRows = await db
        .update(assetAttachments)
        .set({
          status: "deleted",
          deletedByUserId: input.deletedByUserId,
          deletedAt: new Date().toISOString()
        })
        .where(and(eq(assetAttachments.id, input.assetAttachmentId), eq(assetAttachments.status, "active")))
        .returning();
      const deleted = mapAssetAttachmentRows(deletedRows)[0];

      if (!deleted) {
        throw new Error("asset_attachment_not_found");
      }

      return deleted;
    }
  };
}

async function readNextAssetAttachmentVersion(
  db: Pick<ReturnType<typeof getAssetLockDbRuntime>["db"], "select">,
  assetLockRecordId: string
) {
  const rows = await db
    .select({ version: assetAttachments.version })
    .from(assetAttachments)
    .where(eq(assetAttachments.assetLockRecordId, assetLockRecordId))
    .orderBy(desc(assetAttachments.version))
    .limit(1);

  return (rows[0]?.version ?? 0) + 1;
}

export function mapAssetAttachmentRows(rows: AssetAttachmentDbRow[]): AssetAttachment[] {
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    assetLockRecordId: row.assetLockRecordId,
    deliveryPackageId: row.deliveryPackageId,
    fileId: row.fileId,
    fileName: row.fileName,
    mime: row.mime,
    size: row.sizeBytes,
    version: row.version,
    attachmentType: row.attachmentType,
    uploadedByUserId: row.uploadedByUserId,
    uploadedAt: row.uploadedAt,
    note: optional(row.note),
    status: row.status,
    deletedByUserId: optional(row.deletedByUserId),
    deletedAt: optional(row.deletedAt)
  }));
}

export function mapAssetAttachmentStorageMetadataRows(
  rows: AssetAttachmentDbRow[],
  legacyStorageKey: (row: AssetAttachmentStorageMetadataLegacyKeyInput) => string
): PersistedAssetAttachmentStorageMetadata[] {
  return rows.map((row) => ({
    assetAttachmentId: row.id,
    checksumSha256: optional(row.checksumSha256),
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey ?? legacyStorageKey(row)
  }));
}

export function mapAssetAttachmentToDbRow(
  attachment: AssetAttachment,
  storage?: AssetAttachmentStorageMetadata
): AssetAttachmentDbInsert {
  return {
    id: attachment.id,
    projectId: attachment.projectId,
    assetLockRecordId: attachment.assetLockRecordId,
    deliveryPackageId: attachment.deliveryPackageId,
    fileId: attachment.fileId,
    fileName: attachment.fileName,
    mime: toAssetAttachmentDbMime(attachment.mime),
    sizeBytes: attachment.size,
    storageKey: storage?.storageKey ?? null,
    checksumSha256: storage?.checksumSha256 ?? null,
    version: attachment.version,
    attachmentType: attachment.attachmentType,
    uploadedByUserId: attachment.uploadedByUserId,
    uploadedAt: attachment.uploadedAt,
    note: attachment.note ?? null,
    status: attachment.status,
    deletedByUserId: attachment.deletedByUserId ?? null,
    deletedAt: attachment.deletedAt ?? null
  };
}

function toDbRepositorySnapshot(state: WorkspaceState, attachments: AssetAttachment[]) {
  const nextState: WorkspaceState = {
    ...state,
    assetAttachments: attachments
  };

  return {
    state: nextState,
    assetAttachments: attachments
  };
}

function optional<T>(value: T | null | undefined) {
  return value ?? undefined;
}

function toAssetAttachmentDbMime(mime: string): AssetAttachmentDbInsert["mime"] {
  switch (mime) {
    case "image/jpeg":
    case "image/png":
    case "image/webp":
    case "application/pdf":
      return mime;
    default:
      throw new Error("asset_attachment_file_type_invalid");
  }
}

function isRecordVersionUniqueViolation(error: unknown) {
  return findErrorCause(error, (candidate) => {
    const code = getErrorProperty(candidate, "code");
    const constraint = getErrorProperty(candidate, "constraint");

    return code === "23505" && constraint === "asset_attachments_record_version_unique";
  });
}

function isUniqueViolation(error: unknown) {
  return findErrorCause(error, (candidate) => getErrorProperty(candidate, "code") === "23505");
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
