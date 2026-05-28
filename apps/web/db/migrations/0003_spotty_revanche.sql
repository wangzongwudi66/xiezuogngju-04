CREATE TABLE "asset_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"asset_lock_record_id" text NOT NULL,
	"delivery_package_id" text NOT NULL,
	"file_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"version" integer NOT NULL,
	"attachment_type" text NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	"note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_by_user_id" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "asset_attachments_file_id_unique" UNIQUE("file_id"),
	CONSTRAINT "asset_attachments_record_version_unique" UNIQUE("asset_lock_record_id","version"),
	CONSTRAINT "asset_attachments_size_bytes_positive" CHECK ("asset_attachments"."size_bytes" > 0),
	CONSTRAINT "asset_attachments_version_positive" CHECK ("asset_attachments"."version" > 0),
	CONSTRAINT "asset_attachments_type_check" CHECK ("asset_attachments"."attachment_type" in ('reference', 'production', 'final')),
	CONSTRAINT "asset_attachments_mime_check" CHECK ("asset_attachments"."mime" in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
	CONSTRAINT "asset_attachments_status_check" CHECK ("asset_attachments"."status" in ('active', 'deleted')),
	CONSTRAINT "asset_attachments_delete_state_check" CHECK ((
        ("asset_attachments"."status" = 'active' and "asset_attachments"."deleted_by_user_id" is null and "asset_attachments"."deleted_at" is null)
        or ("asset_attachments"."status" = 'deleted' and "asset_attachments"."deleted_by_user_id" is not null and "asset_attachments"."deleted_at" is not null)
      )),
	CONSTRAINT "asset_attachments_file_id_not_blank" CHECK (trim("asset_attachments"."file_id") <> ''),
	CONSTRAINT "asset_attachments_file_name_not_blank" CHECK (trim("asset_attachments"."file_name") <> ''),
	CONSTRAINT "asset_attachments_mime_not_blank" CHECK (trim("asset_attachments"."mime") <> ''),
	CONSTRAINT "asset_attachments_uploaded_by_user_id_not_blank" CHECK (trim("asset_attachments"."uploaded_by_user_id") <> '')
);
--> statement-breakpoint
ALTER TABLE "asset_attachments" ADD CONSTRAINT "asset_attachments_asset_lock_record_id_asset_lock_records_id_fk" FOREIGN KEY ("asset_lock_record_id") REFERENCES "public"."asset_lock_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_attachments_record_status_version_uploaded_idx" ON "asset_attachments" USING btree ("asset_lock_record_id","status","version","uploaded_at");--> statement-breakpoint
CREATE INDEX "asset_attachments_project_package_idx" ON "asset_attachments" USING btree ("project_id","delivery_package_id");