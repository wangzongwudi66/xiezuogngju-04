import { describe, expect, it, vi } from "vitest";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { episodeCurrents, episodeRevisions, notifications } from "../../../db/schema";
import {
  mapEpisodeCurrentToDbInsertRow,
  mapEpisodeRevisionToDbInsertRow,
  mapNotificationToDbInsertRow,
  mapPublishReadModelRows,
  readDbPublishReadModelSnapshot,
  type EpisodeCurrentDbRow,
  type EpisodeRevisionDbRow,
  type NotificationDbRow,
  type PublishReadModelDbRows
} from "./db-repository";

vi.mock("../../../db/runtime", () => ({
  getAssetLockDbRuntime: vi.fn()
}));

describe("publish read-model DB repository mappers", () => {
  it("maps empty DB rows into empty publish read-model arrays", () => {
    expect(mapPublishReadModelRows(buildEmptyRows())).toEqual({
      episodeRevisions: [],
      episodeCurrents: [],
      notifications: []
    });
  });

  it("maps episode revisions, currents, and notifications into domain records", () => {
    const rows = buildRows();

    expect(mapPublishReadModelRows(rows)).toEqual({
      episodeRevisions: [
        {
          id: "revision-episode-1-2",
          projectId: "project-jincheng",
          episodeId: "episode-jc-1",
          episodeNo: 1,
          deliveryPackageId: "delivery-published",
          revisionNo: 2,
          title: "Episode 1 revised",
          content: "Updated episode 1 script",
          previousRevisionId: "revision-episode-1-1",
          changeSummary: "Updated cold open",
          createdAt: "2026-05-29T02:00:00.000Z"
        }
      ],
      episodeCurrents: [
        {
          id: "current-episode-jc-1",
          projectId: "project-jincheng",
          episodeId: "episode-jc-1",
          currentRevisionId: "revision-episode-1-2",
          updatedAt: "2026-05-29T02:00:00.000Z"
        }
      ],
      notifications: [
        {
          id: "notification-episode-1-writer",
          projectId: "project-jincheng",
          episodeId: "episode-jc-1",
          recipientId: "user-writer",
          type: "key_change",
          title: "第 1 集剧本已更新",
          body: "Episode 1 changed",
          readAt: "2026-05-29T03:00:00.000Z",
          createdAt: "2026-05-29T02:00:00.000Z"
        }
      ]
    });
  });

  it("maps nullable optional fields to undefined", () => {
    const snapshot = mapPublishReadModelRows(
      buildRows({
        episodeRevisionRows: [buildEpisodeRevisionRow({ previousRevisionId: null })],
        notificationRows: [buildNotificationRow({ episodeId: null, readAt: null })]
      })
    );

    expect(snapshot.episodeRevisions[0]).toMatchObject({
      previousRevisionId: undefined
    });
    expect(snapshot.notifications[0]).toMatchObject({
      episodeId: undefined,
      readAt: undefined
    });
  });

  it("maps domain records into DB insert rows", () => {
    const rows = mapPublishReadModelRows(buildRows());

    expect(mapEpisodeRevisionToDbInsertRow(rows.episodeRevisions[0])).toEqual(buildEpisodeRevisionRow());
    expect(mapEpisodeCurrentToDbInsertRow(rows.episodeCurrents[0])).toEqual(buildEpisodeCurrentRow());
    expect(mapNotificationToDbInsertRow(rows.notifications[0])).toEqual(buildNotificationRow());
    expect(
      mapEpisodeRevisionToDbInsertRow({
        ...rows.episodeRevisions[0],
        previousRevisionId: undefined
      })
    ).toMatchObject({ previousRevisionId: null });
    expect(
      mapNotificationToDbInsertRow({
        ...rows.notifications[0],
        episodeId: undefined,
        readAt: undefined
      })
    ).toMatchObject({ episodeId: null, readAt: null });
  });
});

