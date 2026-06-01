import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, index, integer, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";

const assetConfirmationValues = ["pending", "confirmed", "returned"] as const;
const assetLockStatusValues = ["draft", "needs_info", "disputed", "ready_to_lock", "locked"] as const;
const assetRiskValues = ["normal", "attention", "high"] as const;
const assetTypeValues = ["character", "scene", "prop", "vehicle", "effect"] as const;
const assetChangeTypeValues = ["new", "modified", "removed", "reused"] as const;
const assetAttachmentTypeValues = ["reference", "production", "final"] as const;
const assetAttachmentStatusValues = ["active", "deleted"] as const;
const assetAttachmentMimeValues = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

const quotedCheckValues = (values: readonly string[]) => values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
const textEnumCheck = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} in (${sql.raw(quotedCheckValues(values))})`;

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
    check("asset_lock_records_asset_type_check", textEnumCheck(table.assetType, assetTypeValues)),
    check("asset_lock_records_change_type_check", textEnumCheck(table.changeType, assetChangeTypeValues)),
    check("asset_lock_records_writer_confirmation_check", textEnumCheck(table.writerConfirmation, assetConfirmationValues)),
    check(
      "asset_lock_records_production_confirmation_check",
      textEnumCheck(table.productionConfirmation, assetConfirmationValues)
    ),
    check("asset_lock_records_risk_check", textEnumCheck(table.risk, assetRiskValues)),
    check("asset_lock_records_status_check", textEnumCheck(table.status, assetLockStatusValues)),
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

export const scriptSourceBindings = pgTable(
  "script_source_bindings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    deliveryPackageId: text("delivery_package_id").notNull(),
    assetLockRecordId: text("asset_lock_record_id")
      .notNull()
      .references(() => assetLockRecords.id, { onDelete: "cascade" }),
    episodeNo: integer("episode_no").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    excerptSnapshot: text("excerpt_snapshot").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestampWithTimezone("created_at").notNull()
  },
  (table) => [
    unique("script_source_bindings_record_package_episode_lines_unique").on(
      table.assetLockRecordId,
      table.deliveryPackageId,
      table.episodeNo,
      table.startLine,
      table.endLine
    ),
    check("script_source_bindings_episode_no_positive", sql`${table.episodeNo} > 0`),
    check("script_source_bindings_start_line_positive", sql`${table.startLine} > 0`),
    check("script_source_bindings_end_line_positive", sql`${table.endLine} > 0`),
    check("script_source_bindings_line_range_valid", sql`${table.endLine} >= ${table.startLine}`),
    index("script_source_bindings_asset_lock_record_idx").on(table.assetLockRecordId),
    index("script_source_bindings_project_package_idx").on(table.projectId, table.deliveryPackageId)
  ]
);

export const assetAttachments = pgTable(
  "asset_attachments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    assetLockRecordId: text("asset_lock_record_id")
      .notNull()
      .references(() => assetLockRecords.id, { onDelete: "cascade" }),
    deliveryPackageId: text("delivery_package_id").notNull(),
    fileId: text("file_id").notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime", { enum: assetAttachmentMimeValues }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key"),
    checksumSha256: text("checksum_sha256"),
    version: integer("version").notNull(),
    attachmentType: text("attachment_type", { enum: assetAttachmentTypeValues }).notNull(),
    uploadedByUserId: text("uploaded_by_user_id").notNull(),
    uploadedAt: timestampWithTimezone("uploaded_at").notNull(),
    note: text("note"),
    status: text("status", { enum: assetAttachmentStatusValues }).default("active").notNull(),
    deletedByUserId: text("deleted_by_user_id"),
    deletedAt: timestampWithTimezone("deleted_at")
  },
  (table) => [
    unique("asset_attachments_file_id_unique").on(table.fileId),
    unique("asset_attachments_record_version_unique").on(table.assetLockRecordId, table.version),
    unique("asset_attachments_storage_key_unique").on(table.storageKey),
    check("asset_attachments_size_bytes_positive", sql`${table.sizeBytes} > 0`),
    check("asset_attachments_version_positive", sql`${table.version} > 0`),
    check(
      "asset_attachments_checksum_sha256_format",
      sql`${table.checksumSha256} is null or ${table.checksumSha256} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      "asset_attachments_storage_key_not_blank",
      sql`${table.storageKey} is null or trim(${table.storageKey}) <> ''`
    ),
    check("asset_attachments_type_check", textEnumCheck(table.attachmentType, assetAttachmentTypeValues)),
    check("asset_attachments_mime_check", textEnumCheck(table.mime, assetAttachmentMimeValues)),
    check("asset_attachments_status_check", textEnumCheck(table.status, assetAttachmentStatusValues)),
    check(
      "asset_attachments_delete_state_check",
      sql`(
        (${table.status} = 'active' and ${table.deletedByUserId} is null and ${table.deletedAt} is null)
        or (${table.status} = 'deleted' and ${table.deletedByUserId} is not null and ${table.deletedAt} is not null)
      )`
    ),
    check("asset_attachments_file_id_not_blank", sql`trim(${table.fileId}) <> ''`),
    check("asset_attachments_file_name_not_blank", sql`trim(${table.fileName}) <> ''`),
    check("asset_attachments_mime_not_blank", sql`trim(${table.mime}) <> ''`),
    check("asset_attachments_uploaded_by_user_id_not_blank", sql`trim(${table.uploadedByUserId}) <> ''`),
    index("asset_attachments_record_status_version_uploaded_idx").on(
      table.assetLockRecordId,
      table.status,
      table.version,
      table.uploadedAt
    ),
    index("asset_attachments_project_package_idx").on(table.projectId, table.deliveryPackageId)
  ]
);
