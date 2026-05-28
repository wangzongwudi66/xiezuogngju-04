CREATE TABLE "script_source_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"delivery_package_id" text NOT NULL,
	"asset_lock_record_id" text NOT NULL,
	"episode_no" integer NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"excerpt_snapshot" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "script_source_bindings_record_package_episode_lines_unique" UNIQUE("asset_lock_record_id","delivery_package_id","episode_no","start_line","end_line"),
	CONSTRAINT "script_source_bindings_episode_no_positive" CHECK ("script_source_bindings"."episode_no" > 0),
	CONSTRAINT "script_source_bindings_start_line_positive" CHECK ("script_source_bindings"."start_line" > 0),
	CONSTRAINT "script_source_bindings_end_line_positive" CHECK ("script_source_bindings"."end_line" > 0),
	CONSTRAINT "script_source_bindings_line_range_valid" CHECK ("script_source_bindings"."end_line" >= "script_source_bindings"."start_line")
);
--> statement-breakpoint
ALTER TABLE "script_source_bindings" ADD CONSTRAINT "script_source_bindings_asset_lock_record_id_asset_lock_records_id_fk" FOREIGN KEY ("asset_lock_record_id") REFERENCES "public"."asset_lock_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "script_source_bindings_asset_lock_record_idx" ON "script_source_bindings" USING btree ("asset_lock_record_id");--> statement-breakpoint
CREATE INDEX "script_source_bindings_project_package_idx" ON "script_source_bindings" USING btree ("project_id","delivery_package_id");