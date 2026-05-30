import { describe, expect, it, vi } from "vitest";
import type { EpisodeAssignment, PermissionKey } from "@aigc/domain";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import {
  episodeAssignments,
  episodes,
  projectMemberPermissions,
  projectMembers,
  projects,
  users
} from "../../../db/schema";
import {
  mapAuthScopeRows,
  readDbAuthScopeSnapshot,
  type AuthScopeDbRows,
  type EpisodeAssignmentDbRow,
  type EpisodeDbRow,
  type ProjectDbRow,
  type ProjectMemberDbRow,
  type ProjectMemberPermissionDbRow,
  type UserDbRow
} from "./db-repository";

const permissionKeys = [
  "canManageProjects",
  "canManageMembers",
  "canAssignEpisodes",
  "canViewProjectOverview",
  "canViewAllEpisodes",
  "canSubmitWriting",
  "canReviewAssets",
  "canViewAssignedEpisodes"
] satisfies PermissionKey[];

vi.mock("../../../db/runtime", () => ({
  getAssetLockDbRuntime: vi.fn()
}));

describe("auth scope DB repository mappers", () => {
  it("maps empty DB rows into empty auth/scope arrays", () => {
    expect(mapAuthScopeRows(buildEmptyRows())).toEqual({
      users: [],
      projects: [],
      members: [],
      memberPermissions: [],
      episodes: [],
      assignments: []
    });
  });

  it("maps DB rows into the WorkspaceState auth/scope arrays", () => {
    const rows = buildRows();

    expect(mapAuthScopeRows(rows)).toEqual({
      users: [
        {
          id: "user-head-writer",
          name: "Head Writer",
          defaultRole: "head_writer",
          avatarTone: "violet"
        }
      ],
      projects: [
        {
          id: "project-jincheng",
          name: "Jincheng",
          code: "JC",
          episodeCount: 60,
          status: "active",
          createdAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      members: [
        {
          id: "member-head-jc",
          projectId: "project-jincheng",
          userId: "user-head-writer",
          role: "head_writer",
          createdAt: "2026-05-29T00:01:00.000Z"
        }
      ],
      memberPermissions: [
        {
          id: "permission-head-review-assets",
          projectId: "project-jincheng",
          userId: "user-head-writer",
          permission: "canReviewAssets",
          grantedAt: "2026-05-29T00:02:00.000Z"
        }
      ],
      episodes: [
        {
          id: "episode-jc-1",
          projectId: "project-jincheng",
          episodeNo: 1,
          title: "Episode 1",
          productionStatus: "key_update",
          hasUnreadKeyChange: true,
          openIssueCount: 2,
          assetTodoCount: 3
        }
      ],
      assignments: [
        {
          id: "assignment-jc-1-head",
          episodeId: "episode-jc-1",
          userId: "user-head-writer",
          responsibility: "writer",
          createdAt: "2026-05-29T00:03:00.000Z"
        }
      ]
    });
  });

  it("reads each auth/scope table with a stable order and returns mapped rows", async () => {
    const rows = buildRows();
    const mockDb = createMockDb([
      rows.userRows,
      rows.projectRows,
      rows.memberRows,
      rows.memberPermissionRows,
      rows.episodeRows,
      rows.assignmentRows
    ]);
    vi.mocked(getAssetLockDbRuntime).mockReturnValue({
      db: mockDb.db,
      pool: {}
    } as unknown as ReturnType<typeof getAssetLockDbRuntime>);

    const snapshot = await readDbAuthScopeSnapshot();

    expect(snapshot).toEqual(mapAuthScopeRows(rows));
    expect(mockDb.from).toHaveBeenNthCalledWith(1, users);
    expect(mockDb.from).toHaveBeenNthCalledWith(2, projects);
    expect(mockDb.from).toHaveBeenNthCalledWith(3, projectMembers);
    expect(mockDb.from).toHaveBeenNthCalledWith(4, projectMemberPermissions);
    expect(mockDb.from).toHaveBeenNthCalledWith(5, episodes);
    expect(mockDb.from).toHaveBeenNthCalledWith(6, episodeAssignments);
    expect(mockDb.orderBy).toHaveBeenCalledTimes(6);
  });

  it("reads empty auth/scope table rows as empty arrays", async () => {
    const mockDb = createMockDb([[], [], [], [], [], []]);
    vi.mocked(getAssetLockDbRuntime).mockReturnValue({
      db: mockDb.db,
      pool: {}
    } as unknown as ReturnType<typeof getAssetLockDbRuntime>);

    await expect(readDbAuthScopeSnapshot()).resolves.toEqual({
      users: [],
      projects: [],
      members: [],
      memberPermissions: [],
      episodes: [],
      assignments: []
    });
  });

  it("keeps multiple roles for the same user in the same project", () => {
    const rows = buildRows({
      memberRows: [
        buildMemberRow({ id: "member-a-writer", role: "writer" }),
        buildMemberRow({ id: "member-a-creator", role: "creator" })
      ]
    });

    expect(mapAuthScopeRows(rows).members).toEqual([
      {
        id: "member-a-writer",
        projectId: "project-jincheng",
        userId: "user-head-writer",
        role: "writer",
        createdAt: "2026-05-29T00:01:00.000Z"
      },
      {
        id: "member-a-creator",
        projectId: "project-jincheng",
        userId: "user-head-writer",
        role: "creator",
        createdAt: "2026-05-29T00:01:00.000Z"
      }
    ]);
  });

  it("preserves an empty memberPermissions array without dropping other rows", () => {
    const snapshot = mapAuthScopeRows(
      buildRows({
        memberPermissionRows: []
      })
    );

    expect(snapshot.memberPermissions).toEqual([]);
    expect(snapshot.users).toHaveLength(1);
    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.members).toHaveLength(1);
  });

  it("preserves every permission key through mapper and read helper", async () => {
    const rows = buildRows({
      memberPermissionRows: permissionKeys.map((permission, index) =>
        buildMemberPermissionRow({
          id: `permission-${index + 1}`,
          permission
        })
      )
    });
    const mockDb = createMockDb([
      rows.userRows,
      rows.projectRows,
      rows.memberRows,
      rows.memberPermissionRows,
      rows.episodeRows,
      rows.assignmentRows
    ]);
    vi.mocked(getAssetLockDbRuntime).mockReturnValue({
      db: mockDb.db,
      pool: {}
    } as unknown as ReturnType<typeof getAssetLockDbRuntime>);

    expect(mapAuthScopeRows(rows).memberPermissions.map((item) => item.permission)).toEqual(permissionKeys);
    await expect(readDbAuthScopeSnapshot()).resolves.toMatchObject({
      memberPermissions: permissionKeys.map((permission, index) => ({
        id: `permission-${index + 1}`,
        projectId: "project-jincheng",
        userId: "user-head-writer",
        permission,
        grantedAt: "2026-05-29T00:02:00.000Z"
      }))
    });
  });

  it("maps episode counters, boolean flags, and assignment responsibilities without coercion", () => {
    const responsibilities = ["writer", "lead_creator", "creator", "reviewer", "support"] satisfies Array<
      EpisodeAssignment["responsibility"]
    >;
    const rows = buildRows({
      episodeRows: [
        buildEpisodeRow({
          id: "episode-zero-counts",
          episodeNo: 7,
          productionStatus: "blocked",
          hasUnreadKeyChange: false,
          openIssueCount: 0,
          assetTodoCount: 12
        })
      ],
      assignmentRows: responsibilities.map((responsibility, index) =>
        buildAssignmentRow({
          id: `assignment-${responsibility}`,
          userId: `user-${index + 1}`,
          responsibility
        })
      )
    });

    const snapshot = mapAuthScopeRows(rows);

    expect(snapshot.episodes).toEqual([
      {
        id: "episode-zero-counts",
        projectId: "project-jincheng",
        episodeNo: 7,
        title: "Episode 1",
        productionStatus: "blocked",
        hasUnreadKeyChange: false,
        openIssueCount: 0,
        assetTodoCount: 12
      }
    ]);
    expect(snapshot.assignments.map((item) => item.responsibility)).toEqual(responsibilities);
  });
});

function buildEmptyRows(): AuthScopeDbRows {
  return {
    userRows: [],
    projectRows: [],
    memberRows: [],
    memberPermissionRows: [],
    episodeRows: [],
    assignmentRows: []
  };
}

function buildRows(overrides: Partial<AuthScopeDbRows> = {}): AuthScopeDbRows {
  return {
    userRows: [
      {
        id: "user-head-writer",
        name: "Head Writer",
        defaultRole: "head_writer",
        avatarTone: "violet"
      } satisfies UserDbRow
    ],
    projectRows: [
      {
        id: "project-jincheng",
        name: "Jincheng",
        code: "JC",
        episodeCount: 60,
        status: "active",
        createdAt: "2026-05-29T00:00:00.000Z"
      } satisfies ProjectDbRow
    ],
    memberRows: [
      {
        id: "member-head-jc",
        projectId: "project-jincheng",
        userId: "user-head-writer",
        role: "head_writer",
        createdAt: "2026-05-29T00:01:00.000Z"
      } satisfies ProjectMemberDbRow
    ],
    memberPermissionRows: [
      {
        id: "permission-head-review-assets",
        projectId: "project-jincheng",
        userId: "user-head-writer",
        permission: "canReviewAssets",
        grantedAt: "2026-05-29T00:02:00.000Z"
      } satisfies ProjectMemberPermissionDbRow
    ],
    episodeRows: [
      {
        id: "episode-jc-1",
        projectId: "project-jincheng",
        episodeNo: 1,
        title: "Episode 1",
        productionStatus: "key_update",
        hasUnreadKeyChange: true,
        openIssueCount: 2,
        assetTodoCount: 3
      } satisfies EpisodeDbRow
    ],
    assignmentRows: [
      {
        id: "assignment-jc-1-head",
        episodeId: "episode-jc-1",
        userId: "user-head-writer",
        responsibility: "writer",
        createdAt: "2026-05-29T00:03:00.000Z"
      } satisfies EpisodeAssignmentDbRow
    ],
    ...overrides
  };
}

function buildMemberRow(overrides: Partial<ProjectMemberDbRow> = {}): ProjectMemberDbRow {
  return {
    id: "member-head-jc",
    projectId: "project-jincheng",
    userId: "user-head-writer",
    role: "head_writer",
    createdAt: "2026-05-29T00:01:00.000Z",
    ...overrides
  } satisfies ProjectMemberDbRow;
}

function buildMemberPermissionRow(
  overrides: Partial<ProjectMemberPermissionDbRow> = {}
): ProjectMemberPermissionDbRow {
  return {
    id: "permission-head-review-assets",
    projectId: "project-jincheng",
    userId: "user-head-writer",
    permission: "canReviewAssets",
    grantedAt: "2026-05-29T00:02:00.000Z",
    ...overrides
  } satisfies ProjectMemberPermissionDbRow;
}

function buildEpisodeRow(overrides: Partial<EpisodeDbRow> = {}): EpisodeDbRow {
  return {
    id: "episode-jc-1",
    projectId: "project-jincheng",
    episodeNo: 1,
    title: "Episode 1",
    productionStatus: "key_update",
    hasUnreadKeyChange: true,
    openIssueCount: 2,
    assetTodoCount: 3,
    ...overrides
  } satisfies EpisodeDbRow;
}

function buildAssignmentRow(overrides: Partial<EpisodeAssignmentDbRow> = {}): EpisodeAssignmentDbRow {
  return {
    id: "assignment-jc-1-head",
    episodeId: "episode-jc-1",
    userId: "user-head-writer",
    responsibility: "writer",
    createdAt: "2026-05-29T00:03:00.000Z",
    ...overrides
  } satisfies EpisodeAssignmentDbRow;
}

function createMockDb(selectResults: unknown[][]) {
  const pendingResults = [...selectResults];
  const orderBy = vi.fn(async () => pendingResults.shift() ?? []);
  const from = vi.fn(() => ({ orderBy }));
  const select = vi.fn(() => ({ from }));

  return {
    db: {
      select
    },
    from,
    orderBy
  };
}
