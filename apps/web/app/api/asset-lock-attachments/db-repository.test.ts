import { seedWorkspace, type AssetAttachment, type AssetLockRecord } from "@aigc/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { mapAssetLockRecordToDbRows } from "../asset-lock-records/db-repository";
import { readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { readDbDeliveryPackageSnapshot } from "../delivery-packages/db-repository";
import {
  createDbAssetAttachmentRepository,
  mapAssetAttachmentRows,
  mapAssetAttachmentToDbRow,
  type AssetAttachmentDbRow
} from "./db-repository";

vi.mock("../../../db/runtime", () => ({
  getAssetLockDbRuntime: vi.fn()
}));

vi.mock("../delivery-import-jobs/persistence", () => ({
  readDeliveryImportWorkspace: vi.fn()
}));

vi.mock("../delivery-packages/db-repository", () => ({
  readDbDeliveryPackageSnapshot: vi.fn()
}));

describe("asset lock attachment DB repository mappers", () => {
  it("maps DB rows into domain asset attachments", () => {
    const rows: AssetAttachmentDbRow[] = [
      {
        id: "asset-attachment-1",
        projectId: "project-jincheng",
        assetLockRecordId: "asset-lock-1",
        deliveryPackageId: "delivery-1",
        fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000",
        fileName: "reference.png",
        mime: "image/png",
        sizeBytes: 4096,
        version: 1,
        attachmentType: "reference",
        uploadedByUserId: "user-head-writer",
        uploadedAt: "2026-05-29T00:00:00.000Z",
        note: null,
        status: "active",
        deletedByUserId: null,
        deletedAt: null
      },
      {
        id: "asset-attachment-2",
        projectId: "project-jincheng",
        assetLockRecordId: "asset-lock-1",
        deliveryPackageId: "delivery-1",
        fileId: "asset-att-123e4567-e89b-12d3-a456-426614174001",
        fileName: "final.pdf",
        mime: "application/pdf",
        sizeBytes: 8192,
        version: 2,
        attachmentType: "final",
        uploadedByUserId: "user-owner",
        uploadedAt: "2026-05-29T01:00:00.000Z",
        note: "final reference",
        status: "deleted",
        deletedByUserId: "user-owner",
        deletedAt: "2026-05-29T02:00:00.000Z"
      }
    ];

    const attachments = mapAssetAttachmentRows(rows);

    expect(attachments).toEqual([
      {
        id: "asset-attachment-1",
        projectId: "project-jincheng",
        assetLockRecordId: "asset-lock-1",
        deliveryPackageId: "delivery-1",
        fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000",
        fileName: "reference.png",
        mime: "image/png",
        size: 4096,
        version: 1,
        attachmentType: "reference",
        uploadedByUserId: "user-head-writer",
        uploadedAt: "2026-05-29T00:00:00.000Z",
        note: undefined,
        status: "active",
        deletedByUserId: undefined,
        deletedAt: undefined
      },
      {
        id: "asset-attachment-2",
        projectId: "project-jincheng",
        assetLockRecordId: "asset-lock-1",
        deliveryPackageId: "delivery-1",
        fileId: "asset-att-123e4567-e89b-12d3-a456-426614174001",
        fileName: "final.pdf",
        mime: "application/pdf",
        size: 8192,
        version: 2,
        attachmentType: "final",
        uploadedByUserId: "user-owner",
        uploadedAt: "2026-05-29T01:00:00.000Z",
        note: "final reference",
        status: "deleted",
        deletedByUserId: "user-owner",
        deletedAt: "2026-05-29T02:00:00.000Z"
      }
    ]);
    expect(JSON.stringify(attachments)).not.toContain("sizeBytes");
  });

  it("maps domain asset attachments into explicit DB insert rows", () => {
    const attachment = buildAttachment({
      note: "production plate",
      deletedByUserId: "user-owner",
      deletedAt: "2026-05-29T03:00:00.000Z",
      status: "deleted"
    });

    expect(mapAssetAttachmentToDbRow(attachment)).toEqual({
      id: "asset-attachment-1",
      projectId: "project-jincheng",
      assetLockRecordId: "asset-lock-1",
      deliveryPackageId: "delivery-1",
      fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000",
      fileName: "reference.png",
      mime: "image/png",
      sizeBytes: 4096,
      version: 1,
      attachmentType: "reference",
      uploadedByUserId: "user-head-writer",
      uploadedAt: "2026-05-29T00:00:00.000Z",
      note: "production plate",
      status: "deleted",
      deletedByUserId: "user-owner",
      deletedAt: "2026-05-29T03:00:00.000Z"
    });
  });
});

describe("asset lock attachment DB repository writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readDbDeliveryPackageSnapshot).mockResolvedValue({
      deliveryPackages: seedWorkspace.deliveryPackages,
      deliveryPackageEpisodes: seedWorkspace.deliveryPackageEpisodes
    });
    vi.mocked(readDeliveryImportWorkspace).mockResolvedValue({
      state: seedWorkspace,
      deliveryParseIssuesByPackageId: {}
    });
  });

  it("reads DB asset lock records before overlaying DB attachment metadata", async () => {
    const dbOnlyRecord = buildRecord();
    const staleLocal = buildAttachment({
      id: "asset-attachment-local-stale",
      assetLockRecordId: "asset-lock-local-stale",
      fileId: "asset-att-123e4567-e89b-12d3-a456-426614174010",
      fileName: "stale-local.png"
    });
    const dbAttachment = buildAttachment({
      id: "asset-attachment-db",
      assetLockRecordId: dbOnlyRecord.id,
      deliveryPackageId: dbOnlyRecord.deliveryPackageId,
      fileId: "asset-att-123e4567-e89b-12d3-a456-426614174011",
      fileName: "db-reference.png"
    });
    const dbRecordRows = mapAssetLockRecordToDbRows(dbOnlyRecord);
    const mockDb = createMockDb({
      selectResults: [
        [dbRecordRows.record],
        dbRecordRows.episodes,
        [],
        [mapAssetAttachmentToDbRow(dbAttachment) as AssetAttachmentDbRow]
      ]
    });
    vi.mocked(readDeliveryImportWorkspace).mockResolvedValue({
      state: {
        ...seedWorkspace,
        assetLockRecords: [],
        assetAttachments: [staleLocal]
      },
      deliveryParseIssuesByPackageId: {}
    });
    mockRuntime(mockDb.db);

    const snapshot = await createDbAssetAttachmentRepository().read();

    expect(snapshot.state.assetLockRecords).toEqual([dbOnlyRecord]);
    expect(snapshot.assetAttachments).toEqual([dbAttachment]);
    expect(snapshot.state.assetAttachments).toEqual([dbAttachment]);
    expect(snapshot.state.assetAttachments).not.toContainEqual(staleLocal);
    expect(readDeliveryImportWorkspace).toHaveBeenCalledTimes(1);
  });

  it("inserts attachment metadata and returns the committed row", async () => {
    const attachment = buildAttachment();
    const row = mapAssetAttachmentToDbRow(attachment) as AssetAttachmentDbRow;
    const mockDb = createMockDb({ insertedRows: [row] });
    mockRuntime(mockDb.db);

    const committed = await createDbAssetAttachmentRepository().createAssetAttachmentMetadata({
      attachment,
      metadataInput: metadataInputFromAttachment(attachment)
    });

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.insertValues).toHaveBeenCalledWith(mapAssetAttachmentToDbRow(attachment));
    expect(mockDb.insertReturning).toHaveBeenCalledTimes(1);
    expect(committed).toEqual(attachment);
  });

  it("allocates attachment version inside the DB transaction from current rows", async () => {
    const staleAttachment = buildAttachment({ version: 1 });
    const committedAttachment = buildAttachment({ version: 8 });
    const mockDb = createMockDb({
      insertedRows: [mapAssetAttachmentToDbRow(committedAttachment) as AssetAttachmentDbRow],
      versionRows: [[{ version: 7 }]]
    });
    mockRuntime(mockDb.db);

    const committed = await createDbAssetAttachmentRepository().createAssetAttachmentMetadata({
      attachment: staleAttachment,
      metadataInput: metadataInputFromAttachment(staleAttachment)
    });

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.selectVersionWhere).toHaveBeenCalledTimes(1);
    expect(mockDb.insertValues).toHaveBeenCalledWith(mapAssetAttachmentToDbRow(committedAttachment));
    expect(committed).toEqual(committedAttachment);
  });

  it("retries a record-version unique conflict with a fresh DB version allocation", async () => {
    const staleAttachment = buildAttachment({ version: 1 });
    const committedAttachment = buildAttachment({ version: 3 });
    const mockDb = createMockDb({
      insertedRows: [mapAssetAttachmentToDbRow(committedAttachment) as AssetAttachmentDbRow],
      transactionErrors: [recordVersionUniqueViolation()],
      versionRows: [[{ version: 2 }]]
    });
    mockRuntime(mockDb.db);

    const committed = await createDbAssetAttachmentRepository().createAssetAttachmentMetadata({
      attachment: staleAttachment,
      metadataInput: metadataInputFromAttachment(staleAttachment)
    });

    expect(mockDb.transaction).toHaveBeenCalledTimes(2);
    expect(mockDb.insertValues).toHaveBeenCalledWith(mapAssetAttachmentToDbRow(committedAttachment));
    expect(committed).toEqual(committedAttachment);
  });

  it("throws a stable error when record-version unique conflicts exhaust retries", async () => {
    const attachment = buildAttachment();
    const mockDb = createMockDb({
      transactionErrors: [recordVersionUniqueViolation(), recordVersionUniqueViolation(), recordVersionUniqueViolation()]
    });
    mockRuntime(mockDb.db);

    await expect(
      createDbAssetAttachmentRepository().createAssetAttachmentMetadata({
        attachment,
        metadataInput: metadataInputFromAttachment(attachment)
      })
    ).rejects.toThrow("asset_attachment_version_conflict");
    expect(mockDb.transaction).toHaveBeenCalledTimes(3);
  });

  it("throws a stable metadata conflict for non-version unique violations", async () => {
    const attachment = buildAttachment();
    const mockDb = createMockDb({
      transactionErrors: [uniqueViolation("asset_attachments_file_id_unique")]
    });
    mockRuntime(mockDb.db);

    await expect(
      createDbAssetAttachmentRepository().createAssetAttachmentMetadata({
        attachment,
        metadataInput: metadataInputFromAttachment(attachment)
      })
    ).rejects.toThrow("asset_attachment_metadata_conflict");
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  it("throws a stable error when no metadata row is inserted", async () => {
    const attachment = buildAttachment();
    const mockDb = createMockDb({ insertedRows: [] });
    mockRuntime(mockDb.db);

    await expect(
      createDbAssetAttachmentRepository().createAssetAttachmentMetadata({
        attachment,
        metadataInput: metadataInputFromAttachment(attachment)
      })
    ).rejects.toThrow("asset_attachment_metadata_not_created");
  });

  it("soft deletes only active attachment metadata and returns the deleted row", async () => {
    const active = buildAttachment();
    const deleted = buildAttachment({
      status: "deleted",
      deletedByUserId: "user-owner",
      deletedAt: "2026-05-29T03:00:00.000Z"
    });
    const mockDb = createMockDb({ updatedRows: [mapAssetAttachmentToDbRow(deleted) as AssetAttachmentDbRow] });
    mockRuntime(mockDb.db);

    const committed = await createDbAssetAttachmentRepository().softDeleteAssetAttachmentMetadata({
      assetAttachmentId: active.id,
      deletedByUserId: "user-owner"
    });

    expect(mockDb.updateSet).toHaveBeenCalledWith({
      status: "deleted",
      deletedByUserId: "user-owner",
      deletedAt: expect.any(String)
    });
    expect(mockDb.updateWhere).toHaveBeenCalledTimes(1);
    expect(mockDb.updateReturning).toHaveBeenCalledTimes(1);
    expect(committed).toEqual(deleted);
  });

  it("throws a stable error when no active row is soft deleted", async () => {
    const mockDb = createMockDb({ updatedRows: [] });
    mockRuntime(mockDb.db);

    await expect(
      createDbAssetAttachmentRepository().softDeleteAssetAttachmentMetadata({
        assetAttachmentId: "missing-attachment",
        deletedByUserId: "user-owner"
      })
    ).rejects.toThrow("asset_attachment_not_found");
  });
});

