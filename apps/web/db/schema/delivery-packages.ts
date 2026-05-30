import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

const deliveryPackageStatusValues = ["draft", "pending_review", "published", "rejected"] as const;
const deliveryPackageTypeValues = ["range", "single_replace"] as const;

const quotedCheckValues = (values: readonly string[]) => values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
const textEnumCheck = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} in (${sql.raw(quotedCheckValues(values))})`;

const timestampWithTimezone = (name: string) => timestamp(name, { mode: "string", withTimezone: true });

export const deliveryPackages = pgTable(
  "delivery_packages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    type: text("type", { enum: deliveryPackageTypeValues }).notNull(),
    title: text("title").notNull(),
    sourceFileName: text("source_file_name"),
    declaredEpisodeFrom: integer("declared_episode_from").notNull(),
    declaredEpisodeTo: integer("declared_episode_to").notNull(),
    status: text("status", { enum: deliveryPackageStatusValues }).notNull(),
    uploadedByUserId: text("uploaded_by_user_id").notNull(),
    submittedByUserId: text("submitted_by_user_id"),
    reviewedByUserId: text("reviewed_by_user_id"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestampWithTimezone("created_at").notNull(),
    submittedAt: timestampWithTimezone("submitted_at"),
    publishedAt: timestampWithTimezone("published_at"),
    rejectedAt: timestampWithTimezone("rejected_at")
  },
  (table) => [
    check("delivery_packages_type_check", textEnumCheck(table.type, deliveryPackageTypeValues)),
    check("delivery_packages_status_check", textEnumCheck(table.status, deliveryPackageStatusValues)),
    check("delivery_packages_declared_episode_from_positive", sql`${table.declaredEpisodeFrom} > 0`),
    check("delivery_packages_declared_episode_to_positive", sql`${table.declaredEpisodeTo} > 0`),
    check("delivery_packages_declared_episode_range_valid", sql`${table.declaredEpisodeTo} >= ${table.declaredEpisodeFrom}`),
    check(
      "delivery_packages_single_replace_single_episode",
      sql`${table.type} <> 'single_replace' or ${table.declaredEpisodeFrom} = ${table.declaredEpisodeTo}`
    ),
    index("delivery_packages_project_status_published_idx").on(table.projectId, table.status, table.publishedAt),
    index("delivery_packages_project_created_idx").on(table.projectId, table.createdAt)
  ]
);

export const deliveryPackageEpisodes = pgTable(
  "delivery_package_episodes",
  {
    id: text("id").primaryKey(),
    deliveryPackageId: text("delivery_package_id")
      .notNull()
      .references(() => deliveryPackages.id, { onDelete: "cascade" }),
    episodeNo: integer("episode_no").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    isConfirmedChange: boolean("is_confirmed_change").notNull()
  },
  (table) => [
    unique("delivery_package_episodes_package_episode_no_unique").on(table.deliveryPackageId, table.episodeNo),
    check("delivery_package_episodes_episode_no_positive", sql`${table.episodeNo} > 0`),
    index("delivery_package_episodes_package_episode_no_idx").on(table.deliveryPackageId, table.episodeNo)
  ]
);
