import { randomUUID } from "node:crypto";
import {
  selectPermissionKeys,
  type Episode,
  type EpisodeAssignment,
  type PermissionKey,
  type Project,
  type ProjectMember,
  type ProjectRole,
  type User,
  type WorkspaceState
} from "@aigc/domain";
import type { AuthScopeDbSnapshot } from "./db-repository";

export const AUTH_SCOPE_WRITE_PERMISSION_MATRIX = {
  createUser: "canManageMembers",
  createProject: "canManageProjects",
  updateProject: "canManageProjects",
  archiveProject: "canManageProjects",
  saveMemberRoles: "canManageMembers",
  updateMemberPermissions: "canManageMembers",
  assignEpisodes: "canAssignEpisodes"
} as const satisfies Record<string, PermissionKey>;

const projectRoles = ["owner", "coordinator", "head_writer", "writer", "creator"] as const satisfies ProjectRole[];
const permissionKeys = [
  "canManageProjects",
  "canManageMembers",
  "canAssignEpisodes",
  "canViewProjectOverview",
  "canViewAllEpisodes",
  "canSubmitWriting",
  "canReviewAssets",
  "canViewAssignedEpisodes"
] as const satisfies PermissionKey[];
const assignmentResponsibilities = ["writer", "lead_creator", "creator", "reviewer", "support"] as const satisfies Array<
  EpisodeAssignment["responsibility"]
>;
const avatarTones = ["ink", "violet", "amber", "teal", "rose"] as const;

export type AuthScopeWriteErrorCode =
  | "auth_scope_actor_not_found"
  | "auth_scope_permission_denied"
  | "auth_scope_user_name_required"
  | "auth_scope_user_name_conflict"
  | "auth_scope_user_not_found"
  | "auth_scope_project_not_found"
  | "auth_scope_project_name_required"
  | "auth_scope_project_code_required"
  | "auth_scope_project_code_conflict"
  | "auth_scope_episode_count_invalid"
  | "auth_scope_member_roles_required"
  | "auth_scope_member_role_invalid"
  | "auth_scope_target_user_not_project_member"
  | "auth_scope_last_owner_required"
  | "auth_scope_permission_key_invalid"
  | "auth_scope_episode_range_invalid"
  | "auth_scope_episode_range_not_found"
  | "auth_scope_assignment_responsibility_invalid";

export class AuthScopeWriteError extends Error {
  readonly code: AuthScopeWriteErrorCode;

  constructor(code: AuthScopeWriteErrorCode) {
    super(code);
    this.name = "AuthScopeWriteError";
    this.code = code;
  }
}

export interface AuthScopeWriteActor {
  userId: string;
}

export interface AuthScopeCreateUserInput {
  name: string;
  defaultRole: ProjectRole;
  avatarTone?: string;
}

export interface AuthScopeCreateProjectInput {
  name: string;
  code?: string;
  episodeCount: number;
}

export interface AuthScopeUpdateProjectInput {
  projectId: string;
  name?: string;
  code?: string;
}

export interface AuthScopeMemberRolesInput {
  projectId: string;
  userId: string;
  roles: ProjectRole[];
}

export interface AuthScopeMemberPermissionsInput {
  projectId: string;
  userId: string;
  permissions: PermissionKey[];
}

export interface AuthScopeAssignmentInput {
  projectId: string;
  userId: string;
  episodeFrom: number;
  episodeTo: number;
  responsibility: EpisodeAssignment["responsibility"];
}

export interface AuthScopeWriteRepository {
  createUser(user: User): Promise<void>;
  createProjectWithEpisodes(project: Project, episodes: Episode[]): Promise<void>;
  updateProject(project: Project): Promise<void>;
  replaceProjectMemberRoles(projectId: string, userId: string, members: ProjectMember[]): Promise<void>;
  replaceProjectMemberPermissions(
    projectId: string,
    userId: string,
    permissions: AuthScopeMemberPermission[]
  ): Promise<void>;
  replaceEpisodeAssignments(
    projectId: string,
    userId: string,
    episodeIds: string[],
    assignments: EpisodeAssignment[]
  ): Promise<void>;
}

