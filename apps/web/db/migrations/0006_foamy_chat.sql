CREATE TABLE "episode_currents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"current_revision_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "episode_currents_episode_id_unique" UNIQUE("episode_id")
);
--> statement-breakpoint
CREATE TABLE "episode_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"episode_id" text NOT NULL,
	"episode_no" integer NOT NULL,
	"delivery_package_id" text NOT NULL,
	"revision_no" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"previous_revision_id" text,
	"change_summary" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "episode_revisions_episode_revision_no_unique" UNIQUE("episode_id","revision_no"),
	CONSTRAINT "episode_revisions_episode_no_positive" CHECK ("episode_revisions"."episode_no" > 0),
	CONSTRAINT "episode_revisions_revision_no_positive" CHECK ("episode_revisions"."revision_no" > 0),
	CONSTRAINT "episode_revisions_title_not_blank" CHECK (trim("episode_revisions"."title") <> ''),
	CONSTRAINT "episode_revisions_change_summary_not_blank" CHECK (trim("episode_revisions"."change_summary") <> '')
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"episode_id" text,
	"recipient_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('mention', 'key_change', 'assignment', 'system')),
	CONSTRAINT "notifications_title_not_blank" CHECK (trim("notifications"."title") <> ''),
	CONSTRAINT "notifications_body_not_blank" CHECK (trim("notifications"."body") <> '')
);
--> statement-breakpoint
ALTER TABLE "episode_currents" ADD CONSTRAINT "episode_currents_current_revision_id_episode_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."episode_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_currents_project_updated_idx" ON "episode_currents" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "episode_revisions_project_episode_revision_idx" ON "episode_revisions" USING btree ("project_id","episode_no","revision_no");--> statement-breakpoint
CREATE INDEX "episode_revisions_delivery_package_idx" ON "episode_revisions" USING btree ("delivery_package_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_project_created_idx" ON "notifications" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_episode_idx" ON "notifications" USING btree ("episode_id");