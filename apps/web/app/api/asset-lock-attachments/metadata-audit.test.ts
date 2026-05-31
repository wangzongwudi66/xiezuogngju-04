import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createAssetAttachmentMetadataAuditCandidates,
  hashAssetAttachmentMetadataAuditValue,
  runAssetAttachmentMetadataAudit
} from "./metadata-audit";
import type { AssetAttachmentMetadataAuditReadAdapter, AssetAttachmentMetadataAuditRow } from "./metadata-audit";

const now = new Date("2026-05-31T08:00:00.000Z");
const defaultBytes = new Uint8Array([1, 2, 3]);
const defaultChecksum = sha256Hex(defaultBytes);

describe("asset attachment metadata audit", () => {
  it("includes active and deleted rows while skipping other statuses", async () => {
    const report = await runAssetAttachmentMetadataAudit({
      adapter: createMemoryAdapter(
        new Map([
          ["asset-att-123e4567-e89b-12d3-a456-426614174000.png", defaultBytes],
          ["asset-att-123e4567-e89b-12d3-a456-426614174001.png", defaultBytes],
          ["asset-att-123e4567-e89b-12d3-a456-426614174002.png", defaultBytes]
        ])
      ),
      rows: [
        row({ status: "active", fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000" }),
        row({ status: "deleted", fileId: "asset-att-123e4567-e89b-12d3-a456-426614174001" }),
        row({ status: "draft", fileId: "asset-att-123e4567-e89b-12d3-a456-426614174002" })
      ],
      now
    });

    expect(report.generatedAt).toBe(now.toISOString());
    expect(report.counts).toEqual({
      inputRowCount: 3,
      referencedRowCount: 2,
      skippedRowCount: 1,
      persistedStorageKeyRowCount: 0,
      candidateStorageKeyRowCount: 2,
      verifiedRowCount: 2,
      readableRowCount: 2
    });
    expect(report.statusCounts).toEqual({ active: 1, deleted: 1, draft: 1 });
    expect(report.sizeTotals).toEqual({
      expectedSizeBytes: 6,
      verifiedSizeBytes: 6,
      missingExpectedSizeBytes: 0,
      mismatchedExpectedSizeBytes: 0,
      mismatchedActualSizeBytes: 0
    });
  });

  it("uses a persisted storage_key before generated candidates", async () => {
    const get = vi.fn(async ({ key }: { key: string }) => (key === "stored/asset-att-123e4567-e89b-12d3-a456-426614174000.png" ? defaultBytes : null));
    const report = await runAssetAttachmentMetadataAudit({
      adapter: {
        makeKey: ({ fileId, extension }) => `current/${fileId}${extension}`,
        get
      },
      rows: [
        row({
          storageKey: "stored\\asset-att-123e4567-e89b-12d3-a456-426614174000.png",
          fileName: "upload.png"
        })
      ],
      now
    });

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({ key: "stored/asset-att-123e4567-e89b-12d3-a456-426614174000.png" });
    expect(report.counts.verifiedRowCount).toBe(1);
  });

  it("creates null storage_key candidates in current, bare legacy, and legacy prefix order", () => {
    const candidates = createAssetAttachmentMetadataAuditCandidates({
      adapter: {
        makeKey: ({ fileId, extension }) => `current-prefix/${fileId}${extension}`
      },
      row: row({
        fileId: "asset-att-123e4567-e89b-12d3-a456-426614174099",
        fileName: "legacy-source.webp",
        storageKey: null
      }),
      legacyPrefixes: ["legacy-a", "legacy-b\\"]
    });

    expect(candidates.map(({ key }) => key)).toEqual([
      "current-prefix/asset-att-123e4567-e89b-12d3-a456-426614174099.webp",
      "asset-att-123e4567-e89b-12d3-a456-426614174099.webp",
      "legacy-a/asset-att-123e4567-e89b-12d3-a456-426614174099.webp",
      "legacy-b/asset-att-123e4567-e89b-12d3-a456-426614174099.webp"
    ]);
  });

  it("verifies an existing object when size and checksum match", async () => {
    const report = await runAssetAttachmentMetadataAudit({
      adapter: createMemoryAdapter(new Map([["asset-att-123e4567-e89b-12d3-a456-426614174000.png", defaultBytes]])),
      rows: [row()],
      now
    });

    expect(report.counts.verifiedRowCount).toBe(1);
    expect(report.reasonCounts).toEqual({
      missing_object: 0,
      read_failed: 0,
      size_mismatch: 0,
      checksum_missing: 0,
      checksum_invalid_format: 0,
      checksum_mismatch: 0,
      unsafe_key: 0,
      duplicate_storage_key: 0,
      storage_key_missing: 1,
      backfill_candidate: 1,
      ambiguous_candidate_match: 0
    });
    expect(report.items).toEqual([
      expect.objectContaining({
        reasons: ["storage_key_missing", "backfill_candidate"],
        keyHash: hashAssetAttachmentMetadataAuditValue("asset-att-123e4567-e89b-12d3-a456-426614174000.png")
      })
    ]);
  });

  it("reports missing objects without exposing raw keys", async () => {
    const report = await runAssetAttachmentMetadataAudit({
      adapter: createMemoryAdapter(new Map()),
      rows: [row({ storageKey: "missing/asset-att-123e4567-e89b-12d3-a456-426614174000.png" })],
      now
    });
    const serializedReport = JSON.stringify(report);

    expect(report.reasonCounts.missing_object).toBe(1);
    expect(report.sizeTotals.missingExpectedSizeBytes).toBe(3);
    expect(serializedReport).not.toContain("missing/asset-att-123e4567-e89b-12d3-a456-426614174000.png");
  });

  it("reports size mismatches", async () => {
    const report = await runAssetAttachmentMetadataAudit({
      adapter: createMemoryAdapter(new Map([["asset-att-123e4567-e89b-12d3-a456-426614174000.png", new Uint8Array([1, 2])]])),
      rows: [row()],
      now
    });

    expect(report.reasonCounts.size_mismatch).toBe(1);
    expect(report.sizeTotals.mismatchedExpectedSizeBytes).toBe(3);
    expect(report.sizeTotals.mismatchedActualSizeBytes).toBe(2);
    expect(report.items).toEqual([
      expect.objectContaining({
        reasons: ["size_mismatch"]
      })
    ]);
  });

  it("reports checksum missing as a backfill candidate without raw checksum output", async () => {
    const report = await runAssetAttachmentMetadataAudit({
      adapter: createMemoryAdapter(new Map([["asset-att-123e4567-e89b-12d3-a456-426614174000.png", defaultBytes]])),
      rows: [row({ checksumSha256: null })],
      now
    });
    const serializedReport = JSON.stringify(report);

    expect(report.reasonCounts.checksum_missing).toBe(1);
    expect(report.reasonCounts.backfill_candidate).toBe(2);
    expect(report.counts.verifiedRowCount).toBe(0);
    expect(serializedReport).not.toContain(defaultChecksum);
  });

  it("reports uppercase checksum_sha256 as invalid format", async () => {
    const report = await runAssetAttachmentMetadataAudit({
      adapter: createMemoryAdapter(new Map([["asset-att-123e4567-e89b-12d3-a456-426614174000.png", defaultBytes]])),
      rows: [row({ checksumSha256: defaultChecksum.toUpperCase() })],
      now
    });

    expect(report.reasonCounts.checksum_invalid_format).toBe(1);
    expect(report.reasonCounts.checksum_mismatch).toBe(0);
    expect(report.counts.verifiedRowCount).toBe(0);
  });

  it("reports checksum mismatches", async () => {
    const report = await runAssetAttachmentMetadataAudit({
      adapter: createMemoryAdapter(new Map([["asset-att-123e4567-e89b-12d3-a456-426614174000.png", defaultBytes]])),
      rows: [row({ checksumSha256: sha256Hex(new Uint8Array([9, 9, 9])) })],
      now
    });

    expect(report.reasonCounts.checksum_mismatch).toBe(1);
    expect(report.counts.verifiedRowCount).toBe(0);
  });

  it("does not read unsafe storage keys", async () => {
    const get = vi.fn(async () => defaultBytes);
    const report = await runAssetAttachmentMetadataAudit({
      adapter: {
        makeKey: ({ fileId, extension }) => `${fileId}${extension}`,
        get
      },
      rows: [row({ storageKey: "../asset-att-123e4567-e89b-12d3-a456-426614174000.png" })],
      now
    });

    expect(report.reasonCounts.unsafe_key).toBe(1);
    expect(get).not.toHaveBeenCalled();
  });

  it("reports duplicate persisted storage keys for active and deleted rows", async () => {
    const duplicatedKey = "same/asset-att-123e4567-e89b-12d3-a456-426614174000.png";
    const report = await runAssetAttachmentMetadataAudit({
      adapter: createMemoryAdapter(new Map([[duplicatedKey, defaultBytes]])),
      rows: [
        row({ id: "attachment-a", status: "active", storageKey: duplicatedKey }),
        row({ id: "attachment-b", status: "deleted", storageKey: duplicatedKey }),
        row({ id: "attachment-c", status: "draft", storageKey: duplicatedKey })
      ],
      now
    });

    expect(report.reasonCounts.duplicate_storage_key).toBe(2);
    expect(report.items.filter((item) => item.reasons.includes("duplicate_storage_key"))).toHaveLength(2);
  });

  it("reports ambiguous matches when multiple null storage_key candidates match", async () => {
    const report = await runAssetAttachmentMetadataAudit({
      adapter: createMemoryAdapter(
        new Map([
          ["current/asset-att-123e4567-e89b-12d3-a456-426614174000.png", defaultBytes],
          ["asset-att-123e4567-e89b-12d3-a456-426614174000.png", defaultBytes],
          ["legacy/asset-att-123e4567-e89b-12d3-a456-426614174000.png", defaultBytes]
        ]),
        "current"
      ),
      rows: [row({ storageKey: null })],
      legacyPrefixes: ["legacy"],
      now
    });

    expect(report.reasonCounts.ambiguous_candidate_match).toBe(1);
    expect(report.reasonCounts.storage_key_missing).toBe(0);
    expect(report.counts.verifiedRowCount).toBe(0);
  });

  it("reports read failures separately from missing objects", async () => {
    const report = await runAssetAttachmentMetadataAudit({
      adapter: {
        makeKey: ({ fileId, extension }) => `${fileId}${extension}`,
        get: async () => {
          throw new Error("private-bucket https://s3.example.invalid postgres://user:pass@host/db raw-key");
        }
      },
      rows: [row()],
      now
    });
    const serializedReport = JSON.stringify(report);

    expect(report.reasonCounts.read_failed).toBe(1);
    expect(report.reasonCounts.missing_object).toBe(0);
    expect(serializedReport).not.toContain("private-bucket");
    expect(serializedReport).not.toContain("https://s3.example.invalid");
    expect(serializedReport).not.toContain("postgres://user:pass@host/db");
    expect(serializedReport).not.toContain("raw-key");
  });

  it("bounds report items by maxItems", async () => {
    const report = await runAssetAttachmentMetadataAudit({
      adapter: createMemoryAdapter(new Map()),
      rows: [
        row({ id: "attachment-a", fileId: "asset-att-123e4567-e89b-12d3-a456-426614174001" }),
        row({ id: "attachment-b", fileId: "asset-att-123e4567-e89b-12d3-a456-426614174002" })
      ],
      maxItems: 1,
      now
    });

    expect(report.items).toHaveLength(1);
    expect(report.omittedItemCount).toBeGreaterThan(0);
  });
});

function row(input: Partial<AssetAttachmentMetadataAuditRow> = {}): AssetAttachmentMetadataAuditRow {
  return {
    id: "attachment-default",
    fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000",
    fileName: "upload.png",
    status: "active",
    sizeBytes: defaultBytes.byteLength,
    checksumSha256: defaultChecksum,
    storageKey: null,
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

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
