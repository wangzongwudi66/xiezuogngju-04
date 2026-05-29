import type { AssetAttachment, WorkspaceState } from "@aigc/domain";
import { and, asc, eq } from "drizzle-orm";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { assetAttachments } from "../../../db/schema";
import { readDbAssetLockRecordRepositorySnapshot } from "../asset-lock-records/db-repository";
import type { DbAssetAttachmentRepository } from "./repository";

export type AssetAttachmentDbRow = typeof assetAttachments.$inferSelect;
type AssetAttachmentDbInsert = typeof assetAttachments.$inferInsert;

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
      const insertedRows = await db.insert(assetAttachments).values(mapAssetAttachmentToDbRow(command.attachment)).returning();
      const inserted = mapAssetAttachmentRows(insertedRows)[0];

      if (!inserted) {
        throw new Error("asset_attachment_metadata_not_created");
      }

      return inserted;
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

export function mapAssetAttachmentToDbRow(attachment: AssetAttachment): AssetAttachmentDbInsert {
  return {
    id: attachment.id,
    projectId: attachment.projectId,
    assetLockRecordId: attachment.assetLockRecordId,
    deliveryPackageId: attachment.deliveryPackageId,
    fileId: attachment.fileId,
    fileName: attachment.fileName,
    mime: toAssetAttachmentDbMime(attachment.mime),
    sizeBytes: attachment.size,
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
