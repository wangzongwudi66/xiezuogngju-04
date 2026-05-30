import type { DeliveryPackage, DeliveryPackageEpisode } from "@aigc/domain";
import { asc } from "drizzle-orm";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { deliveryPackageEpisodes, deliveryPackages } from "../../../db/schema";

export type DeliveryPackageDbRow = typeof deliveryPackages.$inferSelect;
export type DeliveryPackageEpisodeDbRow = typeof deliveryPackageEpisodes.$inferSelect;

export interface DeliveryPackageDbSnapshot {
  deliveryPackages: DeliveryPackage[];
  deliveryPackageEpisodes: DeliveryPackageEpisode[];
}

export async function readDbDeliveryPackageSnapshot(): Promise<DeliveryPackageDbSnapshot> {
  const { db } = getAssetLockDbRuntime();
  const [packageRows, episodeRows] = await Promise.all([
    db
      .select()
      .from(deliveryPackages)
      .orderBy(
        asc(deliveryPackages.projectId),
        asc(deliveryPackages.createdAt),
        asc(deliveryPackages.id)
      ),
    db
      .select()
      .from(deliveryPackageEpisodes)
      .orderBy(
        asc(deliveryPackageEpisodes.deliveryPackageId),
        asc(deliveryPackageEpisodes.episodeNo),
        asc(deliveryPackageEpisodes.id)
      )
  ]);

  return mapDeliveryPackageRows(packageRows, episodeRows);
}

export function mapDeliveryPackageRows(
  packageRows: DeliveryPackageDbRow[],
  episodeRows: DeliveryPackageEpisodeDbRow[]
): DeliveryPackageDbSnapshot {
  return {
    deliveryPackages: packageRows.map(mapDeliveryPackageRow),
    deliveryPackageEpisodes: episodeRows.map(mapDeliveryPackageEpisodeRow)
  };
}

function mapDeliveryPackageRow(row: DeliveryPackageDbRow): DeliveryPackage {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    title: row.title,
    sourceFileName: optional(row.sourceFileName),
    declaredEpisodeFrom: row.declaredEpisodeFrom,
    declaredEpisodeTo: row.declaredEpisodeTo,
    status: row.status,
    uploadedByUserId: row.uploadedByUserId,
    submittedByUserId: optional(row.submittedByUserId),
    reviewedByUserId: optional(row.reviewedByUserId),
    rejectionReason: optional(row.rejectionReason),
    createdAt: row.createdAt,
    submittedAt: optional(row.submittedAt),
    publishedAt: optional(row.publishedAt),
    rejectedAt: optional(row.rejectedAt)
  };
}

function mapDeliveryPackageEpisodeRow(row: DeliveryPackageEpisodeDbRow): DeliveryPackageEpisode {
  return {
    id: row.id,
    deliveryPackageId: row.deliveryPackageId,
    episodeNo: row.episodeNo,
    title: row.title,
    content: row.content,
    isConfirmedChange: row.isConfirmedChange
  };
}

function optional<T>(value: T | null | undefined) {
  return value ?? undefined;
}
