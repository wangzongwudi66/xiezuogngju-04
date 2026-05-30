import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

const projectRoleValues = ["owner", "coordinator", "head_writer", "writer", "creator"] as const;
const projectStatusValues = ["active", "archived"] as const;
const permissionKeyValues = [
  "canManageProjects",
  "canManageMembers",
  "canAssignEpisodes",
  "canViewProjectOverview",
  "canViewAllEpisodes",
  "canSubmitWriting",
  "canReviewAssets",
  "canViewAssignedEpisodes"
] as const;
const episodeProductionStatusValues = ["not_started", "in_progress", "key_update", "blocked", "done"] as const;
const episodeAssignmentResponsibilityValues = ["writer", "lead_creator", "creator", "reviewer", "support"] as const;

const quotedCheckValues = (values: readonly string[]) => values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
const textEnumCheck = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} in (${sql.raw(quotedCheckValues(values))})`;

const timestampWithTimezone = (name: string) => timestamp(name, { mode: "string", withTimezone: true });

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    defaultRole: text("default_role", { enum: projectRoleValues }).notNull(),
    avatarTone: text("avatar_tone").notNull()
  },
  (table) => [
    unique("users_name_unique").on(table.name),
    check("users_name_not_blank", sql`trim(${table.name}) <> ''`),
    check("users_default_role_check", textEnumCheck(table.defaultRole, projectRoleValues)),
    check("users_avatar_tone_not_blank", sql`trim(${table.avatarTone}) <> ''`)
  ]
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    episodeCount: integer("episode_count").notNull(),
    status: text("status", { enum: projectStatusValues }).notNull(),
    createdAt: timestampWithTimezone("created_at").notNull()
  },
  (table) => [
    unique("projects_code_unique").on(table.code),
    check("projects_name_not_blank", sql`trim(${table.name}) <> ''`),
    check("projects_code_not_blank", sql`trim(${table.code}) <> ''`),
    check("projects_episode_count_positive", sql`${table.episodeCount} > 0`),
    check("projects_status_check", textEnumCheck(table.status, projectStatusValues)),
    index("projects_status_created_idx").on(table.status, table.createdAt)
  ]
);

export const projectMembers = pgTable(
  "project_members",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: projectRoleValues }).notNull(),
    createdAt: timestampWithTimezone("created_at").notNull()
  },
  (table) => [
    unique("project_members_project_user_role_unique").on(table.projectId, table.userId, table.role),
    check("project_members_role_check", textEnumCheck(table.role, projectRoleValues)),
    index("project_members_project_user_idx").on(table.projectId, table.userId),
    index("project_members_user_idx").on(table.userId)
  ]
);

export const projectMemberPermissions = pgTable(
  "project_member_permissions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permission: text("permission", { enum: permissionKeyValues }).notNull(),
    grantedAt: timestampWithTimezone("granted_at").notNull()
  },
  (table) => [
    unique("project_member_permissions_project_user_permission_unique").on(table.projectId, table.userId, table.permission),
    check("project_member_permissions_permission_check", textEnumCheck(table.permission, permissionKeyValues)),
    index("project_member_permissions_project_user_idx").on(table.projectId, table.userId),
    index("project_member_permissions_user_idx").on(table.userId)
  ]
);

export const episodes = pgTable(
  "episodes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    episodeNo: integer("episode_no").notNull(),
    title: text("title").notNull(),
    productionStatus: text("production_status", { enum: episodeProductionStatusValues }).notNull(),
    hasUnreadKeyChange: boolean("has_unread_key_change").notNull(),
    openIssueCount: integer("open_issue_count").notNull(),
    assetTodoCount: integer("asset_todo_count").notNull()
  },
  (table) => [
    unique("episodes_project_episode_no_unique").on(table.projectId, table.episodeNo),
    check("episodes_episode_no_positive", sql`${table.episodeNo} > 0`),
    check("episodes_title_not_blank", sql`trim(${table.title}) <> ''`),
    check("episodes_production_status_check", textEnumCheck(table.productionStatus, episodeProductionStatusValues)),
    check("episodes_open_issue_count_non_negative", sql`${table.openIssueCount} >= 0`),
    check("episodes_asset_todo_count_non_negative", sql`${table.assetTodoCount} >= 0`),
    index("episodes_project_episode_no_idx").on(table.projectId, table.episodeNo),
    index("episodes_project_status_idx").on(table.projectId, table.productionStatus)
  ]
);

export const episodeAssignments = pgTable(
  "episode_assignments",
  {
    id: text("id").primaryKey(),
    episodeId: text("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    responsibility: text("responsibility", { enum: episodeAssignmentResponsibilityValues }).notNull(),
    createdAt: timestampWithTimezone("created_at").notNull()
  },
  (table) => [
    unique("episode_assignments_episode_user_unique").on(table.episodeId, table.userId),
    check("episode_assignments_responsibility_check", textEnumCheck(table.responsibility, episodeAssignmentResponsibilityValues)),
    index("episode_assignments_episode_user_idx").on(table.episodeId, table.userId),
    index("episode_assignments_user_idx").on(table.userId)
  ]
);
