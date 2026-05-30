import type { DeliveryPackage, DeliveryPackageEpisode } from "@aigc/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { deliveryPackageEpisodes, deliveryPackages } from "../../../db/schema";
import {
  createDbDeliveryPackageWithEpisodes,
  mapDeliveryPackageEpisodeToDbInsertRow,
  mapDeliveryPackageRows,
  mapDeliveryPackageToDbInsertRow,
  readDbDeliveryPackageSnapshot,
  updateDbDeliveryPackageEpisodeConfirmations,
  updateDbDeliveryPackage,
  type DeliveryPackageDbRow,
  type DeliveryPackageEpisodeDbRow
} from "./db-repository";

vi.mock("../../../db/runtime", () => ({
  getAssetLockDbRuntime: vi.fn()
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("delivery package DB repository mappers", () => {
  it("maps DB package and episode rows into domain records", () => {
    const packageRows: DeliveryPackageDbRow[] = [
      {
        id: "delivery-1",
        projectId: "project-jincheng",
        type: "range",
        title: "Episodes 1-2 delivery",
        sourceFileName: "episodes-1-2.docx",
        declaredEpisodeFrom: 1,
        declaredEpisodeTo: 2,
        status: "published",
        uploadedByUserId: "user-head-writer",
        submittedByUserId: "user-head-writer",
        reviewedByUserId: "user-owner",
        rejectionReason: null,
        createdAt: "2026-05-29T00:00:00.000Z",
        submittedAt: "2026-05-29T01:00:00.000Z",
        publishedAt: "2026-05-29T02:00:00.000Z",
        rejectedAt: null
      }
    ];
    const episodeRows: DeliveryPackageEpisodeDbRow[] = [
      {
        id: "delivery-1-episode-1",
        deliveryPackageId: "delivery-1",
        episodeNo: 1,
        title: "Episode 1",
        content: "Episode 1 content",
        isConfirmedChange: true
      },
      {
        id: "delivery-1-episode-2",
        deliveryPackageId: "delivery-1",
        episodeNo: 2,
        title: "Episode 2",
        content: "Episode 2 content",
        isConfirmedChange: false
      }
    ];

    const snapshot = mapDeliveryPackageRows(packageRows, episodeRows);

    expect(snapshot.deliveryPackages).toEqual([
      {
        id: "delivery-1",
        projectId: "project-jincheng",
        type: "range",
        title: "Episodes 1-2 delivery",
        sourceFileName: "episodes-1-2.docx",
        declaredEpisodeFrom: 1,
        declaredEpisodeTo: 2,
        status: "published",
        uploadedByUserId: "user-head-writer",
        submittedByUserId: "user-head-writer",
        reviewedByUserId: "user-owner",
        createdAt: "2026-05-29T00:00:00.000Z",
        submittedAt: "2026-05-29T01:00:00.000Z",
        publishedAt: "2026-05-29T02:00:00.000Z"
      }
    ]);
    expect(snapshot.deliveryPackageEpisodes).toEqual([
      {
        id: "delivery-1-episode-1",
        deliveryPackageId: "delivery-1",
        episodeNo: 1,
        title: "Episode 1",
        content: "Episode 1 content",
        isConfirmedChange: true
      },
      {
        id: "delivery-1-episode-2",
        deliveryPackageId: "delivery-1",
        episodeNo: 2,
        title: "Episode 2",
        content: "Episode 2 content",
        isConfirmedChange: false
      }
    ]);
  });

  it("maps draft package rows with empty optional fields to undefined", () => {
    const packageRows: DeliveryPackageDbRow[] = [
      {
        id: "delivery-draft",
        projectId: "project-jincheng",
        type: "single_replace",
        title: "Draft package",
        sourceFileName: null,
        declaredEpisodeFrom: 3,
        declaredEpisodeTo: 3,
        status: "draft",
        uploadedByUserId: "user-head-writer",
        submittedByUserId: null,
        reviewedByUserId: null,
        rejectionReason: null,
        createdAt: "2026-05-29T00:00:00.000Z",
        submittedAt: null,
        publishedAt: null,
        rejectedAt: null
      }
    ];

    const snapshot = mapDeliveryPackageRows(packageRows, []);

    expect(snapshot.deliveryPackages).toEqual([
      {
        id: "delivery-draft",
        projectId: "project-jincheng",
        type: "single_replace",
        title: "Draft package",
        sourceFileName: undefined,
        declaredEpisodeFrom: 3,
        declaredEpisodeTo: 3,
        status: "draft",
        uploadedByUserId: "user-head-writer",
        submittedByUserId: undefined,
        reviewedByUserId: undefined,
        rejectionReason: undefined,
        createdAt: "2026-05-29T00:00:00.000Z",
        submittedAt: undefined,
        publishedAt: undefined,
        rejectedAt: undefined
      }
    ]);
    expect(snapshot.deliveryPackageEpisodes).toEqual([]);
  });
});

describe("delivery package DB repository reads", () => {
  it("reads package and episode rows from the DB runtime and maps them", async () => {
    const packageRows: DeliveryPackageDbRow[] = [
      {
        id: "delivery-read-1",
        projectId: "project-jincheng",
        type: "range",
        title: "Read delivery",
        sourceFileName: "read-delivery.docx",
        declaredEpisodeFrom: 4,
        declaredEpisodeTo: 5,
        status: "published",
        uploadedByUserId: "user-head-writer",
        submittedByUserId: "user-head-writer",
        reviewedByUserId: "user-owner",
        rejectionReason: null,
        createdAt: "2026-05-29T00:00:00.000Z",
        submittedAt: "2026-05-29T01:00:00.000Z",
        publishedAt: "2026-05-29T02:00:00.000Z",
        rejectedAt: null
      }
    ];
    const episodeRows: DeliveryPackageEpisodeDbRow[] = [
      {
        id: "delivery-read-1-episode-5",
        deliveryPackageId: "delivery-read-1",
        episodeNo: 5,
        title: "Episode 5",
        content: "Episode 5 read content",
        isConfirmedChange: false
      }
    ];
    const mockDb = createMockDb([packageRows, episodeRows]);
    mockRuntime(mockDb.db);

    const snapshot = await readDbDeliveryPackageSnapshot();

    expect(mockDb.select).toHaveBeenCalledTimes(2);
    expect(mockDb.from).toHaveBeenCalledTimes(2);
    expect(mockDb.from).toHaveBeenNthCalledWith(1, deliveryPackages);
    expect(mockDb.from).toHaveBeenNthCalledWith(2, deliveryPackageEpisodes);
    expect(mockDb.orderBy).toHaveBeenCalledTimes(2);
    expect(mockDb.orderBy.mock.calls[0]).toHaveLength(3);
    expect(mockDb.orderBy.mock.calls[1]).toHaveLength(3);
    expect(snapshot.deliveryPackages).toEqual([
      {
        id: "delivery-read-1",
        projectId: "project-jincheng",
        type: "range",
        title: "Read delivery",
        sourceFileName: "read-delivery.docx",
        declaredEpisodeFrom: 4,
        declaredEpisodeTo: 5,
        status: "published",
        uploadedByUserId: "user-head-writer",
        submittedByUserId: "user-head-writer",
        reviewedByUserId: "user-owner",
        createdAt: "2026-05-29T00:00:00.000Z",
        submittedAt: "2026-05-29T01:00:00.000Z",
        publishedAt: "2026-05-29T02:00:00.000Z"
      }
    ]);
    expect(snapshot.deliveryPackageEpisodes).toEqual([
      {
        id: "delivery-read-1-episode-5",
        deliveryPackageId: "delivery-read-1",
        episodeNo: 5,
        title: "Episode 5",
        content: "Episode 5 read content",
        isConfirmedChange: false
      }
    ]);
  });

  it("returns empty arrays when the DB returns no package or episode rows", async () => {
    const mockDb = createMockDb([[], []]);
    mockRuntime(mockDb.db);

    await expect(readDbDeliveryPackageSnapshot()).resolves.toEqual({
      deliveryPackages: [],
      deliveryPackageEpisodes: []
    });
    expect(mockDb.select).toHaveBeenCalledTimes(2);
    expect(mockDb.orderBy).toHaveBeenCalledTimes(2);
  });
});

describe("delivery package DB repository writes", () => {
  it("inserts package and episode rows inside one transaction", async () => {
    const deliveryPackage = buildDeliveryPackage({
      id: "delivery-create-1",
      sourceFileName: "create-delivery.docx"
    });
    const episodes = [
      buildDeliveryPackageEpisode({ id: "delivery-create-1-episode-1", deliveryPackageId: deliveryPackage.id, episodeNo: 1 }),
      buildDeliveryPackageEpisode({ id: "delivery-create-1-episode-2", deliveryPackageId: deliveryPackage.id, episodeNo: 2 })
    ];
    const mockDb = createMockDb([[toDeliveryPackageDbRow(deliveryPackage)], episodes.map(toDeliveryPackageEpisodeDbRow)]);
    const mockTx = createMockWriteTx();
    const transaction = vi.fn(async (callback: (tx: typeof mockTx.tx) => Promise<void>) => callback(mockTx.tx));
    mockRuntime({ ...mockDb.db, transaction });

    const snapshot = await createDbDeliveryPackageWithEpisodes(deliveryPackage, episodes);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.insert).toHaveBeenCalledTimes(2);
    expect(mockTx.insert).toHaveBeenNthCalledWith(1, deliveryPackages);
    expect(mockTx.insert).toHaveBeenNthCalledWith(2, deliveryPackageEpisodes);
    expect(mockTx.values).toHaveBeenNthCalledWith(1, mapDeliveryPackageToDbInsertRow(deliveryPackage));
    expect(mockTx.values).toHaveBeenNthCalledWith(2, episodes.map(mapDeliveryPackageEpisodeToDbInsertRow));
    expect(snapshot.deliveryPackages).toEqual([deliveryPackage]);
    expect(snapshot.deliveryPackageEpisodes).toEqual(episodes);
  });

  it("does not insert episode rows when a package has no episodes", async () => {
    const deliveryPackage = buildDeliveryPackage({ id: "delivery-empty-episodes" });
    const mockDb = createMockDb([[toDeliveryPackageDbRow(deliveryPackage)], []]);
    const mockTx = createMockWriteTx();
    const transaction = vi.fn(async (callback: (tx: typeof mockTx.tx) => Promise<void>) => callback(mockTx.tx));
    mockRuntime({ ...mockDb.db, transaction });

    await expect(createDbDeliveryPackageWithEpisodes(deliveryPackage, [])).resolves.toEqual({
      deliveryPackages: [deliveryPackage],
      deliveryPackageEpisodes: []
    });

    expect(mockTx.insert).toHaveBeenCalledTimes(1);
    expect(mockTx.insert).toHaveBeenCalledWith(deliveryPackages);
    expect(mockTx.values).toHaveBeenCalledWith(mapDeliveryPackageToDbInsertRow(deliveryPackage));
  });

  it("updates package status fields and returns the mapped package", async () => {
    const deliveryPackage = buildDeliveryPackage({
      id: "delivery-status-update",
      status: "published",
      submittedByUserId: "user-head-writer",
      reviewedByUserId: "user-owner",
      submittedAt: "2026-05-29T01:00:00.000Z",
      publishedAt: "2026-05-29T02:00:00.000Z"
    });
    const mockDb = createMockUpdateDb([toDeliveryPackageDbRow(deliveryPackage)]);
    mockRuntime(mockDb.db);

    await expect(updateDbDeliveryPackage(deliveryPackage)).resolves.toEqual(deliveryPackage);

    expect(mockDb.update).toHaveBeenCalledWith(deliveryPackages);
    expect(mockDb.set).toHaveBeenCalledWith({
      projectId: "project-jincheng",
      type: "range",
      title: "Episodes 1-2 delivery",
      sourceFileName: null,
      declaredEpisodeFrom: 1,
      declaredEpisodeTo: 2,
      status: "published",
      uploadedByUserId: "user-head-writer",
      submittedByUserId: "user-head-writer",
      reviewedByUserId: "user-owner",
      rejectionReason: null,
      createdAt: "2026-05-29T00:00:00.000Z",
      submittedAt: "2026-05-29T01:00:00.000Z",
      publishedAt: "2026-05-29T02:00:00.000Z",
      rejectedAt: null
    });
    expect(mockDb.where).toHaveBeenCalledTimes(1);
    expect(mockDb.returning).toHaveBeenCalledTimes(1);
  });

  it("updates episode confirmation flags inside one transaction and returns the refreshed snapshot", async () => {
    const deliveryPackage = buildDeliveryPackage({ id: "delivery-confirmation-update" });
    const refreshedEpisodes = [
      buildDeliveryPackageEpisode({
        id: "delivery-confirmation-update-episode-1",
        deliveryPackageId: deliveryPackage.id,
        episodeNo: 1,
        isConfirmedChange: false
      }),
      buildDeliveryPackageEpisode({
        id: "delivery-confirmation-update-episode-2",
        deliveryPackageId: deliveryPackage.id,
        episodeNo: 2,
        isConfirmedChange: true
      })
    ];
    const mockDb = createMockDb([[toDeliveryPackageDbRow(deliveryPackage)], refreshedEpisodes.map(toDeliveryPackageEpisodeDbRow)]);
    const mockTx = createMockEpisodeConfirmationUpdateTx([[{ id: refreshedEpisodes[0].id }], [{ id: refreshedEpisodes[1].id }]]);
    const transaction = vi.fn(async (callback: (tx: typeof mockTx.tx) => Promise<void>) => callback(mockTx.tx));
    mockRuntime({ ...mockDb.db, transaction });

    const snapshot = await updateDbDeliveryPackageEpisodeConfirmations(deliveryPackage.id, refreshedEpisodes);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.update).toHaveBeenCalledTimes(2);
    expect(mockTx.update).toHaveBeenCalledWith(deliveryPackageEpisodes);
    expect(mockTx.set).toHaveBeenNthCalledWith(1, { isConfirmedChange: false });
    expect(mockTx.set).toHaveBeenNthCalledWith(2, { isConfirmedChange: true });
    expect(mockTx.where).toHaveBeenCalledTimes(2);
    expect(mockTx.returning).toHaveBeenCalledTimes(2);
    expect(snapshot.deliveryPackages).toEqual([deliveryPackage]);
    expect(snapshot.deliveryPackageEpisodes).toEqual(refreshedEpisodes);
  });

  it("throws a stable error when update touches no rows", async () => {
    const mockDb = createMockUpdateDb([]);
    mockRuntime(mockDb.db);

    await expect(updateDbDeliveryPackage(buildDeliveryPackage({ id: "delivery-missing" }))).rejects.toThrow(
      "delivery_package_not_found"
    );
  });

  it("throws a stable error when an episode confirmation update touches no rows", async () => {
    const select = vi.fn();
    const mockTx = createMockEpisodeConfirmationUpdateTx([[]]);
    const transaction = vi.fn(async (callback: (tx: typeof mockTx.tx) => Promise<void>) => callback(mockTx.tx));
    mockRuntime({ select, transaction });

    await expect(
      updateDbDeliveryPackageEpisodeConfirmations("delivery-missing", [
        { id: "delivery-missing-episode-1", isConfirmedChange: true }
      ])
    ).rejects.toThrow("delivery_package_episode_not_found");
    expect(select).not.toHaveBeenCalled();
  });

  it("does not swallow unique conflicts during insert", async () => {
    const uniqueConflict = Object.assign(new Error("duplicate delivery package"), {
      code: "23505",
      constraint: "delivery_packages_pkey"
    });
    const mockTx = createMockWriteTx(uniqueConflict);
    const select = vi.fn();
    const transaction = vi.fn(async (callback: (tx: typeof mockTx.tx) => Promise<void>) => callback(mockTx.tx));
    mockRuntime({ select, transaction });

    await expect(createDbDeliveryPackageWithEpisodes(buildDeliveryPackage(), [])).rejects.toBe(uniqueConflict);
    expect(select).not.toHaveBeenCalled();
  });
});

function mockRuntime(db: unknown) {
  vi.mocked(getAssetLockDbRuntime).mockReturnValue({
    db,
    pool: {}
  } as ReturnType<typeof getAssetLockDbRuntime>);
}

function createMockDb(selectResults: unknown[][]) {
  const remainingResults = [...selectResults];
  const orderBy = vi.fn(async () => remainingResults.shift() ?? []);
  const from = vi.fn(() => ({ orderBy }));
  const select = vi.fn(() => ({ from }));
  const db = { select };

  return {
    db,
    select,
    from,
    orderBy
  };
}

function createMockWriteTx(error?: unknown) {
  const values = vi.fn(async () => {
    if (error) {
      throw error;
    }
  });
  const insert = vi.fn(() => ({ values }));
  const tx = { insert };

  return {
    tx,
    insert,
    values
  };
}

function createMockUpdateDb(updatedRows: DeliveryPackageDbRow[]) {
  const returning = vi.fn(async () => updatedRows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const db = { update };

  return {
    db,
    update,
    set,
    where,
    returning
  };
}

function createMockEpisodeConfirmationUpdateTx(updatedRowsByCall: unknown[][]) {
  const remainingRows = [...updatedRowsByCall];
  const returning = vi.fn(async () => remainingRows.shift() ?? []);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const tx = { update };

  return {
    tx,
    update,
    set,
    where,
    returning
  };
}

function buildDeliveryPackage(overrides: Partial<DeliveryPackage> = {}): DeliveryPackage {
  return {
    id: "delivery-1",
    projectId: "project-jincheng",
    type: "range",
    title: "Episodes 1-2 delivery",
    declaredEpisodeFrom: 1,
    declaredEpisodeTo: 2,
    status: "draft",
    uploadedByUserId: "user-head-writer",
    createdAt: "2026-05-29T00:00:00.000Z",
    ...overrides
  };
}

function buildDeliveryPackageEpisode(overrides: Partial<DeliveryPackageEpisode> = {}): DeliveryPackageEpisode {
  return {
    id: "delivery-1-episode-1",
    deliveryPackageId: "delivery-1",
    episodeNo: 1,
    title: "Episode 1",
    content: "Episode 1 content",
    isConfirmedChange: false,
    ...overrides
  };
}

function toDeliveryPackageDbRow(deliveryPackage: DeliveryPackage): DeliveryPackageDbRow {
  return {
    id: deliveryPackage.id,
    projectId: deliveryPackage.projectId,
    type: deliveryPackage.type,
    title: deliveryPackage.title,
    sourceFileName: deliveryPackage.sourceFileName ?? null,
    declaredEpisodeFrom: deliveryPackage.declaredEpisodeFrom,
    declaredEpisodeTo: deliveryPackage.declaredEpisodeTo,
    status: deliveryPackage.status,
    uploadedByUserId: deliveryPackage.uploadedByUserId,
    submittedByUserId: deliveryPackage.submittedByUserId ?? null,
    reviewedByUserId: deliveryPackage.reviewedByUserId ?? null,
    rejectionReason: deliveryPackage.rejectionReason ?? null,
    createdAt: deliveryPackage.createdAt,
    submittedAt: deliveryPackage.submittedAt ?? null,
    publishedAt: deliveryPackage.publishedAt ?? null,
    rejectedAt: deliveryPackage.rejectedAt ?? null
  };
}

function toDeliveryPackageEpisodeDbRow(episode: DeliveryPackageEpisode): DeliveryPackageEpisodeDbRow {
  return {
    id: episode.id,
    deliveryPackageId: episode.deliveryPackageId,
    episodeNo: episode.episodeNo,
    title: episode.title,
    content: episode.content,
    isConfirmedChange: episode.isConfirmedChange
  };
}
