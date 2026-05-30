import type { Episode, EpisodeAssignment, Project, ProjectMember, ProjectMemberPermission, User } from "@aigc/domain";
import { describe, expect, it, vi } from "vitest";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { episodeAssignments, episodes, projectMemberPermissions, projectMembers, projects, users } from "../../../db/schema";
import {
  createDbAuthScopeWriteRepository,
  mapEpisodeAssignmentToDbInsertRow,
  mapEpisodeToDbInsertRow,
  mapProjectMemberPermissionToDbInsertRow,
  mapProjectMemberToDbInsertRow,
  mapProjectToDbInsertRow,
  mapProjectToDbUpdateRow,
  mapUserToDbInsertRow
} from "./db-write-repository";

vi.mock("../../../db/runtime", () => ({
  getAssetLockDbRuntime: vi.fn()
}));

describe("auth scope DB write repository", () => {
  it("maps auth/scope domain rows into DB insert rows", () => {
    expect(mapUserToDbInsertRow(buildUser())).toEqual(buildUser());
    expect(mapProjectToDbInsertRow(buildProject())).toEqual(buildProject());
    expect(mapProjectToDbUpdateRow(buildProject())).toEqual({
      name: "Jincheng",
      code: "JC",
      episodeCount: 2,
      status: "active",
      createdAt: "2026-05-01T00:00:00.000Z"
    });
    expect(mapEpisodeToDbInsertRow(buildEpisode())).toEqual(buildEpisode());
    expect(mapProjectMemberToDbInsertRow(buildMember())).toEqual(buildMember());
    expect(mapProjectMemberPermissionToDbInsertRow(buildPermission())).toEqual(buildPermission());
    expect(mapEpisodeAssignmentToDbInsertRow(buildAssignment())).toEqual(buildAssignment());
  });

  it("creates a user with a narrow insert", async () => {
    const mockDb = createMockDb();
    vi.mocked(getAssetLockDbRuntime).mockReturnValue({
      db: mockDb.db,
      pool: {}
    } as unknown as ReturnType<typeof getAssetLockDbRuntime>);

    await createDbAuthScopeWriteRepository().createUser(buildUser());

    expect(mockDb.insert).toHaveBeenCalledWith(users);
    expect(mockDb.insertRows).toEqual([{ table: users, rows: buildUser() }]);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("creates projects and episode skeletons in one transaction", async () => {
    const mockDb = createMockDb();
    vi.mocked(getAssetLockDbRuntime).mockReturnValue({
      db: mockDb.db,
      pool: {}
    } as unknown as ReturnType<typeof getAssetLockDbRuntime>);
    const project = buildProject();
    const projectEpisodes = [buildEpisode({ episodeNo: 1, id: "episode-1" }), buildEpisode({ episodeNo: 2, id: "episode-2" })];

    await createDbAuthScopeWriteRepository().createProjectWithEpisodes(project, projectEpisodes);

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.insertRows).toEqual([
      { table: projects, rows: mapProjectToDbInsertRow(project) },
      { table: episodes, rows: projectEpisodes.map(mapEpisodeToDbInsertRow) }
    ]);
  });

  it("updates projects by id and fails closed when no row is updated", async () => {
    const mockDb = createMockDb({ updateReturningRows: [{ id: "project-jincheng" }] });
    vi.mocked(getAssetLockDbRuntime).mockReturnValue({
      db: mockDb.db,
      pool: {}
    } as unknown as ReturnType<typeof getAssetLockDbRuntime>);

    await createDbAuthScopeWriteRepository().updateProject(buildProject({ name: "Renamed" }));

    expect(mockDb.update).toHaveBeenCalledWith(projects);
    expect(mockDb.updateRows).toEqual([
      {
        table: projects,
        row: mapProjectToDbUpdateRow(buildProject({ name: "Renamed" }))
      }
    ]);

    const missingDb = createMockDb({ updateReturningRows: [] });
    vi.mocked(getAssetLockDbRuntime).mockReturnValue({
      db: missingDb.db,
      pool: {}
    } as unknown as ReturnType<typeof getAssetLockDbRuntime>);

    await expect(createDbAuthScopeWriteRepository().updateProject(buildProject())).rejects.toThrow(
      "auth_scope_project_not_found"
    );
  });

  it("replaces member roles and custom permissions through delete-then-insert transactions", async () => {
    const mockDb = createMockDb();
    vi.mocked(getAssetLockDbRuntime).mockReturnValue({
      db: mockDb.db,
      pool: {}
    } as unknown as ReturnType<typeof getAssetLockDbRuntime>);
    const repository = createDbAuthScopeWriteRepository();

    await repository.replaceProjectMemberRoles("project-jincheng", "user-writer", [buildMember()]);
    await repository.replaceProjectMemberPermissions("project-jincheng", "user-writer", [buildPermission()]);

    expect(mockDb.deleteTables).toEqual([projectMembers, projectMemberPermissions]);
    expect(mockDb.insertRows).toEqual([
      { table: projectMembers, rows: [mapProjectMemberToDbInsertRow(buildMember())] },
      { table: projectMemberPermissions, rows: [mapProjectMemberPermissionToDbInsertRow(buildPermission())] }
    ]);
    expect(mockDb.transaction).toHaveBeenCalledTimes(2);
  });

  it("allows clearing custom permissions without inserting empty rows", async () => {
    const mockDb = createMockDb();
    vi.mocked(getAssetLockDbRuntime).mockReturnValue({
      db: mockDb.db,
      pool: {}
    } as unknown as ReturnType<typeof getAssetLockDbRuntime>);

    await createDbAuthScopeWriteRepository().replaceProjectMemberPermissions("project-jincheng", "user-writer", []);

    expect(mockDb.deleteTables).toEqual([projectMemberPermissions]);
    expect(mockDb.insertRows).toEqual([]);
  });

  it("replaces episode assignments only for the requested episode ids", async () => {
    const mockDb = createMockDb();
    vi.mocked(getAssetLockDbRuntime).mockReturnValue({
      db: mockDb.db,
      pool: {}
    } as unknown as ReturnType<typeof getAssetLockDbRuntime>);
    const assignments = [buildAssignment({ episodeId: "episode-1" }), buildAssignment({ id: "assignment-2", episodeId: "episode-2" })];

    await createDbAuthScopeWriteRepository().replaceEpisodeAssignments(
      "project-jincheng",
      "user-writer",
      ["episode-1", "episode-2"],
      assignments
    );

    expect(mockDb.deleteTables).toEqual([episodeAssignments]);
    expect(mockDb.insertRows).toEqual([
      { table: episodeAssignments, rows: assignments.map(mapEpisodeAssignmentToDbInsertRow) }
    ]);
  });
});

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-writer",
    name: "Writer",
    defaultRole: "writer",
    avatarTone: "violet",
    ...overrides
  };
}

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-jincheng",
    name: "Jincheng",
    code: "JC",
    episodeCount: 2,
    status: "active",
    createdAt: "2026-05-01T00:00:00.000Z",
    ...overrides
  };
}

function buildEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: "episode-jc-1",
    projectId: "project-jincheng",
    episodeNo: 1,
    title: "Episode 1",
    productionStatus: "not_started",
    hasUnreadKeyChange: false,
    openIssueCount: 0,
    assetTodoCount: 0,
    ...overrides
  };
}

function buildMember(overrides: Partial<ProjectMember> = {}): ProjectMember {
  return {
    id: "member-writer",
    projectId: "project-jincheng",
    userId: "user-writer",
    role: "writer",
    createdAt: "2026-05-01T00:00:00.000Z",
    ...overrides
  };
}

function buildPermission(overrides: Partial<ProjectMemberPermission> = {}): ProjectMemberPermission {
  return {
    id: "permission-writer-submit",
    projectId: "project-jincheng",
    userId: "user-writer",
    permission: "canSubmitWriting",
    grantedAt: "2026-05-02T00:00:00.000Z",
    ...overrides
  };
}

function buildAssignment(overrides: Partial<EpisodeAssignment> = {}): EpisodeAssignment {
  return {
    id: "assignment-writer-1",
    episodeId: "episode-jc-1",
    userId: "user-writer",
    responsibility: "writer",
    createdAt: "2026-05-03T00:00:00.000Z",
    ...overrides
  };
}

function createMockDb(options: { updateReturningRows?: Array<{ id: string }> } = {}) {
  const insertRows: Array<{ table: unknown; rows: unknown }> = [];
  const updateRows: Array<{ table: unknown; row: unknown }> = [];
  const deleteTables: unknown[] = [];
  let activeUpdateTable: unknown;

  const values = vi.fn(async (rows: unknown) => {
    insertRows.push({ table: activeInsertTable, rows });
  });
  let activeInsertTable: unknown;
  const insert = vi.fn((table: unknown) => {
    activeInsertTable = table;
    return { values };
  });

  const deleteWhere = vi.fn(async () => undefined);
  const deleteFn = vi.fn((table: unknown) => {
    deleteTables.push(table);
    return { where: deleteWhere };
  });

  const returning = vi.fn(async () => options.updateReturningRows ?? []);
  const updateWhere = vi.fn(() => ({ returning }));
  const set = vi.fn((row: unknown) => {
    updateRows.push({ table: activeUpdateTable, row });
    return { where: updateWhere };
  });
  const update = vi.fn((table: unknown) => {
    activeUpdateTable = table;
    return { set };
  });

  const tx = {
    insert,
    delete: deleteFn,
    update
  };
  const transaction = vi.fn(async (callback: (transactionDb: typeof tx) => Promise<void>) => callback(tx));
  const db = {
    insert,
    delete: deleteFn,
    update,
    transaction
  };

  return {
    db,
    insert,
    update,
    transaction,
    insertRows,
    updateRows,
    deleteTables
  };
}
