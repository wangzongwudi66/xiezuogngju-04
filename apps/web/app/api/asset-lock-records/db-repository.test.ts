import { seedWorkspace, type AssetLockRecord, type ScriptSourceBinding } from "@aigc/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import {
  createDbAssetLockRecordRepository,
  mapAssetLockRecordRows,
  mapAssetLockRecordToDbRows,
  mapAssetLockRecordToDbUpdateRow,
  mapScriptSourceBindingRows,
  mapScriptSourceBindingToDbRow,
  type AssetLockRecordDbEpisodeRow,
  type AssetLockRecordDbRecordRow,
  type ScriptSourceBindingDbRow
} from "./db-repository";

vi.mock("../../../db/runtime", () => ({
  getAssetLockDbRuntime: vi.fn()
}));

vi.mock("../delivery-import-jobs/persistence", () => ({
  readDeliveryImportWorkspace: vi.fn()
}));

describe("asset lock record DB repository mappers", () => {
  it("maps DB record and episode rows into domain records", () => {
    const recordRows: AssetLockRecordDbRecordRow[] = [
      {
        id: "asset-lock-1",
        projectId: "project-jincheng",
        deliveryPackageId: "delivery-1",
        assetName: "Mine Lift",
        assetNameKey: "mine lift",
        assetType: "scene",
        changeType: "new",
        writerConfirmation: "pending",
        writerConfirmedByUserId: null,
        writerConfirmedAt: null,
        writerNote: "writer note",
        productionConfirmation: "pending",
        productionConfirmedByUserId: null,
        productionConfirmedAt: null,
        productionNote: null,
        risk: "attention",
        status: "draft",
        missingInfo: null,
        disputeReason: null,
        finalLockedByUserId: null,
        finalLockedAt: null,
        createdByUserId: "user-head-writer",
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:00:00.000Z"
      }
    ];
    const episodeRows: AssetLockRecordDbEpisodeRow[] = [
      {
        assetLockRecordId: "asset-lock-1",
        episodeNo: 2,
        createdAt: "2026-05-29T00:00:00.000Z"
      },
      {
        assetLockRecordId: "asset-lock-1",
        episodeNo: 1,
        createdAt: "2026-05-29T00:00:00.000Z"
      }
    ];

    const records = mapAssetLockRecordRows(recordRows, episodeRows);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "asset-lock-1",
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-1",
      episodeNos: [1, 2],
      assetName: "Mine Lift",
      assetType: "scene",
      changeType: "new",
      writerConfirmation: "pending",
      writerNote: "writer note",
      productionConfirmation: "pending",
      risk: "attention",
      status: "draft",
      createdByUserId: "user-head-writer"
    });
    expect(records[0]?.productionNote).toBeUndefined();
  });

  it("maps a domain record into explicit DB insert rows", () => {
    const record: AssetLockRecord = {
      id: "asset-lock-1",
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-1",
      episodeNos: [1, 2],
      assetName: "  Mine   Lift  ",
      assetType: "scene",
      changeType: "new",
      writerConfirmation: "pending",
      writerNote: "writer note",
      productionConfirmation: "pending",
      risk: "attention",
      status: "draft",
      createdByUserId: "user-head-writer",
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z"
    };

    const rows = mapAssetLockRecordToDbRows(record);

    expect(rows.record).toMatchObject({
      id: "asset-lock-1",
      assetName: "  Mine   Lift  ",
      assetNameKey: "mine lift",
      writerNote: "writer note",
      productionNote: null
    });
    expect(rows.episodes).toEqual([
      {
        assetLockRecordId: "asset-lock-1",
        episodeNo: 1,
        createdAt: "2026-05-29T00:00:00.000Z"
      },
      {
        assetLockRecordId: "asset-lock-1",
        episodeNo: 2,
        createdAt: "2026-05-29T00:00:00.000Z"
      }
    ]);
  });

  it("maps a domain record into explicit DB lifecycle update fields", () => {
    const record = buildRecord({
      writerConfirmation: "confirmed",
      writerConfirmedByUserId: "user-head-writer",
      writerConfirmedAt: "2026-05-29T01:00:00.000Z",
      writerNote: "writer ok",
      productionConfirmation: "confirmed",
      productionConfirmedByUserId: "user-creator-a",
      productionConfirmedAt: "2026-05-29T02:00:00.000Z",
      productionNote: "production ok",
      risk: "high",
      status: "locked",
      missingInfo: undefined,
      disputeReason: undefined,
      finalLockedByUserId: "user-owner",
      finalLockedAt: "2026-05-29T03:00:00.000Z",
      updatedAt: "2026-05-29T03:00:00.000Z"
    });

    expect(mapAssetLockRecordToDbUpdateRow(record)).toEqual({
      writerConfirmation: "confirmed",
      writerConfirmedByUserId: "user-head-writer",
      writerConfirmedAt: "2026-05-29T01:00:00.000Z",
      writerNote: "writer ok",
      productionConfirmation: "confirmed",
      productionConfirmedByUserId: "user-creator-a",
      productionConfirmedAt: "2026-05-29T02:00:00.000Z",
      productionNote: "production ok",
      risk: "high",
      status: "locked",
      missingInfo: null,
      disputeReason: null,
      finalLockedByUserId: "user-owner",
      finalLockedAt: "2026-05-29T03:00:00.000Z",
      updatedAt: "2026-05-29T03:00:00.000Z"
    });
  });

  it("maps DB script source binding rows into domain bindings", () => {
    const bindingRows: ScriptSourceBindingDbRow[] = [
      {
        id: "source-binding-1",
        projectId: "project-jincheng",
        deliveryPackageId: "delivery-1",
        assetLockRecordId: "asset-lock-1",
        episodeNo: 2,
        startLine: 4,
        endLine: 6,
        excerptSnapshot: "Mine lift source excerpt",
        createdByUserId: "user-head-writer",
        createdAt: "2026-05-29T00:00:00.000Z"
      }
    ];

    const bindings = mapScriptSourceBindingRows(bindingRows);

    expect(bindings).toEqual([
      {
        id: "source-binding-1",
        projectId: "project-jincheng",
        deliveryPackageId: "delivery-1",
        assetLockRecordId: "asset-lock-1",
        episodeNo: 2,
        startLine: 4,
        endLine: 6,
        excerptSnapshot: "Mine lift source excerpt",
        createdByUserId: "user-head-writer",
        createdAt: "2026-05-29T00:00:00.000Z"
      }
    ]);
  });

  it("maps a domain script source binding into an explicit DB insert row", () => {
    const binding: ScriptSourceBinding = {
      id: "source-binding-1",
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-1",
      assetLockRecordId: "asset-lock-1",
      episodeNo: 2,
      startLine: 4,
      endLine: 6,
      excerptSnapshot: "Mine lift source excerpt",
      createdByUserId: "user-head-writer",
      createdAt: "2026-05-29T00:00:00.000Z"
    };

    expect(mapScriptSourceBindingToDbRow(binding)).toEqual({
      id: "source-binding-1",
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-1",
      assetLockRecordId: "asset-lock-1",
      episodeNo: 2,
      startLine: 4,
      endLine: 6,
      excerptSnapshot: "Mine lift source excerpt",
      createdByUserId: "user-head-writer",
      createdAt: "2026-05-29T00:00:00.000Z"
    });
  });
});

