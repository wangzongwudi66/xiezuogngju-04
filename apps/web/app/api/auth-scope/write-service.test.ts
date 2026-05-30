import type { AuthScopeDbSnapshot } from "./db-repository";
import {
  AUTH_SCOPE_WRITE_PERMISSION_MATRIX,
  AuthScopeWriteError,
  createAuthScopeWriteService,
  type AuthScopeWriteIdFactory,
  type AuthScopeWriteRepository
} from "./write-service";
import { describe, expect, it, vi } from "vitest";

const fixedNow = "2026-05-31T00:00:00.000Z";

describe("auth scope write service contract", () => {
  it("declares the permission gate for every write action", () => {
    expect(AUTH_SCOPE_WRITE_PERMISSION_MATRIX).toEqual({
      createUser: "canManageMembers",
      createProject: "canManageProjects",
      updateProject: "canManageProjects",
      archiveProject: "canManageProjects",
      saveMemberRoles: "canManageMembers",
      updateMemberPermissions: "canManageMembers",
      assignEpisodes: "canAssignEpisodes"
    });
  });

  it("creates a project and episode skeletons behind the manage-projects gate", async () => {
    const repository = createMockRepository();
    const service = createService(buildSnapshot(), repository);

    const result = await service.createProject(
      { userId: "user-owner" },
      {
        name: "  New Show  ",
        code: " new-show ",
        episodeCount: 2
      }
    );

    expect(result.project).toMatchObject({
      id: "project-NEWSHOW",
      name: "New Show",
      code: "NEWSHOW",
      episodeCount: 2,
      status: "active",
      createdAt: fixedNow
    });
    expect(result.episodes).toEqual([
      {
        id: "project-NEWSHOW-episode-1",
        projectId: "project-NEWSHOW",
        episodeNo: 1,
        title: "Episode 1",
        productionStatus: "not_started",
        hasUnreadKeyChange: false,
        openIssueCount: 0,
        assetTodoCount: 0
      },
      {
        id: "project-NEWSHOW-episode-2",
        projectId: "project-NEWSHOW",
        episodeNo: 2,
        title: "Episode 2",
        productionStatus: "not_started",
        hasUnreadKeyChange: false,
        openIssueCount: 0,
        assetTodoCount: 0
      }
    ]);
    expect(repository.createProjectWithEpisodes).toHaveBeenCalledWith(result.project, result.episodes);
  });

  it("denies project writes when the actor lacks project management permission", async () => {
    const repository = createMockRepository();
    const service = createService(buildSnapshot(), repository);

    await expect(
      service.createProject({ userId: "user-writer" }, { name: "Denied", code: "DENIED", episodeCount: 1 })
    ).rejects.toMatchObject({
      code: "auth_scope_permission_denied"
    });
    expect(repository.createProjectWithEpisodes).not.toHaveBeenCalled();
  });

  it("replaces member roles transaction input while preserving existing role ids and the last owner", async () => {
    const repository = createMockRepository();
    const service = createService(buildSnapshot(), repository);

    const result = await service.saveMemberRoles(
      { userId: "user-owner" },
      {
        projectId: "project-jincheng",
        userId: "user-writer",
        roles: ["writer", "creator", "writer"]
      }
    );

    expect(result.members).toEqual([
      {
        id: "member-writer",
        projectId: "project-jincheng",
        userId: "user-writer",
        role: "writer",
        createdAt: "2026-05-01T00:00:00.000Z"
      },
      {
        id: "member-project-jincheng-user-writer-creator",
        projectId: "project-jincheng",
        userId: "user-writer",
        role: "creator",
        createdAt: fixedNow
      }
    ]);
    expect(repository.replaceProjectMemberRoles).toHaveBeenCalledWith(
      "project-jincheng",
      "user-writer",
      result.members
    );
  });

  it("rejects removing the last owner from a project", async () => {
    const repository = createMockRepository();
    const service = createService(buildSnapshot(), repository);

    await expect(
      service.saveMemberRoles(
        { userId: "user-owner" },
        {
          projectId: "project-jincheng",
          userId: "user-owner",
          roles: ["coordinator"]
        }
      )
    ).rejects.toMatchObject({
      code: "auth_scope_last_owner_required"
    });
    expect(repository.replaceProjectMemberRoles).not.toHaveBeenCalled();
  });

  it("replaces custom permissions only for existing project members", async () => {
    const repository = createMockRepository();
    const service = createService(buildSnapshot(), repository);

    const result = await service.updateMemberPermissions(
      { userId: "user-owner" },
      {
        projectId: "project-jincheng",
        userId: "user-writer",
        permissions: ["canSubmitWriting", "canReviewAssets", "canSubmitWriting"]
      }
    );

    expect(result.memberPermissions).toEqual([
      {
        id: "permission-existing-submit",
        projectId: "project-jincheng",
        userId: "user-writer",
        permission: "canSubmitWriting",
        grantedAt: "2026-05-02T00:00:00.000Z"
      },
      {
        id: "permission-project-jincheng-user-writer-canReviewAssets",
        projectId: "project-jincheng",
        userId: "user-writer",
        permission: "canReviewAssets",
        grantedAt: fixedNow
      }
    ]);
    expect(repository.replaceProjectMemberPermissions).toHaveBeenCalledWith(
      "project-jincheng",
      "user-writer",
      result.memberPermissions
    );
  });

  it("rejects custom permissions for non-members", async () => {
    const repository = createMockRepository();
    const service = createService(buildSnapshot(), repository);

    await expect(
      service.updateMemberPermissions(
        { userId: "user-owner" },
        {
          projectId: "project-jincheng",
          userId: "user-outsider",
          permissions: ["canSubmitWriting"]
        }
      )
    ).rejects.toMatchObject({
      code: "auth_scope_target_user_not_project_member"
    });
    expect(repository.replaceProjectMemberPermissions).not.toHaveBeenCalled();
  });

  it("replaces episode assignments for a validated range", async () => {
    const repository = createMockRepository();
    const service = createService(buildSnapshot(), repository);

    const result = await service.assignEpisodes(
      { userId: "user-owner" },
      {
        projectId: "project-jincheng",
        userId: "user-writer",
        episodeFrom: 1,
        episodeTo: 2,
        responsibility: "writer"
      }
    );

    expect(result.episodeIds).toEqual(["episode-jc-1", "episode-jc-2"]);
    expect(result.assignments).toEqual([
      {
        id: "assignment-existing",
        episodeId: "episode-jc-1",
        userId: "user-writer",
        responsibility: "writer",
        createdAt: "2026-05-03T00:00:00.000Z"
      },
      {
        id: "assign-episode-jc-2-user-writer",
        episodeId: "episode-jc-2",
        userId: "user-writer",
        responsibility: "writer",
        createdAt: fixedNow
      }
    ]);
    expect(repository.replaceEpisodeAssignments).toHaveBeenCalledWith(
      "project-jincheng",
      "user-writer",
      result.episodeIds,
      result.assignments
    );
  });

  it("uses stable error codes for invalid assignment ranges", async () => {
    const repository = createMockRepository();
    const service = createService(buildSnapshot(), repository);

    await expect(
      service.assignEpisodes(
        { userId: "user-owner" },
        {
          projectId: "project-jincheng",
          userId: "user-writer",
          episodeFrom: 2,
          episodeTo: 1,
          responsibility: "writer"
        }
      )
    ).rejects.toMatchObject({
      code: "auth_scope_episode_range_invalid"
    });

    await expect(
      service.assignEpisodes(
        { userId: "user-owner" },
        {
          projectId: "project-jincheng",
          userId: "user-writer",
          episodeFrom: 1,
          episodeTo: 3,
          responsibility: "writer"
        }
      )
    ).rejects.toMatchObject({
      code: "auth_scope_episode_range_not_found"
    });
    expect(repository.replaceEpisodeAssignments).not.toHaveBeenCalled();
  });

  it("rejects episode assignments for non-members", async () => {
    const repository = createMockRepository();
    const service = createService(buildSnapshot(), repository);

    await expect(
      service.assignEpisodes(
        { userId: "user-owner" },
        {
          projectId: "project-jincheng",
          userId: "user-outsider",
          episodeFrom: 1,
          episodeTo: 1,
          responsibility: "writer"
        }
      )
    ).rejects.toMatchObject({
      code: "auth_scope_target_user_not_project_member"
    });
    expect(repository.replaceEpisodeAssignments).not.toHaveBeenCalled();
  });

  it("creates users behind the member-management gate and rejects duplicate names", async () => {
    const repository = createMockRepository();
    const service = createService(buildSnapshot(), repository);

    await expect(
      service.createUser(
        { userId: "user-owner" },
        {
          name: "  New User  ",
          defaultRole: "writer"
        }
      )
    ).resolves.toEqual({
      user: {
        id: "user-New User",
        name: "New User",
        defaultRole: "writer",
        avatarTone: "teal"
      }
    });
    expect(repository.createUser).toHaveBeenCalledWith({
      id: "user-New User",
      name: "New User",
      defaultRole: "writer",
      avatarTone: "teal"
    });

    await expect(
      service.createUser(
        { userId: "user-owner" },
        {
          name: "owner",
          defaultRole: "writer"
        }
      )
    ).rejects.toMatchObject({
      code: "auth_scope_user_name_conflict"
    });
  });

  it("prevents project member managers from creating global owner users", async () => {
    const repository = createMockRepository();
    const service = createService(buildManagerSnapshot(), repository);

    await expect(
      service.createUser(
        { userId: "user-member-manager" },
        {
          name: "Escalated Owner",
          defaultRole: "owner"
        }
      )
    ).rejects.toMatchObject({
      code: "auth_scope_permission_denied"
    });
    expect(repository.createUser).not.toHaveBeenCalled();

    await expect(
      service.createUser(
        { userId: "user-member-manager" },
        {
          name: "Managed Writer",
          defaultRole: "writer"
        }
      )
    ).resolves.toMatchObject({
      user: {
        id: "user-Managed Writer",
        defaultRole: "writer"
      }
    });
  });

  it("can be matched by error class without inspecting raw messages", () => {
    const error = new AuthScopeWriteError("auth_scope_permission_denied");

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("auth_scope_permission_denied");
    expect(error.message).toBe("auth_scope_permission_denied");
  });
});

