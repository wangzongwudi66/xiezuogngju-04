import type { EpisodeCurrent, EpisodeRevision, Notification, WorkspaceState } from "@aigc/domain";
import { asc } from "drizzle-orm";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { episodeCurrents, episodeRevisions, notifications } from "../../../db/schema";

export type EpisodeRevisionDbRow = typeof episodeRevisions.$inferSelect;
export type EpisodeCurrentDbRow = typeof episodeCurrents.$inferSelect;
export type NotificationDbRow = typeof notifications.$inferSelect;
export type EpisodeRevisionDbInsertRow = typeof episodeRevisions.$inferInsert;
export type EpisodeCurrentDbInsertRow = typeof episodeCurrents.$inferInsert;
export type NotificationDbInsertRow = typeof notifications.$inferInsert;

export interface PublishReadModelDbRows {
  episodeRevisionRows: EpisodeRevisionDbRow[];
  episodeCurrentRows: EpisodeCurrentDbRow[];
  notificationRows: NotificationDbRow[];
}

export type PublishReadModelDbSnapshot = Pick<
  WorkspaceState,
  "episodeRevisions" | "episodeCurrents" | "notifications"
>;

export async function readDbPublishReadModelSnapshot(): Promise<PublishReadModelDbSnapshot> {
  const { db } = getAssetLockDbRuntime();
  const [episodeRevisionRows, episodeCurrentRows, notificationRows] = await Promise.all([
    db
      .select()
      .from(episodeRevisions)
      .orderBy(
        asc(episodeRevisions.projectId),
        asc(episodeRevisions.episodeNo),
        asc(episodeRevisions.revisionNo),
        asc(episodeRevisions.createdAt),
        asc(episodeRevisions.id)
      ),
    db
      .select()
      .from(episodeCurrents)
      .orderBy(asc(episodeCurrents.projectId), asc(episodeCurrents.episodeId), asc(episodeCurrents.id)),
    db
      .select()
      .from(notifications)
      .orderBy(asc(notifications.projectId), asc(notifications.recipientId), asc(notifications.createdAt), asc(notifications.id))
  ]);

  return mapPublishReadModelRows({
    episodeRevisionRows,
    episodeCurrentRows,
    notificationRows
  });
}

export function mapPublishReadModelRows(rows: PublishReadModelDbRows): PublishReadModelDbSnapshot {
  return {
    episodeRevisions: rows.episodeRevisionRows.map(mapEpisodeRevisionRow),
    episodeCurrents: rows.episodeCurrentRows.map(mapEpisodeCurrentRow),
    notifications: rows.notificationRows.map(mapNotificationRow)
  };
}

export function mapEpisodeRevisionToDbInsertRow(revision: EpisodeRevision): EpisodeRevisionDbInsertRow {
  return {
    id: revision.id,
    projectId: revision.projectId,
    episodeId: revision.episodeId,
    episodeNo: revision.episodeNo,
    deliveryPackageId: revision.deliveryPackageId,
    revisionNo: revision.revisionNo,
    title: revision.title,
    content: revision.content,
    previousRevisionId: revision.previousRevisionId ?? null,
    changeSummary: revision.changeSummary,
    createdAt: revision.createdAt
  };
}

export function mapEpisodeCurrentToDbInsertRow(current: EpisodeCurrent): EpisodeCurrentDbInsertRow {
  return {
    id: current.id,
    projectId: current.projectId,
    episodeId: current.episodeId,
    currentRevisionId: current.currentRevisionId,
    updatedAt: current.updatedAt
  };
}

export function mapNotificationToDbInsertRow(notification: Notification): NotificationDbInsertRow {
  return {
    id: notification.id,
    projectId: notification.projectId,
    episodeId: notification.episodeId ?? null,
    recipientId: notification.recipientId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    readAt: notification.readAt ?? null,
    createdAt: notification.createdAt
  };
}

function mapEpisodeRevisionRow(row: EpisodeRevisionDbRow): EpisodeRevision {
  return {
    id: row.id,
    projectId: row.projectId,
    episodeId: row.episodeId,
    episodeNo: row.episodeNo,
    deliveryPackageId: row.deliveryPackageId,
    revisionNo: row.revisionNo,
    title: row.title,
    content: row.content,
    previousRevisionId: optional(row.previousRevisionId),
    changeSummary: row.changeSummary,
    createdAt: row.createdAt
  };
}

function mapEpisodeCurrentRow(row: EpisodeCurrentDbRow): EpisodeCurrent {
  return {
    id: row.id,
    projectId: row.projectId,
    episodeId: row.episodeId,
    currentRevisionId: row.currentRevisionId,
    updatedAt: row.updatedAt
  };
}

function mapNotificationRow(row: NotificationDbRow): Notification {
  return {
    id: row.id,
    projectId: row.projectId,
    episodeId: optional(row.episodeId),
    recipientId: row.recipientId,
    type: row.type,
    title: row.title,
    body: row.body,
    readAt: optional(row.readAt),
    createdAt: row.createdAt
  };
}

function optional<T>(value: T | null | undefined) {
  return value ?? undefined;
}
