import type { EpisodeAssignment, PermissionKey, ProjectRole } from "@aigc/domain";
import { NextResponse } from "next/server";
import { requireSameOriginMutatingRequest } from "../../request-origin";
import { requireWorkspaceRequestActor } from "../../workspace-actor";
import { readDbAuthScopeSnapshot } from "../db-repository";
import { createDbAuthScopeWriteRepository } from "../db-write-repository";
import {
  AuthScopeWriteError,
  createAuthScopeWriteService,
  type AuthScopeAssignmentInput,
  type AuthScopeCreateProjectInput,
  type AuthScopeCreateUserInput,
  type AuthScopeMemberPermissionsInput,
  type AuthScopeMemberRolesInput,
  type AuthScopeUpdateProjectInput
} from "../write-service";

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

type AuthScopeAdminRequest =
  | ({ action: "create_user" } & AuthScopeCreateUserInput)
  | ({ action: "create_project" } & AuthScopeCreateProjectInput)
  | ({ action: "update_project" } & AuthScopeUpdateProjectInput)
  | { action: "archive_project"; projectId: string }
  | ({ action: "save_member_roles" } & AuthScopeMemberRolesInput)
  | ({ action: "update_member_permissions" } & AuthScopeMemberPermissionsInput)
  | ({ action: "assign_episodes" } & AuthScopeAssignmentInput);

export async function POST(request: Request) {
  let body: unknown;

  try {
    requireSameOriginMutatingRequest(request);
  } catch {
    return NextResponse.json({ ok: false, error: "request_origin_forbidden" }, { status: 403 });
  }

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_auth_scope_admin_request" }, { status: 400 });
  }

  const command = parseAuthScopeAdminRequest(body);

  if (!command) {
    return NextResponse.json({ ok: false, error: "invalid_auth_scope_admin_request" }, { status: 400 });
  }

  try {
    const actor = await requireWorkspaceRequestActor(request, "auth_scope_unauthenticated");
    const service = createAuthScopeWriteService({
      readSnapshot: readDbAuthScopeSnapshot,
      repository: createDbAuthScopeWriteRepository()
    });
    const result = await runAuthScopeAdminCommand(service, actor, command);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return authScopeAdminErrorResponse(error);
  }
}

function parseAuthScopeAdminRequest(body: unknown): AuthScopeAdminRequest | null {
  if (!isRecord(body)) {
    return null;
  }

  switch (body.action) {
    case "create_user": {
      const name = readString(body.name);
      const defaultRole = readProjectRole(body.defaultRole);

      if (!name || !defaultRole) {
        return null;
      }

      return {
        action: body.action,
        name,
        defaultRole,
        avatarTone: readOptionalString(body.avatarTone)
      };
    }
    case "create_project": {
      const name = readString(body.name);

      if (!name || !isPositiveInteger(body.episodeCount)) {
        return null;
      }

      return {
        action: body.action,
        name,
        code: readOptionalString(body.code),
        episodeCount: body.episodeCount
      };
    }
    case "update_project": {
      const projectId = readString(body.projectId);

      if (!projectId) {
        return null;
      }

      return {
        action: body.action,
        projectId,
        name: readOptionalString(body.name),
        code: readOptionalString(body.code)
      };
    }
    case "archive_project": {
      const projectId = readString(body.projectId);

      if (!projectId) {
        return null;
      }

      return {
        action: body.action,
        projectId
      };
    }
    case "save_member_roles": {
      const projectId = readString(body.projectId);
      const userId = readString(body.userId);
      const roles = readProjectRoles(body.roles);

      if (!projectId || !userId || roles.length === 0) {
        return null;
      }

      return {
        action: body.action,
        projectId,
        userId,
        roles
      };
    }
    case "update_member_permissions": {
      const projectId = readString(body.projectId);
      const userId = readString(body.userId);
      const permissions = readPermissionKeys(body.permissions);

      if (!projectId || !userId || !permissions) {
        return null;
      }

      return {
        action: body.action,
        projectId,
        userId,
        permissions
      };
    }
    case "assign_episodes": {
      const projectId = readString(body.projectId);
      const userId = readString(body.userId);
      const responsibility = readAssignmentResponsibility(body.responsibility);

      if (!projectId || !userId || !isPositiveInteger(body.episodeFrom) || !isPositiveInteger(body.episodeTo) || !responsibility) {
        return null;
      }

      return {
        action: body.action,
        projectId,
        userId,
        episodeFrom: body.episodeFrom,
        episodeTo: body.episodeTo,
        responsibility
      };
    }
    default:
      return null;
  }
}

async function runAuthScopeAdminCommand(
  service: ReturnType<typeof createAuthScopeWriteService>,
  actor: { userId: string },
  command: AuthScopeAdminRequest
) {
  switch (command.action) {
    case "create_user":
      return service.createUser(actor, command);
    case "create_project":
      return service.createProject(actor, command);
    case "update_project":
      return service.updateProject(actor, command);
    case "archive_project":
      return service.archiveProject(actor, command.projectId);
    case "save_member_roles":
      return service.saveMemberRoles(actor, command);
    case "update_member_permissions":
      return service.updateMemberPermissions(actor, command);
    case "assign_episodes":
      return service.assignEpisodes(actor, command);
  }
}

function authScopeAdminErrorResponse(error: unknown) {
  const code = authScopeAdminErrorCode(error);
  return NextResponse.json({ ok: false, error: code }, { status: authScopeAdminStatus(code) });
}

function authScopeAdminErrorCode(error: unknown) {
  if (error instanceof AuthScopeWriteError) {
    return error.code;
  }

  if (error instanceof Error) {
    switch (error.message) {
      case "auth_scope_unauthenticated":
        return error.message;
    }
  }

  return "auth_scope_admin_request_failed";
}

function authScopeAdminStatus(code: string) {
  switch (code) {
    case "auth_scope_unauthenticated":
      return 401;
    case "auth_scope_permission_denied":
      return 403;
    case "auth_scope_actor_not_found":
    case "auth_scope_user_not_found":
    case "auth_scope_project_not_found":
    case "auth_scope_episode_range_not_found":
      return 404;
    case "auth_scope_last_owner_required":
    case "auth_scope_user_name_conflict":
    case "auth_scope_project_code_conflict":
      return 409;
    case "auth_scope_admin_request_failed":
      return 500;
    default:
      return code.startsWith("auth_scope_") ? 400 : 500;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown) {
  const text = readString(value);
  return text || undefined;
}

function readProjectRole(value: unknown): ProjectRole | null {
  return typeof value === "string" && projectRoles.includes(value as ProjectRole) ? (value as ProjectRole) : null;
}

function readProjectRoles(value: unknown): ProjectRole[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const roles = value.map(readProjectRole);

  return roles.every(Boolean) ? (roles as ProjectRole[]) : [];
}

function readPermissionKeys(value: unknown): PermissionKey[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const permissions = value.map((item) =>
    typeof item === "string" && permissionKeys.includes(item as PermissionKey) ? (item as PermissionKey) : null
  );

  return permissions.every((permission) => permission !== null) ? (permissions as PermissionKey[]) : null;
}

function readAssignmentResponsibility(value: unknown): EpisodeAssignment["responsibility"] | null {
  return typeof value === "string" && assignmentResponsibilities.includes(value as EpisodeAssignment["responsibility"])
    ? (value as EpisodeAssignment["responsibility"])
    : null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
