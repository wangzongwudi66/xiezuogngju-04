import { seedWorkspace } from "@aigc/domain";
import { describe, expect, it, vi } from "vitest";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { episodeAssignments, episodes, projectMemberPermissions, projectMembers, projects, users } from "../../../db/schema";
import {
  AUTH_SCOPE_SEED_STABLE_TIMESTAMP,
  AUTH_SCOPE_SEED_TABLE_ORDER,
  authScopeSeedContract,
  buildAuthScopeSeedContract,
  countAuthScopeSeedRows,
  mapAuthScopeSeedRows,
  seedAuthScopeContract,
  type AuthScopeSeedSource
} from "./seed-contract";

vi.mock("../../../db/runtime", () => ({
  getAssetLockDbRuntime: vi.fn()
}));

describe("auth scope deterministic seed contract", () => {
  it("declares the six auth/scope tables in foreign-key-safe deterministic order", () => {
    expect(authScopeSeedContract.tableOrder).toEqual([
      "users",
      "projects",
      "project_members",
      "project_member_permissions",
      "episodes",
      "episode_assignments"
    ]);
    expect(authScopeSeedContract.steps.map((step) => step.table)).toEqual(AUTH_SCOPE_SEED_TABLE_ORDER);
    expect(authScopeSeedContract.steps.map((step) => step.rows)).toEqual([
      authScopeSeedContract.rows.userRows,
      authScopeSeedContract.rows.projectRows,
      authScopeSeedContract.rows.memberRows,
      authScopeSeedContract.rows.memberPermissionRows,
      authScopeSeedContract.rows.episodeRows,
      authScopeSeedContract.rows.assignmentRows
    ]);
  });

  it("maps only seedWorkspace auth/scope arrays into DB insert rows", () => {
    const rows = mapAuthScopeSeedRows(seedWorkspace);

    expect(rows.userRows).toEqual(seedWorkspace.users);
    expect(rows.projectRows).toEqual(seedWorkspace.projects);
    expect(rows.memberRows).toEqual(seedWorkspace.members);
    expect(rows.memberPermissionRows).toEqual(seedWorkspace.memberPermissions);
    expect(rows.episodeRows).toEqual(seedWorkspace.episodes);
    expect(rows.assignmentRows).toEqual(seedWorkspace.assignments);

    expect("currentUserId" in rows).toBe(false);
    expect("deliveryPackages" in rows).toBe(false);
    expect("deliveryPackageEpisodes" in rows).toBe(false);
    expect("assetLockRecords" in rows).toBe(false);
    expect("assetAttachments" in rows).toBe(false);
    expect("notifications" in rows).toBe(false);
  });

  it("keeps stable ids, ordering, and timestamps from seedWorkspace", () => {
    const { rows } = authScopeSeedContract;

    expect(rows.userRows.map((row) => row.id)).toEqual(seedWorkspace.users.map((row) => row.id));
    expect(rows.projectRows.map((row) => row.id)).toEqual(seedWorkspace.projects.map((row) => row.id));
    expect(rows.memberRows.map((row) => row.id)).toEqual(seedWorkspace.members.map((row) => row.id));
    expect(rows.episodeRows.map((row) => row.id)).toEqual(seedWorkspace.episodes.map((row) => row.id));
    expect(rows.assignmentRows.map((row) => row.id)).toEqual(seedWorkspace.assignments.map((row) => row.id));

    expect(authScopeSeedContract.stableTimestamp).toBe(AUTH_SCOPE_SEED_STABLE_TIMESTAMP);
    expect(rows.projectRows.every((row) => row.createdAt === AUTH_SCOPE_SEED_STABLE_TIMESTAMP)).toBe(true);
    expect(rows.memberRows.every((row) => row.createdAt === AUTH_SCOPE_SEED_STABLE_TIMESTAMP)).toBe(true);
    expect(rows.assignmentRows.every((row) => row.createdAt === AUTH_SCOPE_SEED_STABLE_TIMESTAMP)).toBe(true);
  });

  it("counts all six seed row groups, including empty member permissions", () => {
    expect(countAuthScopeSeedRows(authScopeSeedContract.rows)).toEqual({
      users: seedWorkspace.users.length,
      projects: seedWorkspace.projects.length,
      project_members: seedWorkspace.members.length,
      project_member_permissions: seedWorkspace.memberPermissions.length,
      episodes: seedWorkspace.episodes.length,
      episode_assignments: seedWorkspace.assignments.length
    });
  });

  it("upserts seed rows by stable primary id in contract order", async () => {
    const contract = buildAuthScopeSeedContract(buildCompleteSource());
    const mockDb = createMockDb();
    vi.mocked(getAssetLockDbRuntime).mockReturnValue({
      db: mockDb.db,
      pool: {}
    } as unknown as ReturnType<typeof getAssetLockDbRuntime>);

    await expect(seedAuthScopeContract(contract)).resolves.toEqual({
      tableOrder: AUTH_SCOPE_SEED_TABLE_ORDER,
      rowCounts: {
        users: 1,
        projects: 1,
        project_members: 1,
        project_member_permissions: 1,
        episodes: 1,
        episode_assignments: 1
      }
    });

    expect(mockDb.insert).toHaveBeenNthCalledWith(1, users);
    expect(mockDb.insert).toHaveBeenNthCalledWith(2, projects);
    expect(mockDb.insert).toHaveBeenNthCalledWith(3, projectMembers);
    expect(mockDb.insert).toHaveBeenNthCalledWith(4, projectMemberPermissions);
    expect(mockDb.insert).toHaveBeenNthCalledWith(5, episodes);
    expect(mockDb.insert).toHaveBeenNthCalledWith(6, episodeAssignments);
    expect(mockDb.calls.map((call) => call.rows)).toEqual(contract.steps.map((step) => step.rows));
    expect(mockDb.calls.map((call) => call.config.target)).toEqual([
      users.id,
      projects.id,
      projectMembers.id,
      projectMemberPermissions.id,
      episodes.id,
      episodeAssignments.id
    ]);
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalledTimes(6);
  });
});