export type AuthScopeMemberPermission = AuthScopeDbSnapshot["memberPermissions"][number];

export interface AuthScopeWriteIdFactory {
  user(input: { name: string }): string;
  project(input: { code: string }): string;
  member(input: { projectId: string; userId: string; role: ProjectRole }): string;
  permission(input: { projectId: string; userId: string; permission: PermissionKey }): string;
  assignment(input: { episodeId: string; userId: string }): string;
}

export interface AuthScopeWriteServiceOptions {
  readSnapshot: () => Promise<AuthScopeDbSnapshot>;
  repository: AuthScopeWriteRepository;
  now?: () => string;
  idFactory?: AuthScopeWriteIdFactory;
}

export function createAuthScopeWriteService(options: AuthScopeWriteServiceOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  const idFactory = options.idFactory ?? defaultAuthScopeWriteIdFactory;

  return {
    async createUser(actor: AuthScopeWriteActor, input: AuthScopeCreateUserInput) {
      const snapshot = await options.readSnapshot();
      assertGlobalPermission(snapshot, actor.userId, AUTH_SCOPE_WRITE_PERMISSION_MATRIX.createUser);

      const name = normalizeRequiredText(input.name, "auth_scope_user_name_required");
      assertRole(input.defaultRole);
      assertCanCreateDefaultRole(snapshot, actor.userId, input.defaultRole);

      if (snapshot.users.some((user) => user.name.toLowerCase() === name.toLowerCase())) {
        throw new AuthScopeWriteError("auth_scope_user_name_conflict");
      }

      const user: User = {
        id: idFactory.user({ name }),
        name,
        defaultRole: input.defaultRole,
        avatarTone: normalizeOptionalText(input.avatarTone) ?? avatarTones[snapshot.users.length % avatarTones.length]
      };

      await options.repository.createUser(user);
      return { user };
    },

    async createProject(actor: AuthScopeWriteActor, input: AuthScopeCreateProjectInput) {
      const snapshot = await options.readSnapshot();
      assertGlobalPermission(snapshot, actor.userId, AUTH_SCOPE_WRITE_PERMISSION_MATRIX.createProject);

      const name = normalizeRequiredText(input.name, "auth_scope_project_name_required");
      const code = normalizeProjectCode(input.code ?? name);
      assertEpisodeCount(input.episodeCount);
      assertProjectCodeAvailable(snapshot, code);

      const createdAt = now();
      const projectId = idFactory.project({ code });
      const project: Project = {
        id: projectId,
        name,
        code,
        episodeCount: input.episodeCount,
        status: "active",
        createdAt
      };
      const projectEpisodes = Array.from({ length: input.episodeCount }, (_, index) => {
        const episodeNo = index + 1;

        return {
          id: `${projectId}-episode-${episodeNo}`,
          projectId,
          episodeNo,
          title: `Episode ${episodeNo}`,
          productionStatus: "not_started",
          hasUnreadKeyChange: false,
          openIssueCount: 0,
          assetTodoCount: 0
        } satisfies Episode;
      });

      await options.repository.createProjectWithEpisodes(project, projectEpisodes);
      return { project, episodes: projectEpisodes };
    },

    async updateProject(actor: AuthScopeWriteActor, input: AuthScopeUpdateProjectInput) {
      const snapshot = await options.readSnapshot();
      const project = requireProject(snapshot, input.projectId);
      assertProjectPermission(snapshot, actor.userId, project.id, AUTH_SCOPE_WRITE_PERMISSION_MATRIX.updateProject);

      const nextName = input.name === undefined ? project.name : normalizeRequiredText(input.name, "auth_scope_project_name_required");
      const nextCode = input.code === undefined ? project.code : normalizeProjectCode(input.code);

      assertProjectCodeAvailable(snapshot, nextCode, project.id);

      const nextProject: Project = {
        ...project,
        name: nextName,
        code: nextCode
      };

      await options.repository.updateProject(nextProject);
      return { project: nextProject };
    },

    async archiveProject(actor: AuthScopeWriteActor, projectId: string) {
      const snapshot = await options.readSnapshot();
      const project = requireProject(snapshot, projectId);
      assertProjectPermission(snapshot, actor.userId, project.id, AUTH_SCOPE_WRITE_PERMISSION_MATRIX.archiveProject);

      const nextProject: Project = {
        ...project,
        status: "archived"
      };

      await options.repository.updateProject(nextProject);
      return { project: nextProject };
    },

    async saveMemberRoles(actor: AuthScopeWriteActor, input: AuthScopeMemberRolesInput) {
      const snapshot = await options.readSnapshot();
      requireProject(snapshot, input.projectId);
      requireUser(snapshot, input.userId);
      assertProjectPermission(snapshot, actor.userId, input.projectId, AUTH_SCOPE_WRITE_PERMISSION_MATRIX.saveMemberRoles);

      const roles = normalizeRoles(input.roles);
      const existingMembers = snapshot.members.filter(
        (member) => member.projectId === input.projectId && member.userId === input.userId
      );
      const createdAt = now();
      const members = roles.map((role) => {
        const existing = existingMembers.find((member) => member.role === role);

        return {
          id: existing?.id ?? idFactory.member({ projectId: input.projectId, userId: input.userId, role }),
          projectId: input.projectId,
          userId: input.userId,
          role,
          createdAt: existing?.createdAt ?? createdAt
        } satisfies ProjectMember;
      });

      assertProjectKeepsOwner(snapshot, input.projectId, input.userId, members);

      await options.repository.replaceProjectMemberRoles(input.projectId, input.userId, members);
      return { members };
    },

    async updateMemberPermissions(actor: AuthScopeWriteActor, input: AuthScopeMemberPermissionsInput) {
      const snapshot = await options.readSnapshot();
      requireProject(snapshot, input.projectId);
      requireUser(snapshot, input.userId);
      assertProjectPermission(snapshot, actor.userId, input.projectId, AUTH_SCOPE_WRITE_PERMISSION_MATRIX.updateMemberPermissions);
      assertProjectMember(snapshot, input.projectId, input.userId);

      const permissions = normalizePermissions(input.permissions);
      const existingPermissions = snapshot.memberPermissions.filter(
        (permission) => permission.projectId === input.projectId && permission.userId === input.userId
      );
      const grantedAt = now();
      const memberPermissions = permissions.map((permission) => {
        const existing = existingPermissions.find((item) => item.permission === permission);

        return {
          id: existing?.id ?? idFactory.permission({ projectId: input.projectId, userId: input.userId, permission }),
          projectId: input.projectId,
          userId: input.userId,
          permission,
          grantedAt: existing?.grantedAt ?? grantedAt
        } satisfies AuthScopeMemberPermission;
      });

      await options.repository.replaceProjectMemberPermissions(input.projectId, input.userId, memberPermissions);
      return { memberPermissions };
    },

    async assignEpisodes(actor: AuthScopeWriteActor, input: AuthScopeAssignmentInput) {
      const snapshot = await options.readSnapshot();
      requireProject(snapshot, input.projectId);
      requireUser(snapshot, input.userId);
      assertProjectPermission(snapshot, actor.userId, input.projectId, AUTH_SCOPE_WRITE_PERMISSION_MATRIX.assignEpisodes);
      assertProjectMember(snapshot, input.projectId, input.userId);
      assertAssignmentResponsibility(input.responsibility);

      const projectEpisodes = requireEpisodeRange(snapshot, input.projectId, input.episodeFrom, input.episodeTo);
      const createdAt = now();
      const assignments = projectEpisodes.map((episode) => {
        const existing = snapshot.assignments.find(
          (assignment) => assignment.episodeId === episode.id && assignment.userId === input.userId
        );

        return {
          id: existing?.id ?? idFactory.assignment({ episodeId: episode.id, userId: input.userId }),
          episodeId: episode.id,
          userId: input.userId,
          responsibility: input.responsibility,
          createdAt: existing?.createdAt ?? createdAt
        } satisfies EpisodeAssignment;
      });
      const episodeIds = projectEpisodes.map((episode) => episode.id);

      await options.repository.replaceEpisodeAssignments(input.projectId, input.userId, episodeIds, assignments);
      return { assignments, episodeIds };
    }
  };
}

