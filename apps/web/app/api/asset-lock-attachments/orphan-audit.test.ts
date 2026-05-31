import { describe, expect, it, vi } from "vitest";
import {
  createAssetAttachmentReferencedKeySet,
  hashAssetAttachmentAuditKey,
  runAssetAttachmentOrphanAudit
} from "./orphan-audit";
import type { AssetAttachmentReferencedRow } from "./orphan-audit";
import type { AssetAttachmentStorageAuditAdapter, AssetAttachmentStorageAuditObject } from "./storage-audit";

const now = new Date("2026-05-31T08:00:00.000Z");

describe("asset attachment orphan audit", () => {
  it("compares provider objects against active, deleted, and legacy referenced keys", async () => {
    const rows: AssetAttachmentReferencedRow[] = [
      row({ status: "active", storageKey: "asset-lock-attachments/active.png" }),
      row({ status: "deleted", storageKey: "asset-lock-attachments/deleted.pdf" }),
      row({
        fileId: "asset-att-123e4567-e89b-12d3-a456-426614174099",
        fileName: "legacy-name.webp",
        status: "active",
        storageKey: null
      })
    ];
    const youngKey = "asset-bucket/https-s3.example.invalid/raw-young.png";
    const oldKey = "asset-bucket/https-s3.example.invalid/raw-old.png";
    const unknownAgeKey = "asset-bucket/https-s3.example.invalid/raw-unknown.pdf";
    const report = await runAssetAttachmentOrphanAudit({
      adapter: createMemoryAdapter([
        object({ key: "asset-lock-attachments/active.png", sizeBytes: 1, ageHours: 72 }),
        object({ key: "asset-lock-attachments/deleted.pdf", sizeBytes: 2, ageHours: 72 }),
        object({ key: "asset-att-123e4567-e89b-12d3-a456-426614174099.webp", sizeBytes: 3, ageHours: 72 }),
        object({ key: youngKey, sizeBytes: 10, ageHours: 1 }),
        object({ key: oldKey, sizeBytes: 20, ageHours: 48 }),
        { key: unknownAgeKey, sizeBytes: 30 }
      ]),
      referencedRows: rows,
      now
    });
    const serializedReport = JSON.stringify(report);

    expect(report.counts).toEqual({
      providerObjectCount: 6,
      referencedKeyCount: 3,
      referencedObjectCount: 3,
      unreferencedObjectCount: 3,
      orphanCandidateCount: 1,
      youngObjectCount: 1,
      unknownAgeObjectCount: 1,
      omittedItemCount: 0
    });
    expect(report.totalSizeBytes).toBe(20);
    expect(report.reasonCounts).toEqual({
      orphan_candidate: 1,
      young: 1,
      unknown_age: 1
    });
    expect(report.ageBuckets).toEqual({
      "1h_24h": 1,
      "1d_7d": 1
    });
    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyHash: hashAssetAttachmentAuditKey(youngKey),
          sizeBytes: 10,
          reason: "young",
          ageMs: 60 * 60 * 1000,
          ageBucket: "1h_24h"
        }),
        expect.objectContaining({
          keyHash: hashAssetAttachmentAuditKey(oldKey),
          sizeBytes: 20,
          reason: "orphan_candidate",
          ageMs: 48 * 60 * 60 * 1000,
          ageBucket: "1d_7d"
        }),
        expect.objectContaining({
          keyHash: hashAssetAttachmentAuditKey(unknownAgeKey),
          sizeBytes: 30,
          reason: "unknown_age"
        })
      ])
    );
    expect(report.items).toHaveLength(3);
    expect(report.items.every((item) => item.keyHash.length === 64)).toBe(true);
    expect(serializedReport).not.toContain(youngKey);
    expect(serializedReport).not.toContain(oldKey);
    expect(serializedReport).not.toContain(unknownAgeKey);
    expect(serializedReport).not.toContain("asset-bucket");
    expect(serializedReport).not.toContain("https-s3.example.invalid");
  });

  it("uses storage_key before legacy fallback", async () => {
    const report = await runAssetAttachmentOrphanAudit({
      adapter: createMemoryAdapter([object({ key: "stored/key.pdf", sizeBytes: 10, ageHours: 72 })]),
      referencedRows: [
        row({
          fileId: "asset-att-123e4567-e89b-12d3-a456-426614174088",
          fileName: "legacy.pdf",
          status: "active",
          storageKey: "stored/key.pdf"
        })
      ],
      now
    });

    expect(report.counts.referencedObjectCount).toBe(1);
    expect(report.counts.orphanCandidateCount).toBe(0);
  });

  it("allows the grace period to be configured", async () => {
    const report = await runAssetAttachmentOrphanAudit({
      adapter: createMemoryAdapter([object({ key: "older-than-default.png", sizeBytes: 10, ageHours: 48 })]),
      referencedRows: [],
      gracePeriodMs: 72 * 60 * 60 * 1000,
      now
    });

    expect(report.counts.orphanCandidateCount).toBe(0);
    expect(report.counts.youngObjectCount).toBe(1);
    expect(report.items[0]).toEqual(
      expect.objectContaining({
        reason: "young",
        ageMs: 48 * 60 * 60 * 1000
      })
    );
  });

  it("falls back to fileId plus fileName extension when storage_key is missing", () => {
    const keys = createAssetAttachmentReferencedKeySet([
      row({
        fileId: "asset-att-123e4567-e89b-12d3-a456-426614174077",
        fileName: "legacy-source.png",
        status: "deleted",
        storageKey: null
      })
    ]);

    expect(keys.has("asset-att-123e4567-e89b-12d3-a456-426614174077.png")).toBe(true);
  });

  it("does not call delete or cleanup hooks", async () => {
    const deleteObject = vi.fn();
    const adapter = {
      listObjects: () => createObjectIterable([object({ key: "unreferenced.png", sizeBytes: 5, ageHours: 72 })]),
      delete: deleteObject
    };

    const report = await runAssetAttachmentOrphanAudit({
      adapter,
      referencedRows: [],
      now
    });

    expect(report.counts.orphanCandidateCount).toBe(1);
    expect(deleteObject).not.toHaveBeenCalled();
  });
});

function row(input: Partial<AssetAttachmentReferencedRow> = {}): AssetAttachmentReferencedRow {
  return {
    fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000",
    fileName: "upload.png",
    status: "active",
    ...input
  };
}

function object(input: { key: string; sizeBytes: number; ageHours: number }): AssetAttachmentStorageAuditObject {
  return {
    key: input.key,
    sizeBytes: input.sizeBytes,
    lastModified: new Date(now.getTime() - input.ageHours * 60 * 60 * 1000)
  };
}

function createMemoryAdapter(objects: AssetAttachmentStorageAuditObject[]): AssetAttachmentStorageAuditAdapter {
  return {
    listObjects: () => createObjectIterable(objects)
  };
}

async function* createObjectIterable(objects: AssetAttachmentStorageAuditObject[]) {
  for (const object of objects) {
    yield object;
  }
}
