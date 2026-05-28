import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";

const assetConfirmationValues = ["pending", "confirmed", "returned"] as const;
const assetLockStatusValues = ["draft", "needs_info", "disputed", "ready_to_lock", "locked"] as const;
const assetRiskValues = ["normal", "attention", "high"] as const;
const assetTypeValues = ["character", "scene", "prop", "vehicle", "effect"] as const;
const assetChangeTypeValues = ["new", "modified", "removed", "reused"] as const;

const timestampWithTimezone = (name: string) => timestamp(name, { mode: "string", withTimezone: true });

export const assetLockRecords = pgTable(
  "asset_lock_records",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    deliveryPackageId: text("delivery_package_id").notNull(),
    assetName: text("asset_name").notNull(),
    assetNameKey: text("asset_name_key").notNull(),
    assetType: text("asset_type", { enum: assetTypeValues }).notNull(),
    changeType: text("change_type", { enum: assetChangeTypeValues }).notNull(),
    writerConfirmation: text("writer_confirmation", { enum: assetConfirmationValues }).default("pending").notNull(),
    writerConfirmedByUserId: text("writer_confirmed_by_user_id"),
    writerConfirmedAt: timestampWithTimezone("writer_confirmed_at"),
    writerNote: text("writer_note"),
    productionConfirmation: text("production_confirmation", { enum: assetConfirmationValues }).default("pending").notNull(),
    productionConfirmedByUserId: text("production_confirmed_by_user_id"),
    productionConfirmedAt: timestampWithTimezone("production_confirmed_at"),
    productionNote: text("production_note"),
    risk: text("risk", { enum: assetRiskValues }).default("normal").notNull(),
    status: text("status", { enum: assetLockStatusValues }).default("draft").notNull(),
    missingInfo: text("missing_info"),
    disputeReason: text("dispute_reason"),
    finalLockedByUserId: text("final_locked_by_user_id"),
    finalLockedAt: timestampWithTimezone("final_locked_at"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull()
  },
  (table) => [
    unique("asset_lock_records_delivery_package_name_key_unique").on(table.deliveryPackageId, table.assetNameKey),
    index("asset_lock_records_project_updated_idx").on(table.projectId, table.updatedAt),
    index("asset_lock_records_delivery_package_idx").on(table.deliveryPackageId)
  ]
);

export const assetLockRecordEpisodes = pgTable(
  "asset_lock_record_episodes",
  {
    assetLockRecordId: text("asset_lock_record_id")
      .notNull()
      .references(() => assetLockRecords.id, { onDelete: "cascade" }),
    episodeNo: integer("episode_no").notNull(),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull()
  },
  (table) => [
    primaryKey({
      columns: [table.assetLockRecordId, table.episodeNo],
      name: "asset_lock_record_episodes_pkey"
    }),
    check("asset_lock_record_episodes_episode_no_positive", sql`${table.episodeNo} > 0`),
    index("asset_lock_record_episodes_episode_no_idx").on(table.episodeNo)
  ]
);