export const defaultAuthScopeWriteIdFactory: AuthScopeWriteIdFactory = {
  user: ({ name }) => createId("user", name),
  project: ({ code }) => createId("project", code),
  member: ({ projectId, userId, role }) => createId("member", `${projectId}-${userId}-${role}`),
  permission: ({ projectId, userId, permission }) => createId("permission", `${projectId}-${userId}-${permission}`),
  assignment: ({ episodeId, userId }) => createId("assign", `${episodeId}-${userId}`)
};

function assertGlobalPermission(snapshot: AuthScopeDbSnapshot, actorUserId: string, permission: PermissionKey) {
  const actor = requireUser(snapshot, actorUserId, "auth_scope_actor_not_found");

  if (actor.defaultRole === "owner") {
    return;
  }

  if (snapshot.projects.some((project) => hasProjectPermission(snapshot, actorUserId, project.id, permission))) {
    return;
  }

  throw new AuthScopeWriteError("auth_scope_permission_denied");
}

function assertProjectPermission(
  snapshot: AuthScopeDbSnapshot,
  actorUserId: string,
  projectId: string,
  permission: PermissionKey
) {
  requireUser(snapshot, actorUserId, "auth_scope_actor_not_found");

  if (!hasProjectPermission(snapshot, actorUserId, projectId, permission)) {
    throw new AuthScopeWriteError("auth_scope_permission_denied");
  }
}

