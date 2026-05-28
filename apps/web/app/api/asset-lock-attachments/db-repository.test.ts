import { describe, expect, it } from "vitest";
import { mapAssetAttachmentRows, type AssetAttachmentDbRow } from "./db-repository";

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
});
