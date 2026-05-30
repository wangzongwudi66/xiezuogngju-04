import type {
  Episode,
  EpisodeAssignment,
  Project,
  ProjectMember,
  ProjectMemberPermission,
  User,
  WorkspaceState
} from "@aigc/domain";
import { asc } from "drizzle-orm";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { episodeAssignments, episodes, projectMemberPermissions, projectMembers, projects, users } from "../../../db/schema";

export type UserDbRow = typeof users.$inferSelect;
export type ProjectDbRow = typeof projects.$inferSelect;
export type ProjectMemberDbRow = typeof projectMembers.$inferSelect;
export type ProjectMemberPermissionDbRow = typeof projectMemberPermissions.$inferSelect;
export type EpisodeDbRow = typeof episodes.$inferSelect;
export type EpisodeAssignmentDbRow = typeof episodeAssignments.$inferSelect;

export interface AuthScopeDbRows {
  userRows: UserDbRow[];
  projectRows: ProjectDbRow[];
  memberRows: ProjectMemberDbRow[];
  memberPermissionRows: ProjectMemberPermissionDbRow[];
  episodeRows: EpisodeDbRow[];
  assignmentRows: EpisodeAssignmentDbRow[];
}

export type AuthScopeDbSnapshot = Pick<
  WorkspaceState,
  "users" | "projects" | "members" | "memberPermissions" | "episodes" | "assignments"
>;

export async function readDbAuthScopeSnapshot(): Promise<AuthScopeDbSnapshot> {
  const { db } = getAssetLockDbRuntime();
  const [userRows, projectRows, memberRows, memberPermissionRows, episodeRows, assignmentRows] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name), asc(users.id)),
    db.select().from(projects).orderBy(asc(projects.createdAt), asc(projects.id)),
    db
      .select()
      .from(projectMembers)
      .orderBy(asc(projectMembers.projectId), asc(projectMembers.userId), asc(projectMembers.role), asc(projectMembers.id)),
    db
      .select()
      .from(projectMemberPermissions)
      .orderBy(
        asc(projectMemberPermissions.projectId),
        asc(projectMemberPermissions.userId),
        asc(projectMemberPermissions.permission),
        asc(projectMemberPermissions.id)
      ),
    db.select().from(episodes).orderBy(asc(episodes.projectId), asc(episodes.episodeNo), asc(episodes.id)),
    db
      .select()
      .from(episodeAssignments)
      .orderBy(
        asc(episodeAssignments.episodeId),
        asc(episodeAssignments.userId),
        asc(episodeAssignments.responsibility),
        asc(episodeAssignments.id)
      )
  ]);

  return mapAuthScopeRows({
    userRows,
    projectRows,
    memberRows,
    memberPermissionRows,
    episodeRows,
    assignmentRows
  });
}

export function mapAuthScopeRows(rows: AuthScopeDbRows): AuthScopeDbSnapshot {
  return {
    users: rows.userRows.map(mapUserRow),
    projects: rows.projectRows.map(mapProjectRow),
    members: rows.memberRows.map(mapProjectMemberRow),
    memberPermissions: rows.memberPermissionRows.map(mapProjectMemberPermissionRow),
    episodes: rows.episodeRows.map(mapEpisodeRow),
    assignments: rows.assignmentRows.map(mapEpisodeAssignmentRow)
  };
}

function mapUserRow(row: UserDbRow): User {
  return {
    id: row.id,
    name: row.name,
    defaultRole: row.defaultRole,
    avatarTone: row.avatarTone
  };
}

function mapProjectRow(row: ProjectDbRow): Project {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    episodeCount: row.episodeCount,
    status: row.status,
    createdAt: row.createdAt
  };
}

function mapProjectMemberRow(row: ProjectMemberDbRow): ProjectMember {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
    createdAt: row.createdAt
  };
}

function mapProjectMemberPermissionRow(row: ProjectMemberPermissionDbRow): ProjectMemberPermission {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    permission: row.permission,
    grantedAt: row.grantedAt
  };
}

function mapEpisodeRow(row: EpisodeDbRow): Episode {
  return {
    id: row.id,
    projectId: row.projectId,
    episodeNo: row.episodeNo,
    title: row.title,
    productionStatus: row.productionStatus,
    hasUnreadKeyChange: row.hasUnreadKeyChange,
    openIssueCount: row.openIssueCount,
    assetTodoCount: row.assetTodoCount
  };
}

function mapEpisodeAssignmentRow(row: EpisodeAssignmentDbRow): EpisodeAssignment {
  return {
    id: row.id,
    episodeId: row.episodeId,
    userId: row.userId,
    responsibility: row.responsibility,
    createdAt: row.createdAt
  };
}