function assertCanCreateDefaultRole(snapshot: AuthScopeDbSnapshot, actorUserId: string, defaultRole: ProjectRole) {
  if (defaultRole !== "owner") {
    return;
  }

  if (requireUser(snapshot, actorUserId, "auth_scope_actor_not_found").defaultRole !== "owner") {
    throw new AuthScopeWriteError("auth_scope_permission_denied");
  }
}

function hasProjectPermission(
  snapshot: AuthScopeDbSnapshot,
  actorUserId: string,
  projectId: string,
  permission: PermissionKey
) {
  const actor = requireUser(snapshot, actorUserId, "auth_scope_actor_not_found");

  if (actor.defaultRole === "owner") {
    return true;
  }

  const isProjectMember = snapshot.members.some((member) => member.projectId === projectId && member.userId === actorUserId);

  if (!isProjectMember) {
    return false;
  }

  return selectPermissionKeys(toWorkspaceState(snapshot), actorUserId, projectId).includes(permission);
}

function requireUser(
  snapshot: AuthScopeDbSnapshot,
  userId: string,
  code: AuthScopeWriteErrorCode = "auth_scope_user_not_found"
) {
  const user = snapshot.users.find((item) => item.id === userId);

  if (!user) {
    throw new AuthScopeWriteError(code);
  }

  return user;
}

function requireProject(snapshot: AuthScopeDbSnapshot, projectId: string) {
  const project = snapshot.projects.find((item) => item.id === projectId);

  if (!project) {
    throw new AuthScopeWriteError("auth_scope_project_not_found");
  }

  return project;
}

function assertProjectMember(snapshot: AuthScopeDbSnapshot, projectId: string, userId: string) {
  if (!snapshot.members.some((member) => member.projectId === projectId && member.userId === userId)) {
    throw new AuthScopeWriteError("auth_scope_target_user_not_project_member");
  }
}

