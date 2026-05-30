import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archiveAuthScopeProject,
  assignAuthScopeEpisodes,
  createAuthScopeProject,
  createAuthScopeUser,
  mutateAuthScopeAdmin,
  saveAuthScopeMemberRoles,
  updateAuthScopeMemberPermissions,
  updateAuthScopeProject
} from "./auth-scope-admin-api";

describe("auth scope admin API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts create_user with same-origin credentials", async () => {
    const fetchMock = mockJsonResponse({
      ok: true,
      user: {
        id: "user-new",
        name: "New User",
        defaultRole: "writer",
        avatarTone: "teal"
      }
    });

    await expect(createAuthScopeUser({ name: "New User", defaultRole: "writer" })).resolves.toMatchObject({
      ok: true,
      user: {
        id: "user-new"
      }
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth-scope/admin", {
      body: JSON.stringify({
        action: "create_user",
        name: "New User",
        defaultRole: "writer"
      }),
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
  });

  it("wraps every supported admin action", async () => {
    const fetchMock = mockJsonResponse({ ok: true, project: { id: "project-1" }, episodes: [] });

    await createAuthScopeProject({ name: "Project", code: "PRJ", episodeCount: 2 });
    await updateAuthScopeProject({ projectId: "project-1", name: "Renamed" });
    await archiveAuthScopeProject("project-1");
    await saveAuthScopeMemberRoles({ projectId: "project-1", userId: "user-1", roles: ["writer", "creator"] });
    await updateAuthScopeMemberPermissions({
      projectId: "project-1",
      userId: "user-1",
      permissions: ["canSubmitWriting"]
    });
    await assignAuthScopeEpisodes({
      projectId: "project-1",
      userId: "user-1",
      episodeFrom: 1,
      episodeTo: 2,
      responsibility: "writer"
    });

    const requestBodies = fetchMock.mock.calls.map((call) => {
      const [, init] = call as unknown as [string, RequestInit];
      return JSON.parse(init.body as string) as unknown;
    });

    expect(requestBodies).toEqual([
      {
        action: "create_project",
        name: "Project",
        code: "PRJ",
        episodeCount: 2
      },
      {
        action: "update_project",
        projectId: "project-1",
        name: "Renamed"
      },
      {
        action: "archive_project",
        projectId: "project-1"
      },
      {
        action: "save_member_roles",
        projectId: "project-1",
        userId: "user-1",
        roles: ["writer", "creator"]
      },
      {
        action: "update_member_permissions",
        projectId: "project-1",
        userId: "user-1",
        permissions: ["canSubmitWriting"]
      },
      {
        action: "assign_episodes",
        projectId: "project-1",
        userId: "user-1",
        episodeFrom: 1,
        episodeTo: 2,
        responsibility: "writer"
      }
    ]);
  });

  it("throws stable route error codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            ok: false,
            error: "auth_scope_permission_denied"
          },
          { status: 403 }
        )
      )
    );

    await expect(mutateAuthScopeAdmin({ action: "archive_project", projectId: "project-1" })).rejects.toThrow(
      "auth_scope_permission_denied"
    );
  });

  it("uses a stable fallback when an error response is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 500 }))
    );

    await expect(mutateAuthScopeAdmin({ action: "archive_project", projectId: "project-1" })).rejects.toThrow(
      "auth_scope_admin_request_failed"
    );
  });
});

function mockJsonResponse(payload: unknown) {
  const fetchMock = vi.fn(async () => Response.json(payload));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
