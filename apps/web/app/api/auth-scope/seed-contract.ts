import { seedWorkspace, type WorkspaceState } from "@aigc/domain";
import { sql } from "drizzle-orm";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { episodeAssignments, episodes, projectMemberPermissions, projectMembers, projects, users } from "../../../db/schema";

export const AUTH_SCOPE_SEED_STABLE_TIMESTAMP = "2026-05-18T12:00:00.000Z";

export const AUTH_SCOPE_SEED_TABLE_ORDER = [
  "users",
  "projects",
  "project_members",
  "project_member_permissions",
  "episodes",
  "episode_assignments"
] as const;

export type AuthScopeSeedTableName = (typeof AUTH_SCOPE_SEED_TABLE_ORDER)[number];

export type AuthScopeSeedSource = Pick<
  WorkspaceState,
  "users" | "projects" | "members" | "memberPermissions" | "episodes" | "assignments"
>;

export type AuthScopeUserSeedRow = typeof users.$inferInsert;
export type AuthScopeProjectSeedRow = typeof projects.$inferInsert;
export type AuthScopeProjectMemberSeedRow = typeof projectMembers.$inferInsert;
export type AuthScopeProjectMemberPermissionSeedRow = typeof projectMemberPermissions.$inferInsert;
export type AuthScopeEpisodeSeedRow = typeof episodes.$inferInsert;
export type AuthScopeEpisodeAssignmentSeedRow = typeof episodeAssignments.$inferInsert;

export interface AuthScopeSeedRows {
  userRows: AuthScopeUserSeedRow[];
  projectRows: AuthScopeProjectSeedRow[];
  memberRows: AuthScopeProjectMemberSeedRow[];
  memberPermissionRows: AuthScopeProjectMemberPermissionSeedRow[];
  episodeRows: AuthScopeEpisodeSeedRow[];
  assignmentRows: AuthScopeEpisodeAssignmentSeedRow[];
}

export interface AuthScopeSeedStep<Row> {
  table: AuthScopeSeedTableName;
  rows: Row[];
}

export interface AuthScopeSeedContract {
  stableTimestamp: typeof AUTH_SCOPE_SEED_STABLE_TIMESTAMP;
  tableOrder: typeof AUTH_SCOPE_SEED_TABLE_ORDER;
  rows: AuthScopeSeedRows;
  steps: [
    AuthScopeSeedStep<AuthScopeUserSeedRow>,
    AuthScopeSeedStep<AuthScopeProjectSeedRow>,
    AuthScopeSeedStep<AuthScopeProjectMemberSeedRow>,
    AuthScopeSeedStep<AuthScopeProjectMemberPermissionSeedRow>,
    AuthScopeSeedStep<AuthScopeEpisodeSeedRow>,
    AuthScopeSeedStep<AuthScopeEpisodeAssignmentSeedRow>
  ];
}

export type AuthScopeSeedRowCounts = Record<AuthScopeSeedTableName, number>;

export interface AuthScopeSeedResult {
  tableOrder: typeof AUTH_SCOPE_SEED_TABLE_ORDER;
  rowCounts: AuthScopeSeedRowCounts;
}

export const authScopeSeedContract = buildAuthScopeSeedContract(seedWorkspace);

export function buildAuthScopeSeedContract(source: AuthScopeSeedSource): AuthScopeSeedContract {
  const rows = mapAuthScopeSeedRows(source);

  return {
    stableTimestamp: AUTH_SCOPE_SEED_STABLE_TIMESTAMP,
    tableOrder: AUTH_SCOPE_SEED_TABLE_ORDER,
    rows,
    steps: [
      { table: "users", rows: rows.userRows },
      { table: "projects", rows: rows.projectRows },
      { table: "project_members", rows: rows.memberRows },
      { table: "project_member_permissions", rows: rows.memberPermissionRows },
      { table: "episodes", rows: rows.episodeRows },
      { table: "episode_assignments", rows: rows.assignmentRows }
    ]
  };
}

