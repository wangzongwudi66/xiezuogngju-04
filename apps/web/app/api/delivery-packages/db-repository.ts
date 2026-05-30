import type { DeliveryPackage, DeliveryPackageEpisode } from "@aigc/domain";
import { asc, eq } from "drizzle-orm";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { deliveryPackageEpisodes, deliveryPackages } from "../../../db/schema";

export type DeliveryPackageDbRow = typeof deliveryPackages.$inferSelect;
export type DeliveryPackageEpisodeDbRow = typeof deliveryPackageEpisodes.$inferSelect;
type DeliveryPackageDbInsert = typeof deliveryPackages.$inferInsert;
type DeliveryPackageEpisodeDbInsert = typeof deliveryPackageEpisodes.$inferInsert;
type DeliveryPackageDbUpdate = Omit<DeliveryPackageDbInsert, "id">;

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

export async function createDbDeliveryPackageWithEpisodes(
  deliveryPackage: DeliveryPackage,
  episodes: DeliveryPackageEpisode[]
): Promise<DeliveryPackageDbSnapshot> {
  const { db } = getAssetLockDbRuntime();

  await db.transaction(async (tx) => {
    await tx.insert(deliveryPackages).values(mapDeliveryPackageToDbInsertRow(deliveryPackage));

    if (episodes.length > 0) {
      await tx.insert(deliveryPackageEpisodes).values(episodes.map(mapDeliveryPackageEpisodeToDbInsertRow));
    }
  });

  return readDbDeliveryPackageSnapshot();
}

export async function updateDbDeliveryPackage(deliveryPackage: DeliveryPackage): Promise<DeliveryPackage> {
  const { db } = getAssetLockDbRuntime();
  const updatedRows = await db
    .update(deliveryPackages)
    .set(mapDeliveryPackageToDbUpdateRow(deliveryPackage))
    .where(eq(deliveryPackages.id, deliveryPackage.id))
    .returning();

  const updatedPackage = mapDeliveryPackageRows(updatedRows, []).deliveryPackages[0];

  if (!updatedPackage) {
    throw new Error("delivery_package_not_found");
  }

  return updatedPackage;
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

export function mapDeliveryPackageToDbInsertRow(deliveryPackage: DeliveryPackage): DeliveryPackageDbInsert {
  return {
    id: deliveryPackage.id,
    ...mapDeliveryPackageToDbUpdateRow(deliveryPackage)
  };
}

export function mapDeliveryPackageEpisodeToDbInsertRow(
  episode: DeliveryPackageEpisode
): DeliveryPackageEpisodeDbInsert {
  return {
    id: episode.id,
    deliveryPackageId: episode.deliveryPackageId,
    episodeNo: episode.episodeNo,
    title: episode.title,
    content: episode.content,
    isConfirmedChange: episode.isConfirmedChange
  };
}

function mapDeliveryPackageToDbUpdateRow(deliveryPackage: DeliveryPackage): DeliveryPackageDbUpdate {
  return {
    projectId: deliveryPackage.projectId,
    type: deliveryPackage.type,
    title: deliveryPackage.title,
    sourceFileName: deliveryPackage.sourceFileName ?? null,
    declaredEpisodeFrom: deliveryPackage.declaredEpisodeFrom,
    declaredEpisodeTo: deliveryPackage.declaredEpisodeTo,
    status: deliveryPackage.status,
    uploadedByUserId: deliveryPackage.uploadedByUserId,
    submittedByUserId: deliveryPackage.submittedByUserId ?? null,
    reviewedByUserId: deliveryPackage.reviewedByUserId ?? null,
    rejectionReason: deliveryPackage.rejectionReason ?? null,
    createdAt: deliveryPackage.createdAt,
    submittedAt: deliveryPackage.submittedAt ?? null,
    publishedAt: deliveryPackage.publishedAt ?? null,
    rejectedAt: deliveryPackage.rejectedAt ?? null
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
