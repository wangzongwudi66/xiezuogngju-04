import type { Episode, EpisodeAssignment, Project, ProjectMember, ProjectMemberPermission, User } from "@aigc/domain";
import { and, eq, inArray } from "drizzle-orm";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { episodeAssignments, episodes, projectMemberPermissions, projectMembers, projects, users } from "../../../db/schema";
import type { AuthScopeWriteRepository } from "./write-service";

export type AuthScopeUserDbInsert = typeof users.$inferInsert;
export type AuthScopeProjectDbInsert = typeof projects.$inferInsert;
export type AuthScopeEpisodeDbInsert = typeof episodes.$inferInsert;
export type AuthScopeProjectMemberDbInsert = typeof projectMembers.$inferInsert;
export type AuthScopeProjectMemberPermissionDbInsert = typeof projectMemberPermissions.$inferInsert;
export type AuthScopeEpisodeAssignmentDbInsert = typeof episodeAssignments.$inferInsert;

type AuthScopeProjectDbUpdate = Omit<AuthScopeProjectDbInsert, "id">;

export function createDbAuthScopeWriteRepository(): AuthScopeWriteRepository {
  return {
    async createUser(user) {
      const { db } = getAssetLockDbRuntime();
      await db.insert(users).values(mapUserToDbInsertRow(user));
    },

    async createProjectWithEpisodes(project, projectEpisodes) {
      const { db } = getAssetLockDbRuntime();

      await db.transaction(async (tx) => {
        await tx.insert(projects).values(mapProjectToDbInsertRow(project));

        if (projectEpisodes.length > 0) {
          await tx.insert(episodes).values(projectEpisodes.map(mapEpisodeToDbInsertRow));
        }
      });
    },

    async updateProject(project) {
      const { db } = getAssetLockDbRuntime();
      const updatedRows = await db
        .update(projects)
        .set(mapProjectToDbUpdateRow(project))
        .where(eq(projects.id, project.id))
        .returning({ id: projects.id });

      if (updatedRows.length === 0) {
        throw new Error("auth_scope_project_not_found");
      }
    },

    async replaceProjectMemberRoles(projectId, userId, members) {
      const { db } = getAssetLockDbRuntime();

      await db.transaction(async (tx) => {
        await tx.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));

        if (members.length > 0) {
          await tx.insert(projectMembers).values(members.map(mapProjectMemberToDbInsertRow));
        }
      });
    },

    async replaceProjectMemberPermissions(projectId, userId, permissions) {
      const { db } = getAssetLockDbRuntime();

      await db.transaction(async (tx) => {
        await tx
          .delete(projectMemberPermissions)
          .where(and(eq(projectMemberPermissions.projectId, projectId), eq(projectMemberPermissions.userId, userId)));

        if (permissions.length > 0) {
          await tx.insert(projectMemberPermissions).values(permissions.map(mapProjectMemberPermissionToDbInsertRow));
        }
      });
    },

    async replaceEpisodeAssignments(_projectId, userId, episodeIds, assignments) {
      const { db } = getAssetLockDbRuntime();

      await db.transaction(async (tx) => {
        if (episodeIds.length > 0) {
          await tx
            .delete(episodeAssignments)
            .where(and(eq(episodeAssignments.userId, userId), inArray(episodeAssignments.episodeId, episodeIds)));
        }

        if (assignments.length > 0) {
          await tx.insert(episodeAssignments).values(assignments.map(mapEpisodeAssignmentToDbInsertRow));
        }
      });
    }
  };
}

export function mapUserToDbInsertRow(user: User): AuthScopeUserDbInsert {
  return {
    id: user.id,
    name: user.name,
    defaultRole: user.defaultRole,
    avatarTone: user.avatarTone
  };
}

export function mapProjectToDbInsertRow(project: Project): AuthScopeProjectDbInsert {
  return {
    id: project.id,
    ...mapProjectToDbUpdateRow(project)
  };
}

export function mapProjectToDbUpdateRow(project: Project): AuthScopeProjectDbUpdate {
  return {
    name: project.name,
    code: project.code,
    episodeCount: project.episodeCount,
    status: project.status,
    createdAt: project.createdAt
  };
}

export function mapEpisodeToDbInsertRow(episode: Episode): AuthScopeEpisodeDbInsert {
  return {
    id: episode.id,
    projectId: episode.projectId,
    episodeNo: episode.episodeNo,
    title: episode.title,
    productionStatus: episode.productionStatus,
    hasUnreadKeyChange: episode.hasUnreadKeyChange,
    openIssueCount: episode.openIssueCount,
    assetTodoCount: episode.assetTodoCount
  };
}

export function mapProjectMemberToDbInsertRow(member: ProjectMember): AuthScopeProjectMemberDbInsert {
  return {
    id: member.id,
    projectId: member.projectId,
    userId: member.userId,
    role: member.role,
    createdAt: member.createdAt
  };
}

export function mapProjectMemberPermissionToDbInsertRow(
  permission: ProjectMemberPermission
): AuthScopeProjectMemberPermissionDbInsert {
  return {
    id: permission.id,
    projectId: permission.projectId,
    userId: permission.userId,
    permission: permission.permission,
    grantedAt: permission.grantedAt
  };
}

export function mapEpisodeAssignmentToDbInsertRow(
  assignment: EpisodeAssignment
): AuthScopeEpisodeAssignmentDbInsert {
  return {
    id: assignment.id,
    episodeId: assignment.episodeId,
    userId: assignment.userId,
    responsibility: assignment.responsibility,
    createdAt: assignment.createdAt
  };
}