function assertProjectKeepsOwner(
  snapshot: AuthScopeDbSnapshot,
  projectId: string,
  replacedUserId: string,
  replacementMembers: ProjectMember[]
) {
  const nextMembers = [
    ...snapshot.members.filter((member) => !(member.projectId === projectId && member.userId === replacedUserId)),
    ...replacementMembers
  ];

  if (!nextMembers.some((member) => member.projectId === projectId && member.role === "owner")) {
    throw new AuthScopeWriteError("auth_scope_last_owner_required");
  }
}

function requireEpisodeRange(
  snapshot: AuthScopeDbSnapshot,
  projectId: string,
  episodeFrom: number,
  episodeTo: number
) {
  if (!Number.isInteger(episodeFrom) || !Number.isInteger(episodeTo) || episodeFrom < 1 || episodeTo < episodeFrom) {
    throw new AuthScopeWriteError("auth_scope_episode_range_invalid");
  }

  const range = Array.from({ length: episodeTo - episodeFrom + 1 }, (_, index) => episodeFrom + index);
  const episodes = range.map((episodeNo) =>
    snapshot.episodes.find((episode) => episode.projectId === projectId && episode.episodeNo === episodeNo)
  );

  if (episodes.some((episode) => !episode)) {
    throw new AuthScopeWriteError("auth_scope_episode_range_not_found");
  }

  return episodes as Episode[];
}

function normalizeRoles(roles: ProjectRole[]) {
  const normalized = unique(roles);

  if (normalized.length === 0) {
    throw new AuthScopeWriteError("auth_scope_member_roles_required");
  }

  for (const role of normalized) {
    assertRole(role);
  }

  return normalized;
}

function normalizePermissions(permissions: PermissionKey[]) {
  const normalized = unique(permissions);

  for (const permission of normalized) {
    if (!permissionKeys.includes(permission)) {
      throw new AuthScopeWriteError("auth_scope_permission_key_invalid");
    }
  }

  return normalized;
}

function assertRole(role: ProjectRole) {
  if (!projectRoles.includes(role)) {
    throw new AuthScopeWriteError("auth_scope_member_role_invalid");
  }
}

function assertAssignmentResponsibility(responsibility: EpisodeAssignment["responsibility"]) {
  if (!assignmentResponsibilities.includes(responsibility)) {
    throw new AuthScopeWriteError("auth_scope_assignment_responsibility_invalid");
  }
}

function assertEpisodeCount(episodeCount: number) {
  if (!Number.isInteger(episodeCount) || episodeCount < 1 || episodeCount > 200) {
    throw new AuthScopeWriteError("auth_scope_episode_count_invalid");
  }
}

function assertProjectCodeAvailable(snapshot: AuthScopeDbSnapshot, code: string, projectId?: string) {
  if (snapshot.projects.some((project) => project.id !== projectId && project.code === code)) {
    throw new AuthScopeWriteError("auth_scope_project_code_conflict");
  }
}

function normalizeRequiredText(value: string, code: AuthScopeWriteErrorCode) {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new AuthScopeWriteError(code);
  }

  return normalized;
}

function normalizeOptionalText(value: string | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

function normalizeProjectCode(value: string) {
  const code = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);

  if (!code) {
    throw new AuthScopeWriteError("auth_scope_project_code_required");
  }

  return code;
}

function createId(prefix: string, value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const suffix = randomUUID().split("-")[0];

  return `${prefix}-${slug || "item"}-${suffix}`;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function toWorkspaceState(snapshot: AuthScopeDbSnapshot): WorkspaceState {
  return {
    currentUserId: null,
    ...snapshot,
    deliveryPackages: [],
    deliveryPackageEpisodes: [],
    episodeRevisions: [],
    episodeCurrents: [],
    notifications: []
  };
}
