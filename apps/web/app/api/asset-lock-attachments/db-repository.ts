import type { AssetAttachment, WorkspaceState } from "@aigc/domain";
import { asc } from "drizzle-orm";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { assetAttachments } from "../../../db/schema";
import { readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import type { DbAssetAttachmentRepository } from "./repository";

export type AssetAttachmentDbRow = typeof assetAttachments.$inferSelect;

export function createDbAssetAttachmentRepository(): DbAssetAttachmentRepository {
  async function read() {
    const workspace = await readDeliveryImportWorkspace();
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

    return toDbRepositorySnapshot(workspace.state, mapAssetAttachmentRows(rows));
  }

  return {
    mode: "db",
    read
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