function createService(snapshot: AuthScopeDbSnapshot, repository: AuthScopeWriteRepository) {
  return createAuthScopeWriteService({
    readSnapshot: async () => snapshot,
    repository,
    now: () => fixedNow,
    idFactory: testIdFactory
  });
}

const testIdFactory: AuthScopeWriteIdFactory = {
  user: ({ name }) => `user-${name}`,
  project: ({ code }) => `project-${code}`,
  member: ({ projectId, userId, role }) => `member-${projectId}-${userId}-${role}`,
  permission: ({ projectId, userId, permission }) => `permission-${projectId}-${userId}-${permission}`,
  assignment: ({ episodeId, userId }) => `assign-${episodeId}-${userId}`
};

function createMockRepository(): AuthScopeWriteRepository {
  return {
    createUser: vi.fn(async () => undefined),
    createProjectWithEpisodes: vi.fn(async () => undefined),
    updateProject: vi.fn(async () => undefined),
    replaceProjectMemberRoles: vi.fn(async () => undefined),
    replaceProjectMemberPermissions: vi.fn(async () => undefined),
    replaceEpisodeAssignments: vi.fn(async () => undefined)
  };
}

function buildSnapshot(): AuthScopeDbSnapshot {
  return {
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
        id: "user-outsider",
        name: "Outsider",
        defaultRole: "writer",
        avatarTone: "amber"
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
    memberPermissions: [
      {
        id: "permission-existing-submit",
        projectId: "project-jincheng",
        userId: "user-writer",
        permission: "canSubmitWriting",
        grantedAt: "2026-05-02T00:00:00.000Z"
      }
    ],
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
    assignments: [
      {
        id: "assignment-existing",
        episodeId: "episode-jc-1",
        userId: "user-writer",
        responsibility: "creator",
        createdAt: "2026-05-03T00:00:00.000Z"
      }
    ]
  };
}

function buildManagerSnapshot(): AuthScopeDbSnapshot {
  return {
    ...buildSnapshot(),
    users: [
      ...buildSnapshot().users,
      {
        id: "user-member-manager",
        name: "Member Manager",
        defaultRole: "writer",
        avatarTone: "rose"
      }
    ],
    members: [
      ...buildSnapshot().members,
      {
        id: "member-manager",
        projectId: "project-jincheng",
        userId: "user-member-manager",
        role: "writer",
        createdAt: "2026-05-01T00:00:00.000Z"
      }
    ],
    memberPermissions: [
      ...buildSnapshot().memberPermissions,
      {
        id: "permission-manager-members",
        projectId: "project-jincheng",
        userId: "user-member-manager",
        permission: "canManageMembers",
        grantedAt: "2026-05-02T00:00:00.000Z"
      }
    ]
  };
}