export function mapAuthScopeSeedRows(source: AuthScopeSeedSource): AuthScopeSeedRows {
  return {
    userRows: source.users.map((user) => ({
      id: user.id,
      name: user.name,
      defaultRole: user.defaultRole,
      avatarTone: user.avatarTone
    })),
    projectRows: source.projects.map((project) => ({
      id: project.id,
      name: project.name,
      code: project.code,
      episodeCount: project.episodeCount,
      status: project.status,
      createdAt: project.createdAt
    })),
    memberRows: source.members.map((member) => ({
      id: member.id,
      projectId: member.projectId,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt
    })),
    memberPermissionRows: source.memberPermissions.map((permission) => ({
      id: permission.id,
      projectId: permission.projectId,
      userId: permission.userId,
      permission: permission.permission,
      grantedAt: permission.grantedAt
    })),
    episodeRows: source.episodes.map((episode) => ({
      id: episode.id,
      projectId: episode.projectId,
      episodeNo: episode.episodeNo,
      title: episode.title,
      productionStatus: episode.productionStatus,
      hasUnreadKeyChange: episode.hasUnreadKeyChange,
      openIssueCount: episode.openIssueCount,
      assetTodoCount: episode.assetTodoCount
    })),
    assignmentRows: source.assignments.map((assignment) => ({
      id: assignment.id,
      episodeId: assignment.episodeId,
      userId: assignment.userId,
      responsibility: assignment.responsibility,
      createdAt: assignment.createdAt
    }))
  };
}

export async function seedAuthScopeContract(contract = authScopeSeedContract): Promise<AuthScopeSeedResult> {
  const { db } = getAssetLockDbRuntime();
  const { rows } = contract;

  await db.transaction(async (tx) => {
    if (rows.userRows.length > 0) {
      await tx
        .insert(users)
        .values(rows.userRows)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            name: sql`excluded.name`,
            defaultRole: sql`excluded.default_role`,
            avatarTone: sql`excluded.avatar_tone`
          }
        });
    }

    if (rows.projectRows.length > 0) {
      await tx
        .insert(projects)
        .values(rows.projectRows)
        .onConflictDoUpdate({
          target: projects.id,
          set: {
            name: sql`excluded.name`,
            code: sql`excluded.code`,
            episodeCount: sql`excluded.episode_count`,
            status: sql`excluded.status`,
            createdAt: sql`excluded.created_at`
          }
        });
    }

    if (rows.memberRows.length > 0) {
      await tx
        .insert(projectMembers)
        .values(rows.memberRows)
        .onConflictDoUpdate({
          target: projectMembers.id,
          set: {
            projectId: sql`excluded.project_id`,
            userId: sql`excluded.user_id`,
            role: sql`excluded.role`,
            createdAt: sql`excluded.created_at`
          }
        });
    }

    if (rows.memberPermissionRows.length > 0) {
      await tx
        .insert(projectMemberPermissions)
        .values(rows.memberPermissionRows)
        .onConflictDoUpdate({
          target: projectMemberPermissions.id,
          set: {
            projectId: sql`excluded.project_id`,
            userId: sql`excluded.user_id`,
            permission: sql`excluded.permission`,
            grantedAt: sql`excluded.granted_at`
          }
        });
    }

    if (rows.episodeRows.length > 0) {
      await tx
        .insert(episodes)
        .values(rows.episodeRows)
        .onConflictDoUpdate({
          target: episodes.id,
          set: {
            projectId: sql`excluded.project_id`,
            episodeNo: sql`excluded.episode_no`,
            title: sql`excluded.title`,
            productionStatus: sql`excluded.production_status`,
            hasUnreadKeyChange: sql`excluded.has_unread_key_change`,
            openIssueCount: sql`excluded.open_issue_count`,
            assetTodoCount: sql`excluded.asset_todo_count`
          }
        });
    }

    if (rows.assignmentRows.length > 0) {
      await tx
        .insert(episodeAssignments)
        .values(rows.assignmentRows)
        .onConflictDoUpdate({
          target: episodeAssignments.id,
          set: {
            episodeId: sql`excluded.episode_id`,
            userId: sql`excluded.user_id`,
            responsibility: sql`excluded.responsibility`,
            createdAt: sql`excluded.created_at`
          }
        });
    }
  });

  return {
    tableOrder: contract.tableOrder,
    rowCounts: countAuthScopeSeedRows(rows)
  };
}

export function countAuthScopeSeedRows(rows: AuthScopeSeedRows): AuthScopeSeedRowCounts {
  return {
    users: rows.userRows.length,
    projects: rows.projectRows.length,
    project_members: rows.memberRows.length,
    project_member_permissions: rows.memberPermissionRows.length,
    episodes: rows.episodeRows.length,
    episode_assignments: rows.assignmentRows.length
  };
}
