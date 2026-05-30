import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedWorkspace, type WorkspaceState } from "@aigc/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authScopeDbRepository from "../db-repository";
import { createDbAuthScopeWriteRepository } from "../db-write-repository";
import { createWorkspaceSessionCookieValue, WORKSPACE_SESSION_COOKIE_NAME } from "../../workspace-session/session-cookie";
import { POST } from "./route";

vi.mock("../db-write-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db-write-repository")>()),
  createDbAuthScopeWriteRepository: vi.fn()
}));

let storeDir = "";
let repository: ReturnType<typeof createMockRepository>;

describe("auth scope admin route", () => {
  beforeEach(async () => {
    storeDir = await mkdtemp(join(tmpdir(), "aigc-auth-scope-admin-route-"));
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
    process.env.AIGC_WORKSPACE_SESSION_SECRET = "auth-scope-admin-route-test-secret";
    delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
    delete process.env.DATABASE_URL;
    repository = createMockRepository();
    vi.mocked(createDbAuthScopeWriteRepository).mockReturnValue(repository);
    vi.spyOn(authScopeDbRepository, "readDbAuthScopeSnapshot").mockResolvedValue(buildSnapshot());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    delete process.env.AIGC_WORKSPACE_SESSION_SECRET;
    delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
    delete process.env.DATABASE_URL;
    await rm(storeDir, { force: true, recursive: true });
  });

  it("requires the signed server session actor", async () => {
    const response = await POST(jsonRequest({ action: "create_project", name: "No Session", episodeCount: 1 }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "auth_scope_unauthenticated" });
    expect(repository.createProjectWithEpisodes).not.toHaveBeenCalled();
  });

  it("rejects cross-origin admin mutations before resolving the session actor", async () => {
    const response = await POST(
      jsonRequest(
        {
          action: "create_project",
          name: "Cross Origin",
          episodeCount: 1
        },
        "user-owner",
        {
          origin: "http://evil.local"
        }
      )
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "request_origin_forbidden" });
    expect(repository.createProjectWithEpisodes).not.toHaveBeenCalled();
  });

  it("rejects cross-site admin mutations without relying on Origin", async () => {
    const response = await POST(
      jsonRequest(
        {
          action: "create_project",
          name: "Cross Site",
          episodeCount: 1
        },
        "user-owner",
        {
          "sec-fetch-site": "cross-site"
        }
      )
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "request_origin_forbidden" });
    expect(repository.createProjectWithEpisodes).not.toHaveBeenCalled();
  });

  it("creates projects with the cookie actor and ignores client actor fields", async () => {
    const response = await POST(
      jsonRequest(
        {
          action: "create_project",
          actorUserId: "user-writer",
          name: "  New Show  ",
          code: "new-show",
          episodeCount: 2
        },
        "user-owner"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      project: {
        name: "New Show",
        code: "NEWSHOW",
        episodeCount: 2
      },
      episodes: [
        {
          episodeNo: 1,
          projectId: body.project.id
        },
        {
          episodeNo: 2,
          projectId: body.project.id
        }
      ]
    });
    expect(repository.createProjectWithEpisodes).toHaveBeenCalledWith(body.project, body.episodes);
  });

  it("does not allow client actor fields to escalate a low-privilege cookie actor", async () => {
    const response = await POST(
      jsonRequest(
        {
          action: "create_project",
          actorUserId: "user-owner",
          name: "Escalation",
          code: "ESC",
          episodeCount: 1
        },
        "user-writer"
      )
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "auth_scope_permission_denied" });
    expect(repository.createProjectWithEpisodes).not.toHaveBeenCalled();
  });

  it("prevents project member managers from creating global owner users", async () => {
    vi.spyOn(authScopeDbRepository, "readDbAuthScopeSnapshot").mockResolvedValue(buildMemberManagerSnapshot());

    const ownerResponse = await POST(
      jsonRequest(
        {
          action: "create_user",
          name: "Escalated Owner",
          defaultRole: "owner"
        },
        "user-head-writer"
      )
    );
    const writerResponse = await POST(
      jsonRequest(
        {
          action: "create_user",
          name: "Managed Writer",
          defaultRole: "writer"
        },
        "user-head-writer"
      )
    );

    expect(ownerResponse.status).toBe(403);
    await expect(ownerResponse.json()).resolves.toEqual({ ok: false, error: "auth_scope_permission_denied" });
    expect(writerResponse.status).toBe(200);
    await expect(writerResponse.json()).resolves.toMatchObject({
      ok: true,
      user: {
        name: "Managed Writer",
        defaultRole: "writer"
      }
    });
  });

  it("rejects malformed permission payloads without clearing permissions", async () => {
    const response = await POST(
      jsonRequest(
        {
          action: "update_member_permissions",
          projectId: "project-jincheng",
          userId: "user-writer",
          permissions: ["canSubmitWriting", "not-a-permission"]
        },
        "user-owner"
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_auth_scope_admin_request" });
    expect(repository.replaceProjectMemberPermissions).not.toHaveBeenCalled();
  });

  it("allows explicit clearing of custom permissions", async () => {
    const response = await POST(
      jsonRequest(
        {
          action: "update_member_permissions",
          projectId: "project-jincheng",
          userId: "user-writer",
          permissions: []
        },
        "user-owner"
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, memberPermissions: [] });
    expect(repository.replaceProjectMemberPermissions).toHaveBeenCalledWith("project-jincheng", "user-writer", []);
  });

  it("does not expose internal DB/env configuration error codes", async () => {
    vi.spyOn(authScopeDbRepository, "readDbAuthScopeSnapshot").mockRejectedValue(
      new Error("asset_lock_record_database_url_required")
    );

    const response = await POST(
      jsonRequest(
        {
          action: "create_project",
          name: "Config Failure",
          code: "CFG",
          episodeCount: 1
        },
        "user-owner"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, error: "auth_scope_admin_request_failed" });
    expect(JSON.stringify(body)).not.toContain("asset_lock_record_database_url_required");
  });
});

