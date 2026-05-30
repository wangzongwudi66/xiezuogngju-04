import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { deliveryPackageEpisodes, deliveryPackages } from "../../../db/schema";
import {
  mapDeliveryPackageRows,
  readDbDeliveryPackageSnapshot,
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
