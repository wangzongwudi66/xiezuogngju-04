ALTER TABLE "asset_attachments" ADD CONSTRAINT "asset_attachments_checksum_sha256_format"
CHECK ("checksum_sha256" IS NULL OR "checksum_sha256" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "asset_attachments" ADD CONSTRAINT "asset_attachments_storage_key_not_blank"
CHECK ("storage_key" IS NULL OR trim("storage_key") <> '');--> statement-breakpoint
ALTER TABLE "asset_attachments" ADD CONSTRAINT "asset_attachments_storage_key_unique" UNIQUE("storage_key");