function buildCompleteSource(): AuthScopeSeedSource {
  return {
    users: [
      {
        id: "seed-user",
        name: "Seed User",
        defaultRole: "coordinator",
        avatarTone: "ink"
      }
    ],
    projects: [
      {
        id: "seed-project",
        name: "Seed Project",
        code: "SP",
        episodeCount: 1,
        status: "active",
        createdAt: AUTH_SCOPE_SEED_STABLE_TIMESTAMP
      }
    ],
    members: [
      {
        id: "seed-member",
        projectId: "seed-project",
        userId: "seed-user",
        role: "coordinator",
        createdAt: AUTH_SCOPE_SEED_STABLE_TIMESTAMP
      }
    ],
    memberPermissions: [
      {
        id: "seed-permission",
        projectId: "seed-project",
        userId: "seed-user",
        permission: "canManageProjects",
        grantedAt: AUTH_SCOPE_SEED_STABLE_TIMESTAMP
      }
    ],
    episodes: [
      {
        id: "seed-episode",
        projectId: "seed-project",
        episodeNo: 1,
        title: "Episode 1",
        productionStatus: "not_started",
        hasUnreadKeyChange: false,
        openIssueCount: 0,
        assetTodoCount: 0
      }
    ],
    assignments: [
      {
        id: "seed-assignment",
        episodeId: "seed-episode",
        userId: "seed-user",
        responsibility: "writer",
        createdAt: AUTH_SCOPE_SEED_STABLE_TIMESTAMP
      }
    ]
  };
}

function createMockDb() {
  const calls: Array<{ table: unknown; rows: unknown; config: { target?: unknown } }> = [];
  const onConflictDoUpdate = vi.fn(async (config: { target?: unknown }) => {
    const call = calls.at(-1);

    if (call) {
      call.config = config;
    }
  });
  const values = vi.fn((rows: unknown) => {
    const call = calls.at(-1);

    if (call) {
      call.rows = rows;
    }

    return { onConflictDoUpdate };
  });
  const insert = vi.fn((table: unknown) => {
    calls.push({ table, rows: [], config: {} });

    return { values };
  });
  const transaction = vi.fn(async (callback: (tx: { insert: typeof insert }) => Promise<void>) => callback({ insert }));

  return {
    db: {
      transaction
    },
    calls,
    insert,
    values,
    onConflictDoUpdate
  };
}
