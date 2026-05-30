import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

const notificationTypeValues = ["mention", "key_change", "assignment", "system"] as const;

const quotedCheckValues = (values: readonly string[]) => values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
const textEnumCheck = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} in (${sql.raw(quotedCheckValues(values))})`;

const timestampWithTimezone = (name: string) => timestamp(name, { mode: "string", withTimezone: true });

export const episodeRevisions = pgTable(
  "episode_revisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    episodeId: text("episode_id").notNull(),
    episodeNo: integer("episode_no").notNull(),
    deliveryPackageId: text("delivery_package_id").notNull(),
    revisionNo: integer("revision_no").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    previousRevisionId: text("previous_revision_id"),
    changeSummary: text("change_summary").notNull(),
    createdAt: timestampWithTimezone("created_at").notNull()
  },
  (table) => [
    unique("episode_revisions_episode_revision_no_unique").on(table.episodeId, table.revisionNo),
    check("episode_revisions_episode_no_positive", sql`${table.episodeNo} > 0`),
    check("episode_revisions_revision_no_positive", sql`${table.revisionNo} > 0`),
    check("episode_revisions_title_not_blank", sql`trim(${table.title}) <> ''`),
    check("episode_revisions_change_summary_not_blank", sql`trim(${table.changeSummary}) <> ''`),
    index("episode_revisions_project_episode_revision_idx").on(table.projectId, table.episodeNo, table.revisionNo),
    index("episode_revisions_delivery_package_idx").on(table.deliveryPackageId)
  ]
);

export const episodeCurrents = pgTable(
  "episode_currents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    episodeId: text("episode_id").notNull(),
    currentRevisionId: text("current_revision_id").notNull().references(() => episodeRevisions.id),
    updatedAt: timestampWithTimezone("updated_at").notNull()
  },
  (table) => [
    unique("episode_currents_episode_id_unique").on(table.episodeId),
    index("episode_currents_project_updated_idx").on(table.projectId, table.updatedAt)
  ]
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    episodeId: text("episode_id"),
    recipientId: text("recipient_id").notNull(),
    type: text("type", { enum: notificationTypeValues }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: timestampWithTimezone("read_at"),
    createdAt: timestampWithTimezone("created_at").notNull()
  },
  (table) => [
    check("notifications_type_check", textEnumCheck(table.type, notificationTypeValues)),
    check("notifications_title_not_blank", sql`trim(${table.title}) <> ''`),
    check("notifications_body_not_blank", sql`trim(${table.body}) <> ''`),
    index("notifications_recipient_created_idx").on(table.recipientId, table.createdAt),
    index("notifications_project_created_idx").on(table.projectId, table.createdAt),
    index("notifications_episode_idx").on(table.episodeId)
  ]
);