describe("publish read-model DB repository reads", () => {
  it("reads all publish read-model tables with stable order and returns mapped rows", async () => {
    const rows = buildRows();
    const mockDb = createMockDb([rows.episodeRevisionRows, rows.episodeCurrentRows, rows.notificationRows]);
    vi.mocked(getAssetLockDbRuntime).mockReturnValue({
      db: mockDb.db,
      pool: {}
    } as unknown as ReturnType<typeof getAssetLockDbRuntime>);

    await expect(readDbPublishReadModelSnapshot()).resolves.toEqual(mapPublishReadModelRows(rows));

    expect(mockDb.from).toHaveBeenNthCalledWith(1, episodeRevisions);
    expect(mockDb.from).toHaveBeenNthCalledWith(2, episodeCurrents);
    expect(mockDb.from).toHaveBeenNthCalledWith(3, notifications);
    expect(mockDb.orderBy).toHaveBeenCalledTimes(3);
    expect(mockDb.orderBy.mock.calls[0]).toHaveLength(5);
    expect(mockDb.orderBy.mock.calls[1]).toHaveLength(3);
    expect(mockDb.orderBy.mock.calls[2]).toHaveLength(4);
  });

  it("reads empty publish read-model tables as empty arrays", async () => {
    const mockDb = createMockDb([[], [], []]);
    vi.mocked(getAssetLockDbRuntime).mockReturnValue({
      db: mockDb.db,
      pool: {}
    } as unknown as ReturnType<typeof getAssetLockDbRuntime>);

    await expect(readDbPublishReadModelSnapshot()).resolves.toEqual({
      episodeRevisions: [],
      episodeCurrents: [],
      notifications: []
    });
  });
});

function buildEmptyRows(): PublishReadModelDbRows {
  return {
    episodeRevisionRows: [],
    episodeCurrentRows: [],
    notificationRows: []
  };
}

function buildRows(overrides: Partial<PublishReadModelDbRows> = {}): PublishReadModelDbRows {
  return {
    episodeRevisionRows: [buildEpisodeRevisionRow()],
    episodeCurrentRows: [buildEpisodeCurrentRow()],
    notificationRows: [buildNotificationRow()],
    ...overrides
  };
}

function buildEpisodeRevisionRow(overrides: Partial<EpisodeRevisionDbRow> = {}): EpisodeRevisionDbRow {
  return {
    id: "revision-episode-1-2",
    projectId: "project-jincheng",
    episodeId: "episode-jc-1",
    episodeNo: 1,
    deliveryPackageId: "delivery-published",
    revisionNo: 2,
    title: "Episode 1 revised",
    content: "Updated episode 1 script",
    previousRevisionId: "revision-episode-1-1",
    changeSummary: "Updated cold open",
    createdAt: "2026-05-29T02:00:00.000Z",
    ...overrides
  } satisfies EpisodeRevisionDbRow;
}

function buildEpisodeCurrentRow(overrides: Partial<EpisodeCurrentDbRow> = {}): EpisodeCurrentDbRow {
  return {
    id: "current-episode-jc-1",
    projectId: "project-jincheng",
    episodeId: "episode-jc-1",
    currentRevisionId: "revision-episode-1-2",
    updatedAt: "2026-05-29T02:00:00.000Z",
    ...overrides
  } satisfies EpisodeCurrentDbRow;
}

function buildNotificationRow(overrides: Partial<NotificationDbRow> = {}): NotificationDbRow {
  return {
    id: "notification-episode-1-writer",
    projectId: "project-jincheng",
    episodeId: "episode-jc-1",
    recipientId: "user-writer",
    type: "key_change",
    title: "第 1 集剧本已更新",
    body: "Episode 1 changed",
    readAt: "2026-05-29T03:00:00.000Z",
    createdAt: "2026-05-29T02:00:00.000Z",
    ...overrides
  } satisfies NotificationDbRow;
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