describe("asset lock record DB repository source binding writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readDeliveryImportWorkspace).mockResolvedValue({
      state: seedWorkspace,
      deliveryParseIssuesByPackageId: {}
    });
  });

  it("inserts source bindings in a transaction and returns the refreshed snapshot", async () => {
    const binding: ScriptSourceBinding = {
      id: "source-binding-1",
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-1",
      assetLockRecordId: "asset-lock-1",
      episodeNo: 2,
      startLine: 4,
      endLine: 6,
      excerptSnapshot: "Mine lift source excerpt",
      createdByUserId: "user-head-writer",
      createdAt: "2026-05-29T00:00:00.000Z"
    };
    const mockDb = createMockDb({
      selectResults: [[], [], [mapScriptSourceBindingToDbRow(binding)]]
    });
    mockRuntime(mockDb.db);

    const snapshot = await createDbAssetLockRecordRepository().createSourceBinding(binding);

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.insertValues).toHaveBeenCalledWith(mapScriptSourceBindingToDbRow(binding));
    expect(snapshot.scriptSourceBindings).toEqual([binding]);
  });

  it("hard deletes source bindings and returns the refreshed snapshot", async () => {
    const mockDb = createMockDb({
      deletedRows: [{ id: "source-binding-1" }],
      selectResults: [[], [], []]
    });
    mockRuntime(mockDb.db);

    const snapshot = await createDbAssetLockRecordRepository().removeSourceBinding("source-binding-1");

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.deleteWhere).toHaveBeenCalledTimes(1);
    expect(mockDb.deleteReturning).toHaveBeenCalledTimes(1);
    expect(snapshot.scriptSourceBindings).toEqual([]);
  });

  it("throws a stable error when no source binding row is deleted", async () => {
    const mockDb = createMockDb({
      deletedRows: []
    });
    mockRuntime(mockDb.db);

    await expect(createDbAssetLockRecordRepository().removeSourceBinding("missing-source-binding")).rejects.toThrow(
      "script_source_binding_not_found"
    );
    expect(readDeliveryImportWorkspace).not.toHaveBeenCalled();
  });
});

