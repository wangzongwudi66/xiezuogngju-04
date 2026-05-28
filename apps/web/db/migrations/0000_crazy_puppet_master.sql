CREATE TABLE "asset_lock_record_episodes" (
	"asset_lock_record_id" text NOT NULL,
	"episode_no" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_lock_record_episodes_pkey" PRIMARY KEY("asset_lock_record_id","episode_no"),
	CONSTRAINT "asset_lock_record_episodes_episode_no_positive" CHECK ("asset_lock_record_episodes"."episode_no" > 0)
);
--> statement-breakpoint
CREATE TABLE "asset_lock_records" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"delivery_package_id" text NOT NULL,
	"asset_name" text NOT NULL,
	"asset_name_key" text NOT NULL,
	"asset_type" text NOT NULL,
	"change_type" text NOT NULL,
	"writer_confirmation" text DEFAULT 'pending' NOT NULL,
	"writer_confirmed_by_user_id" text,
	"writer_confirmed_at" timestamp with time zone,
	"writer_note" text,
	"production_confirmation" text DEFAULT 'pending' NOT NULL,
	"production_confirmed_by_user_id" text,
	"production_confirmed_at" timestamp with time zone,
	"production_note" text,
	"risk" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"missing_info" text,
	"dispute_reason" text,
	"final_locked_by_user_id" text,
	"final_locked_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_lock_records_delivery_package_name_key_unique" UNIQUE("delivery_package_id","asset_name_key")
);
--> statement-breakpoint
ALTER TABLE "asset_lock_record_episodes" ADD CONSTRAINT "asset_lock_record_episodes_asset_lock_record_id_asset_lock_records_id_fk" FOREIGN KEY ("asset_lock_record_id") REFERENCES "public"."asset_lock_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_lock_record_episodes_episode_no_idx" ON "asset_lock_record_episodes" USING btree ("episode_no");--> statement-breakpoint
CREATE INDEX "asset_lock_records_project_updated_idx" ON "asset_lock_records" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "asset_lock_records_delivery_package_idx" ON "asset_lock_records" USING btree ("delivery_package_id");