CREATE TABLE "episode_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"episode_id" text NOT NULL,
	"user_id" text NOT NULL,
	"responsibility" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "episode_assignments_episode_user_unique" UNIQUE("episode_id","user_id"),
	CONSTRAINT "episode_assignments_responsibility_check" CHECK ("episode_assignments"."responsibility" in ('writer', 'lead_creator', 'creator', 'reviewer', 'support'))
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"episode_no" integer NOT NULL,
	"title" text NOT NULL,
	"production_status" text NOT NULL,
	"has_unread_key_change" boolean NOT NULL,
	"open_issue_count" integer NOT NULL,
	"asset_todo_count" integer NOT NULL,
	CONSTRAINT "episodes_project_episode_no_unique" UNIQUE("project_id","episode_no"),
	CONSTRAINT "episodes_episode_no_positive" CHECK ("episodes"."episode_no" > 0),
	CONSTRAINT "episodes_title_not_blank" CHECK (trim("episodes"."title") <> ''),
	CONSTRAINT "episodes_production_status_check" CHECK ("episodes"."production_status" in ('not_started', 'in_progress', 'key_update', 'blocked', 'done')),
	CONSTRAINT "episodes_open_issue_count_non_negative" CHECK ("episodes"."open_issue_count" >= 0),
	CONSTRAINT "episodes_asset_todo_count_non_negative" CHECK ("episodes"."asset_todo_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_member_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"permission" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "project_member_permissions_project_user_permission_unique" UNIQUE("project_id","user_id","permission"),
	CONSTRAINT "project_member_permissions_permission_check" CHECK ("project_member_permissions"."permission" in ('canManageProjects', 'canManageMembers', 'canAssignEpisodes', 'canViewProjectOverview', 'canViewAllEpisodes', 'canSubmitWriting', 'canReviewAssets', 'canViewAssignedEpisodes'))
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "project_members_project_user_role_unique" UNIQUE("project_id","user_id","role"),
	CONSTRAINT "project_members_role_check" CHECK ("project_members"."role" in ('owner', 'coordinator', 'head_writer', 'writer', 'creator'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"episode_count" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "projects_code_unique" UNIQUE("code"),
	CONSTRAINT "projects_name_not_blank" CHECK (trim("projects"."name") <> ''),
	CONSTRAINT "projects_code_not_blank" CHECK (trim("projects"."code") <> ''),
	CONSTRAINT "projects_episode_count_positive" CHECK ("projects"."episode_count" > 0),
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"default_role" text NOT NULL,
	"avatar_tone" text NOT NULL,
	CONSTRAINT "users_name_unique" UNIQUE("name"),
	CONSTRAINT "users_name_not_blank" CHECK (trim("users"."name") <> ''),
	CONSTRAINT "users_default_role_check" CHECK ("users"."default_role" in ('owner', 'coordinator', 'head_writer', 'writer', 'creator')),
	CONSTRAINT "users_avatar_tone_not_blank" CHECK (trim("users"."avatar_tone") <> '')
);
--> statement-breakpoint
ALTER TABLE "episode_assignments" ADD CONSTRAINT "episode_assignments_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_assignments" ADD CONSTRAINT "episode_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member_permissions" ADD CONSTRAINT "project_member_permissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member_permissions" ADD CONSTRAINT "project_member_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "episode_assignments_episode_user_idx" ON "episode_assignments" USING btree ("episode_id","user_id");--> statement-breakpoint
CREATE INDEX "episode_assignments_user_idx" ON "episode_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "episodes_project_episode_no_idx" ON "episodes" USING btree ("project_id","episode_no");--> statement-breakpoint
CREATE INDEX "episodes_project_status_idx" ON "episodes" USING btree ("project_id","production_status");--> statement-breakpoint
CREATE INDEX "project_member_permissions_project_user_idx" ON "project_member_permissions" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_member_permissions_user_idx" ON "project_member_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_members_project_user_idx" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_status_created_idx" ON "projects" USING btree ("status","created_at");