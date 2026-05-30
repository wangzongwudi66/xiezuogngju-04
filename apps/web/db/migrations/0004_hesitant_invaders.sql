CREATE TABLE "delivery_package_episodes" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_package_id" text NOT NULL,
	"episode_no" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"is_confirmed_change" boolean NOT NULL,
	CONSTRAINT "delivery_package_episodes_package_episode_no_unique" UNIQUE("delivery_package_id","episode_no"),
	CONSTRAINT "delivery_package_episodes_episode_no_positive" CHECK ("delivery_package_episodes"."episode_no" > 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"source_file_name" text,
	"declared_episode_from" integer NOT NULL,
	"declared_episode_to" integer NOT NULL,
	"status" text NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"submitted_by_user_id" text,
	"reviewed_by_user_id" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	CONSTRAINT "delivery_packages_type_check" CHECK ("delivery_packages"."type" in ('range', 'single_replace')),
	CONSTRAINT "delivery_packages_status_check" CHECK ("delivery_packages"."status" in ('draft', 'pending_review', 'published', 'rejected')),
	CONSTRAINT "delivery_packages_declared_episode_from_positive" CHECK ("delivery_packages"."declared_episode_from" > 0),
	CONSTRAINT "delivery_packages_declared_episode_to_positive" CHECK ("delivery_packages"."declared_episode_to" > 0),
	CONSTRAINT "delivery_packages_declared_episode_range_valid" CHECK ("delivery_packages"."declared_episode_to" >= "delivery_packages"."declared_episode_from"),
	CONSTRAINT "delivery_packages_single_replace_single_episode" CHECK ("delivery_packages"."type" <> 'single_replace' or "delivery_packages"."declared_episode_from" = "delivery_packages"."declared_episode_to")
);
--> statement-breakpoint
ALTER TABLE "delivery_package_episodes" ADD CONSTRAINT "delivery_package_episodes_delivery_package_id_delivery_packages_id_fk" FOREIGN KEY ("delivery_package_id") REFERENCES "public"."delivery_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_package_episodes_package_episode_no_idx" ON "delivery_package_episodes" USING btree ("delivery_package_id","episode_no");--> statement-breakpoint
CREATE INDEX "delivery_packages_project_status_published_idx" ON "delivery_packages" USING btree ("project_id","status","published_at");--> statement-breakpoint
CREATE INDEX "delivery_packages_project_created_idx" ON "delivery_packages" USING btree ("project_id","created_at");