function jsonRequest(body: unknown, userId?: string, extraHeaders: Record<string, string> = {}) {
  const headers = new Headers({
    "Content-Type": "application/json",
    ...extraHeaders
  });

  if (userId) {
    headers.set("Cookie", `${WORKSPACE_SESSION_COOKIE_NAME}=${createWorkspaceSessionCookieValue(userId)}`);
  }

  return new Request("http://localhost/api/auth-scope/admin", {
    body: JSON.stringify(body),
    headers,
    method: "POST"
  });
}

function createMockRepository() {
  return {
    createUser: vi.fn(async () => undefined),
    createProjectWithEpisodes: vi.fn(async () => undefined),
    updateProject: vi.fn(async () => undefined),
    replaceProjectMemberRoles: vi.fn(async () => undefined),
    replaceProjectMemberPermissions: vi.fn(async () => undefined),
    replaceEpisodeAssignments: vi.fn(async () => undefined)
  };
}

function buildSnapshot(): WorkspaceState {
  return {
    currentUserId: null,
    users: [
      {
        id: "user-owner",
        name: "Owner",
        defaultRole: "owner",
        avatarTone: "ink"
      },
      {
        id: "user-writer",
        name: "Writer",
        defaultRole: "writer",
        avatarTone: "violet"
      },
      {
        id: "user-head-writer",
        name: "Head Writer",
        defaultRole: "writer",
        avatarTone: "teal"
      }
    ],
    projects: [
      {
        id: "project-jincheng",
        name: "Jincheng",
        code: "JC",
        episodeCount: 2,
        status: "active",
        createdAt: "2026-05-01T00:00:00.000Z"
      }
    ],
    members: [
      {
        id: "member-owner",
        projectId: "project-jincheng",
        userId: "user-owner",
        role: "owner",
        createdAt: "2026-05-01T00:00:00.000Z"
      },
      {
        id: "member-writer",
        projectId: "project-jincheng",
        userId: "user-writer",
        role: "writer",
        createdAt: "2026-05-01T00:00:00.000Z"
      }
    ],
    memberPermissions: [],
    episodes: [
      {
        id: "episode-jc-1",
        projectId: "project-jincheng",
        episodeNo: 1,
        title: "Episode 1",
        productionStatus: "not_started",
        hasUnreadKeyChange: false,
        openIssueCount: 0,
        assetTodoCount: 0
      },
      {
        id: "episode-jc-2",
        projectId: "project-jincheng",
        episodeNo: 2,
        title: "Episode 2",
        productionStatus: "not_started",
        hasUnreadKeyChange: false,
        openIssueCount: 0,
        assetTodoCount: 0
      }
    ],
    assignments: [],
    deliveryPackages: [],
    deliveryPackageEpisodes: [],
    episodeRevisions: [],
    episodeCurrents: [],
    notifications: []
  };
}

function buildMemberManagerSnapshot(): WorkspaceState {
  const snapshot = buildSnapshot();

  return {
    ...snapshot,
    members: [
      ...snapshot.members,
      {
        id: "member-manager",
        projectId: "project-jincheng",
        userId: "user-head-writer",
        role: "writer",
        createdAt: "2026-05-01T00:00:00.000Z"
      }
    ],
    memberPermissions: [
      {
        id: "permission-manager-members",
        projectId: "project-jincheng",
        userId: "user-head-writer",
        permission: "canManageMembers",
        grantedAt: "2026-05-02T00:00:00.000Z"
      }
    ]
  };
}