describe("asset lock record DB repository lifecycle writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readDeliveryImportWorkspace).mockResolvedValue({
      state: seedWorkspace,
      deliveryParseIssuesByPackageId: {}
    });
  });

  it("updates explicit record fields, returns the refreshed snapshot, and preserves episode rows", async () => {
    const updatedRecord = buildRecord({
      writerConfirmation: "confirmed",
      writerConfirmedByUserId: "user-head-writer",
      writerConfirmedAt: "2026-05-29T01:00:00.000Z",
      writerNote: "writer ok",
      status: "draft",
      updatedAt: "2026-05-29T01:00:00.000Z"
    });
    const rows = mapAssetLockRecordToDbRows(updatedRecord);
    const mockDb = createMockDb({
      updatedRows: [rows.record],
      selectResults: [[rows.record], rows.episodes, []]
    });
    mockRuntime(mockDb.db);

    const snapshot = await createDbAssetLockRecordRepository().updateAssetLockRecord(updatedRecord);

    expect(mockDb.updateSet).toHaveBeenCalledWith(mapAssetLockRecordToDbUpdateRow(updatedRecord));
    expect(mockDb.updateWhere).toHaveBeenCalledTimes(1);
    expect(mockDb.updateReturning).toHaveBeenCalledTimes(1);
    expect(mockDb.insertValues).not.toHaveBeenCalled();
    expect(mockDb.deleteWhere).not.toHaveBeenCalled();
    expect(snapshot.assetLockRecords).toEqual([updatedRecord]);
  });

  it("throws a stable error when no record row is updated", async () => {
    const mockDb = createMockDb({
      updatedRows: []
    });
    mockRuntime(mockDb.db);

    await expect(createDbAssetLockRecordRepository().updateAssetLockRecord(buildRecord({ id: "missing-record" }))).rejects.toThrow(
      "asset_lock_record_not_found"
    );
    expect(readDeliveryImportWorkspace).not.toHaveBeenCalled();
  });
});

function buildRecord(overrides: Partial<AssetLockRecord> = {}): AssetLockRecord {
  return {
    id: "asset-lock-1",
    projectId: "project-jincheng",
    deliveryPackageId: "delivery-1",
    episodeNos: [1, 2],
    assetName: "Mine Lift",
    assetType: "scene",
    changeType: "new",
    writerConfirmation: "pending",
    productionConfirmation: "pending",
    risk: "attention",
    status: "draft",
    createdByUserId: "user-head-writer",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z",
    ...overrides
  };
}

function mockRuntime(db: unknown) {
  vi.mocked(getAssetLockDbRuntime).mockReturnValue({
    db,
    pool: {}
  } as ReturnType<typeof getAssetLockDbRuntime>);
}

function createMockDb(input: { deletedRows?: unknown[]; selectResults?: unknown[][]; updatedRows?: unknown[] } = {}) {
  const selectResults = [...(input.selectResults ?? [])];
  const orderBy = vi.fn(async () => selectResults.shift() ?? []);
  const from = vi.fn(() => ({ orderBy }));
  const select = vi.fn(() => ({ from }));
  const insertValues = vi.fn(async (_row: unknown) => undefined);
  const insert = vi.fn(() => ({ values: insertValues }));
  const updateReturning = vi.fn(async () => input.updatedRows ?? []);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const deleteReturning = vi.fn(async () => input.deletedRows ?? []);
  const deleteWhere = vi.fn(() => ({ returning: deleteReturning }));
  const deleteFrom = vi.fn(() => ({ where: deleteWhere }));
  const tx = {
    insert,
    delete: deleteFrom
  };
  const transaction = vi.fn(async (callback: (transactionClient: typeof tx) => Promise<unknown> | unknown) => callback(tx));
  const db = {
    select,
    update,
    transaction
  };

  return {
    db,
    transaction,
    insertValues,
    updateSet,
    updateWhere,
    updateReturning,
    deleteWhere,
    deleteReturning
  };
}
