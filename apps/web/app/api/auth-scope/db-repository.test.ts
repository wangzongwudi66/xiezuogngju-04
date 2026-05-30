import { describe, expect, it, vi } from "vitest";
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

vi.mock("../../../db/runtime", () => ({
  getAssetLockDbRuntime: vi.fn()
}));

describe("auth scope DB repository mappers", () => {
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
});

function buildRows(): AuthScopeDbRows {
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
    ]
  };
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
