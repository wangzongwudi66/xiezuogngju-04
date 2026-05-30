import type { Episode, EpisodeAssignment, PermissionKey, Project, ProjectMember, ProjectMemberPermission, ProjectRole, User } from "@aigc/domain";

export type AuthScopeAdminCommand =
  | {
      action: "create_user";
      avatarTone?: string;
      defaultRole: ProjectRole;
      name: string;
    }
  | {
      action: "create_project";
      code?: string;
      episodeCount: number;
      name: string;
    }
  | {
      action: "update_project";
      code?: string;
      name?: string;
      projectId: string;
    }
  | {
      action: "archive_project";
      projectId: string;
    }
  | {
      action: "save_member_roles";
      projectId: string;
      roles: ProjectRole[];
      userId: string;
    }
  | {
      action: "update_member_permissions";
      permissions: PermissionKey[];
      projectId: string;
      userId: string;
    }
  | {
      action: "assign_episodes";
      episodeFrom: number;
      episodeTo: number;
      projectId: string;
      responsibility: EpisodeAssignment["responsibility"];
      userId: string;
    };

export type AuthScopeAdminResult =
  | {
      ok: true;
      user: User;
    }
  | {
      episodes: Episode[];
      ok: true;
      project: Project;
    }
  | {
      ok: true;
      project: Project;
    }
  | {
      members: ProjectMember[];
      ok: true;
    }
  | {
      memberPermissions: ProjectMemberPermission[];
      ok: true;
    }
  | {
      assignments: EpisodeAssignment[];
      episodeIds: string[];
      ok: true;
    };

export type CreateAuthScopeUserInput = Omit<Extract<AuthScopeAdminCommand, { action: "create_user" }>, "action">;
export type CreateAuthScopeProjectInput = Omit<Extract<AuthScopeAdminCommand, { action: "create_project" }>, "action">;
export type UpdateAuthScopeProjectInput = Omit<Extract<AuthScopeAdminCommand, { action: "update_project" }>, "action">;
export type SaveAuthScopeMemberRolesInput = Omit<Extract<AuthScopeAdminCommand, { action: "save_member_roles" }>, "action">;
export type UpdateAuthScopeMemberPermissionsInput = Omit<
  Extract<AuthScopeAdminCommand, { action: "update_member_permissions" }>,
  "action"
>;
export type AssignAuthScopeEpisodesInput = Omit<Extract<AuthScopeAdminCommand, { action: "assign_episodes" }>, "action">;

export async function mutateAuthScopeAdmin(command: AuthScopeAdminCommand): Promise<AuthScopeAdminResult> {
  const response = await fetch("/api/auth-scope/admin", {
    body: JSON.stringify(command),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await readAuthScopeAdminApiError(response, "auth_scope_admin_request_failed"));
  }

  return (await response.json()) as AuthScopeAdminResult;
}

export async function createAuthScopeUser(input: CreateAuthScopeUserInput) {
  return mutateAuthScopeAdmin({
    action: "create_user",
    ...input
  }) as Promise<Extract<AuthScopeAdminResult, { user: User }>>;
}

export async function createAuthScopeProject(input: CreateAuthScopeProjectInput) {
  return mutateAuthScopeAdmin({
    action: "create_project",
    ...input
  }) as Promise<Extract<AuthScopeAdminResult, { episodes: Episode[]; project: Project }>>;
}

export async function updateAuthScopeProject(input: UpdateAuthScopeProjectInput) {
  return mutateAuthScopeAdmin({
    action: "update_project",
    ...input
  }) as Promise<Extract<AuthScopeAdminResult, { project: Project }>>;
}

export async function archiveAuthScopeProject(projectId: string) {
  return mutateAuthScopeAdmin({
    action: "archive_project",
    projectId
  }) as Promise<Extract<AuthScopeAdminResult, { project: Project }>>;
}

export async function saveAuthScopeMemberRoles(input: SaveAuthScopeMemberRolesInput) {
  return mutateAuthScopeAdmin({
    action: "save_member_roles",
    ...input
  }) as Promise<Extract<AuthScopeAdminResult, { members: ProjectMember[] }>>;
}

export async function updateAuthScopeMemberPermissions(input: UpdateAuthScopeMemberPermissionsInput) {
  return mutateAuthScopeAdmin({
    action: "update_member_permissions",
    ...input
  }) as Promise<Extract<AuthScopeAdminResult, { memberPermissions: ProjectMemberPermission[] }>>;
}

export async function assignAuthScopeEpisodes(input: AssignAuthScopeEpisodesInput) {
  return mutateAuthScopeAdmin({
    action: "assign_episodes",
    ...input
  }) as Promise<Extract<AuthScopeAdminResult, { assignments: EpisodeAssignment[]; episodeIds: string[] }>>;
}

async function readAuthScopeAdminApiError(response: Response, fallback: string) {
  const payload = await readJsonSafely(response);

  if (payload && typeof payload === "object") {
    const error = (payload as Record<string, unknown>).error;

    if (typeof error === "string" && error.trim()) {
      return error;
    }
  }

  return fallback;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
