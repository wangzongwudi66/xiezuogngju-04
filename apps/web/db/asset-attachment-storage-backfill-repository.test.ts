import { describe, expect, it, vi } from "vitest";
import { writeAssetAttachmentStorageBackfillBatch } from "./asset-attachment-storage-backfill-repository";
import type { AssetLockDb } from "./runtime";
import type { AssetAttachmentStorageBackfillWrite } from "../app/api/asset-lock-attachments/storage-backfill";

describe("asset attachment storage backfill repository", () => {
  it("conditionally updates only null storage metadata and verifies the batch", async () => {
    const write = backfillWrite();
    const mockDb = createMockDb({
      updatedRows: [{ id: write.row.id }],
      selectResults: [
        [
          {
            id: write.row.id,
            storageKey: write.targetStorageKey,
            checksumSha256: write.targetChecksumSha256
          }
        ],
        [{ id: write.row.id, storageKey: write.targetStorageKey }]
      ]
    });

    const result = await writeAssetAttachmentStorageBackfillBatch(mockDb.db as unknown as AssetLockDb, [write]);

    expect(result).toEqual({ attemptedRowCount: 1, updatedRowCount: 1 });
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.updateSet).toHaveBeenCalledWith({
      storageKey: write.targetStorageKey,
      checksumSha256: write.targetChecksumSha256
    });
    expect(mockDb.updateWhere).toHaveBeenCalledTimes(1);
    expect(mockDb.selectWhere).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite non-null storage_key when backfilling checksum_sha256", async () => {
    const write = backfillWrite({
      row: {
        storageKey: "stored/asset-att-123e4567-e89b-12d3-a456-426614174000.png",
        checksumSha256: null
      },
      targetStorageKey: "stored/asset-att-123e4567-e89b-12d3-a456-426614174000.png"
    });
    const mockDb = createMockDb({
      updatedRows: [{ id: write.row.id }],
      selectResults: [
        [
          {
            id: write.row.id,
            storageKey: write.targetStorageKey,
            checksumSha256: write.targetChecksumSha256
          }
        ],
        [{ id: write.row.id, storageKey: write.targetStorageKey }]
      ]
    });

    await writeAssetAttachmentStorageBackfillBatch(mockDb.db as unknown as AssetLockDb, [write]);

    expect(mockDb.updateSet).toHaveBeenCalledWith({
      checksumSha256: write.targetChecksumSha256
    });
  });

  it("throws a stable error when the conditional update matches no rows", async () => {
    const mockDb = createMockDb({ updatedRows: [] });

    await expect(writeAssetAttachmentStorageBackfillBatch(mockDb.db as unknown as AssetLockDb, [backfillWrite()])).rejects.toThrow(
      "asset_attachment_storage_backfill_no_rows_updated"
    );
  });

  it("throws a stable error when post-update verification fails", async () => {
    const write = backfillWrite();
    const mockDb = createMockDb({
      updatedRows: [{ id: write.row.id }],
      selectResults: [
        [
          {
            id: write.row.id,
            storageKey: write.targetStorageKey,
            checksumSha256: "1".repeat(64)
          }
        ],
        [{ id: write.row.id, storageKey: write.targetStorageKey }]
      ]
    });

    await expect(writeAssetAttachmentStorageBackfillBatch(mockDb.db as unknown as AssetLockDb, [write])).rejects.toThrow(
      "asset_attachment_storage_backfill_verification_failed"
    );
  });
});

function backfillWrite(
  input: {
    row?: Partial<AssetAttachmentStorageBackfillWrite["row"]>;
    targetStorageKey?: string;
    targetChecksumSha256?: string;
  } = {}
): AssetAttachmentStorageBackfillWrite {
  return {
    row: {
      id: "attachment-1",
      fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000",
      fileName: "upload.png",
      status: "active",
      sizeBytes: 3,
      storageKey: null,
      checksumSha256: null,
      ...input.row
    },
    targetStorageKey: input.targetStorageKey ?? "asset-att-123e4567-e89b-12d3-a456-426614174000.png",
    targetChecksumSha256: input.targetChecksumSha256 ?? "0".repeat(64)
  };
}

function createMockDb(input: { updatedRows?: unknown[]; selectResults?: unknown[][] } = {}) {
  const selectResults = [...(input.selectResults ?? [])];
  const updateReturning = vi.fn(async () => input.updatedRows ?? []);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const selectWhere = vi.fn(async () => selectResults.shift() ?? []);
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));
  const tx = {
    update,
    select
  };
  const transaction = vi.fn(async (callback: (transactionClient: typeof tx) => Promise<unknown> | unknown) => callback(tx));
  const db = {
    transaction
  };

  return {
    db,
    transaction,
    updateSet,
    updateWhere,
    selectWhere
  };
}