function buildAttachment(overrides: Partial<AssetAttachment> = {}): AssetAttachment {
  return {
    id: "asset-attachment-1",
    projectId: "project-jincheng",
    assetLockRecordId: "asset-lock-1",
    deliveryPackageId: "delivery-1",
    fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000",
    fileName: "reference.png",
    mime: "image/png",
    size: 4096,
    version: 1,
    attachmentType: "reference",
    uploadedByUserId: "user-head-writer",
    uploadedAt: "2026-05-29T00:00:00.000Z",
    status: "active",
    ...overrides
  };
}

function buildRecord(overrides: Partial<AssetLockRecord> = {}): AssetLockRecord {
  return {
    id: "asset-lock-db-only",
    projectId: "project-jincheng",
    deliveryPackageId: "delivery-1",
    episodeNos: [1, 2],
    assetName: "DB Only Mine Lift",
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

function metadataInputFromAttachment(attachment: AssetAttachment) {
  return {
    assetLockRecordId: attachment.assetLockRecordId,
    fileId: attachment.fileId,
    fileName: attachment.fileName,
    mime: attachment.mime,
    size: attachment.size,
    attachmentType: attachment.attachmentType,
    uploadedByUserId: attachment.uploadedByUserId,
    note: attachment.note
  };
}

function mockRuntime(db: unknown) {
  vi.mocked(getAssetLockDbRuntime).mockReturnValue({
    db,
    pool: {}
  } as ReturnType<typeof getAssetLockDbRuntime>);
}

function createMockDb(
  input: {
    insertedRows?: unknown[];
    updatedRows?: unknown[];
    selectResults?: unknown[][];
    transactionErrors?: unknown[];
    versionRows?: unknown[][];
  } = {}
) {
  const selectResults = [...(input.selectResults ?? [])];
  const transactionErrors = [...(input.transactionErrors ?? [])];
  const versionRows = [...(input.versionRows ?? [])];
  const orderBy = vi.fn(async () => selectResults.shift() ?? []);
  const from = vi.fn(() => ({ orderBy }));
  const selectVersionLimit = vi.fn(async () => versionRows.shift() ?? []);
  const selectVersionOrderBy = vi.fn(() => ({ limit: selectVersionLimit }));
  const selectVersionWhere = vi.fn(() => ({ orderBy: selectVersionOrderBy }));
  const selectVersionFrom = vi.fn(() => ({ where: selectVersionWhere }));
  const select = vi.fn((projection?: unknown) => (projection ? { from: selectVersionFrom } : { from }));
  const insertReturning = vi.fn(async () => input.insertedRows ?? []);
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));
  const updateReturning = vi.fn(async () => input.updatedRows ?? []);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const tx = {
    select,
    insert,
    update
  };
  const transaction = vi.fn(async (callback: (transactionClient: typeof tx) => Promise<unknown> | unknown) => {
    const error = transactionErrors.shift();

    if (error) {
      throw error;
    }

    return callback(tx);
  });
  const db = {
    select,
    insert,
    update,
    transaction
  };

  return {
    db,
    transaction,
    insertValues,
    insertReturning,
    selectVersionWhere,
    updateSet,
    updateWhere,
    updateReturning
  };
}

function recordVersionUniqueViolation() {
  return uniqueViolation("asset_attachments_record_version_unique");
}

function uniqueViolation(constraint: string) {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint
  });
}
