import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAssetAttachmentStorageBackfillPlan } from "./storage-backfill";
import type { AssetAttachmentMetadataAuditReadAdapter, AssetAttachmentMetadataAuditRow } from "./metadata-audit";

const now = new Date("2026-05-31T08:00:00.000Z");
const bytes = new Uint8Array([1, 2, 3]);
const checksumSha256 = sha256Hex(bytes);

describe("asset attachment storage metadata backfill eligibility", () => {
  it("plans a write only for null storage_key and checksum_sha256 fields", async () => {
    const plan = await buildAssetAttachmentStorageBackfillPlan({
      adapter: createMemoryAdapter(new Map([["asset-att-123e4567-e89b-12d3-a456-426614174000.png", bytes]])),
      rows: [row({ storageKey: null, checksumSha256: null })],
      now
    });

    expect(plan.counts.writableRowCount).toBe(1);
    expect(plan.counts.storageKeyWriteCount).toBe(1);
    expect(plan.counts.checksumWriteCount).toBe(1);
    expect(plan.writes).toEqual([
      {
        row: expect.objectContaining({ id: "attachment-default", storageKey: null, checksumSha256: null }),
        targetStorageKey: "asset-att-123e4567-e89b-12d3-a456-426614174000.png",
        targetChecksumSha256: checksumSha256
      }
    ]);
  });

  it("plans a checksum-only write when storage_key is already persisted", async () => {
    const storageKey = "stored/asset-att-123e4567-e89b-12d3-a456-426614174000.png";
    const plan = await buildAssetAttachmentStorageBackfillPlan({
      adapter: createMemoryAdapter(new Map([[storageKey, bytes]])),
      rows: [row({ storageKey, checksumSha256: null })],
      now
    });

    expect(plan.counts.writableRowCount).toBe(1);
    expect(plan.counts.storageKeyWriteCount).toBe(0);
    expect(plan.counts.checksumWriteCount).toBe(1);
    expect(plan.writes[0]).toEqual(
      expect.objectContaining({
        targetStorageKey: storageKey,
        targetChecksumSha256: checksumSha256
      })
    );
  });

  it("skips ambiguous candidate matches", async () => {
    const plan = await buildAssetAttachmentStorageBackfillPlan({
      adapter: createMemoryAdapter(
        new Map([
          ["current/asset-att-123e4567-e89b-12d3-a456-426614174000.png", bytes],
          ["asset-att-123e4567-e89b-12d3-a456-426614174000.png", bytes]
        ]),
        "current"
      ),
      rows: [row({ storageKey: null, checksumSha256: null })],
      now
    });

    expect(plan.reasonCounts.ambiguous_candidate_match).toBe(1);
    expect(plan.writes).toHaveLength(0);
  });

  it("skips missing objects", async () => {
    const plan = await buildAssetAttachmentStorageBackfillPlan({
      adapter: createMemoryAdapter(new Map()),
      rows: [row({ storageKey: null, checksumSha256: null })],
      now
    });

    expect(plan.reasonCounts.missing_object).toBe(1);
    expect(plan.writes).toHaveLength(0);
  });

  it("skips read failures without exposing the thrown message", async () => {
    const plan = await buildAssetAttachmentStorageBackfillPlan({
      adapter: {
        makeKey: ({ fileId, extension }) => `${fileId}${extension}`,
        get: async () => {
          throw new Error("private-bucket raw-storage-key postgres://user:pass@host/db");
        }
      },
      rows: [row({ storageKey: null, checksumSha256: null })],
      now
    });
    const serialized = JSON.stringify(plan);

    expect(plan.reasonCounts.read_failed).toBe(1);
    expect(plan.writes).toHaveLength(0);
    expect(serialized).not.toContain("private-bucket");
    expect(serialized).not.toContain("raw-storage-key");
    expect(serialized).not.toContain("postgres://user:pass@host/db");
  });

  it("skips size mismatches", async () => {
    const plan = await buildAssetAttachmentStorageBackfillPlan({
      adapter: createMemoryAdapter(new Map([["asset-att-123e4567-e89b-12d3-a456-426614174000.png", new Uint8Array([1, 2])]])),
      rows: [row({ storageKey: null, checksumSha256: null })],
      now
    });

    expect(plan.reasonCounts.size_mismatch).toBe(1);
    expect(plan.writes).toHaveLength(0);
  });

  it("skips checksum mismatches against an existing checksum", async () => {
    const plan = await buildAssetAttachmentStorageBackfillPlan({
      adapter: createMemoryAdapter(new Map([["asset-att-123e4567-e89b-12d3-a456-426614174000.png", bytes]])),
      rows: [row({ storageKey: null, checksumSha256: sha256Hex(new Uint8Array([9, 9, 9])) })],
      now
    });

    expect(plan.reasonCounts.checksum_mismatch).toBe(1);
    expect(plan.writes).toHaveLength(0);
  });

  it("skips invalid existing checksum formats", async () => {
    const plan = await buildAssetAttachmentStorageBackfillPlan({
      adapter: createMemoryAdapter(new Map([["asset-att-123e4567-e89b-12d3-a456-426614174000.png", bytes]])),
      rows: [row({ storageKey: null, checksumSha256: checksumSha256.toUpperCase() })],
      now
    });

    expect(plan.reasonCounts.checksum_invalid_format).toBe(1);
    expect(plan.writes).toHaveLength(0);
  });

  it("skips unsafe keys before reading storage", async () => {
    const get = async () => bytes;
    const plan = await buildAssetAttachmentStorageBackfillPlan({
      adapter: {
        makeKey: ({ fileId, extension }) => `${fileId}${extension}`,
        get
      },
      rows: [row({ storageKey: "../asset-att-123e4567-e89b-12d3-a456-426614174000.png", checksumSha256: null })],
      now
    });

    expect(plan.reasonCounts.unsafe_key).toBe(1);
    expect(plan.writes).toHaveLength(0);
  });

  it("skips target keys already persisted on another row", async () => {
    const storageKey = "asset-att-123e4567-e89b-12d3-a456-426614174000.png";
    const plan = await buildAssetAttachmentStorageBackfillPlan({
      adapter: createMemoryAdapter(new Map([[storageKey, bytes]])),
      rows: [
        row({ id: "attachment-existing", storageKey, checksumSha256 }),
        row({ id: "attachment-backfill", storageKey: null, checksumSha256: null })
      ],
      now
    });

    expect(plan.reasonCounts.duplicate_storage_key).toBe(1);
    expect(plan.writes).toHaveLength(0);
  });

  it("skips duplicate target keys within the same run", async () => {
    const storageKey = "asset-att-123e4567-e89b-12d3-a456-426614174000.png";
    const plan = await buildAssetAttachmentStorageBackfillPlan({
      adapter: createMemoryAdapter(new Map([[storageKey, bytes]])),
      rows: [
        row({ id: "attachment-a", storageKey: null, checksumSha256: null }),
        row({ id: "attachment-b", storageKey: null, checksumSha256: null })
      ],
      now
    });

    expect(plan.reasonCounts.duplicate_target_key).toBe(2);
    expect(plan.writes).toHaveLength(0);
  });
});

function row(input: Partial<AssetAttachmentMetadataAuditRow> = {}): AssetAttachmentMetadataAuditRow {
  return {
    id: "attachment-default",
    fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000",
    fileName: "upload.png",
    status: "active",
    sizeBytes: bytes.byteLength,
    storageKey: null,
    checksumSha256,
    ...input
  };
}

function createMemoryAdapter(objects: Map<string, Uint8Array>, prefix = ""): AssetAttachmentMetadataAuditReadAdapter {
  return {
    makeKey: ({ fileId, extension }) => (prefix ? `${prefix}/${fileId}${extension}` : `${fileId}${extension}`),
    async get({ key }) {
      return objects.get(key) ?? null;
    }
  };
}

function sha256Hex(input: Uint8Array) {
  return createHash("sha256").update(input).digest("hex");
}
