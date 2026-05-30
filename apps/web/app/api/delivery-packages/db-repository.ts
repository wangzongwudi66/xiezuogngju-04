import type {
  DeliveryPackage,
  DeliveryPackageEpisode,
  Episode,
  EpisodeCurrent,
  EpisodeRevision,
  Notification
} from "@aigc/domain";
import { and, asc, eq, sql } from "drizzle-orm";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import {
  deliveryPackageEpisodes,
  deliveryPackages,
  episodeCurrents,
  episodeRevisions,
  episodes as episodeRows,
  notifications
} from "../../../db/schema";
import {
  mapEpisodeCurrentToDbInsertRow,
  mapEpisodeRevisionToDbInsertRow,
  mapNotificationToDbInsertRow
} from "../publish-read-model/db-repository";

export type DeliveryPackageDbRow = typeof deliveryPackages.$inferSelect;
export type DeliveryPackageEpisodeDbRow = typeof deliveryPackageEpisodes.$inferSelect;
type DeliveryPackageDbInsert = typeof deliveryPackages.$inferInsert;
type DeliveryPackageEpisodeDbInsert = typeof deliveryPackageEpisodes.$inferInsert;
type DeliveryPackageDbUpdate = Omit<DeliveryPackageDbInsert, "id">;

export interface DeliveryPackageDbSnapshot {
  deliveryPackages: DeliveryPackage[];
  deliveryPackageEpisodes: DeliveryPackageEpisode[];
}

export interface PublishDbDeliveryPackageDelta {
  deliveryPackage: DeliveryPackage;
  episodeRevisions: EpisodeRevision[];
  episodeCurrents: EpisodeCurrent[];
  notifications: Notification[];
  episodes: Pick<Episode, "id" | "productionStatus" | "hasUnreadKeyChange">[];
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

export async function updateDbDeliveryPackageEpisodeConfirmations(
  deliveryPackageId: string,
  episodes: Pick<DeliveryPackageEpisode, "id" | "isConfirmedChange">[]
): Promise<DeliveryPackageDbSnapshot> {
  const { db } = getAssetLockDbRuntime();

  await db.transaction(async (tx) => {
    for (const episode of episodes) {
      const updatedRows = await tx
        .update(deliveryPackageEpisodes)
        .set({ isConfirmedChange: episode.isConfirmedChange })
        .where(
          and(
            eq(deliveryPackageEpisodes.id, episode.id),
            eq(deliveryPackageEpisodes.deliveryPackageId, deliveryPackageId)
          )
        )
        .returning({ id: deliveryPackageEpisodes.id });

      if (updatedRows.length === 0) {
        throw new Error("delivery_package_episode_not_found");
      }
    }
  });

  return readDbDeliveryPackageSnapshot();
}

export async function publishDbDeliveryPackage(delta: PublishDbDeliveryPackageDelta): Promise<void> {
  const { db } = getAssetLockDbRuntime();

  await db.transaction(async (tx) => {
    const updatedPackageRows = await tx
      .update(deliveryPackages)
      .set(mapDeliveryPackageToDbUpdateRow(delta.deliveryPackage))
      .where(and(eq(deliveryPackages.id, delta.deliveryPackage.id), eq(deliveryPackages.status, "pending_review")))
      .returning({ id: deliveryPackages.id });

    if (updatedPackageRows.length === 0) {
      throw new Error("delivery_package_publish_conflict");
    }

    if (delta.episodeRevisions.length === 0) {
      throw new Error("delivery_package_publish_delta_empty");
    }

    await tx.insert(episodeRevisions).values(delta.episodeRevisions.map(mapEpisodeRevisionToDbInsertRow));

    if (delta.episodeCurrents.length > 0) {
      await tx
        .insert(episodeCurrents)
        .values(delta.episodeCurrents.map(mapEpisodeCurrentToDbInsertRow))
        .onConflictDoUpdate({
          target: episodeCurrents.episodeId,
          set: {
            id: sql`excluded.id`,
            projectId: sql`excluded.project_id`,
            currentRevisionId: sql`excluded.current_revision_id`,
            updatedAt: sql`excluded.updated_at`
          }
        });
    }

    for (const episode of delta.episodes) {
      const updatedEpisodeRows = await tx
        .update(episodeRows)
        .set({
          productionStatus: episode.productionStatus,
          hasUnreadKeyChange: episode.hasUnreadKeyChange
        })
        .where(eq(episodeRows.id, episode.id))
        .returning({ id: episodeRows.id });

      if (updatedEpisodeRows.length === 0) {
        throw new Error("episode_not_found");
      }
    }

    if (delta.notifications.length > 0) {
      await tx.insert(notifications).values(delta.notifications.map(mapNotificationToDbInsertRow));
    }
  });
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
