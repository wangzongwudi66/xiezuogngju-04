import { describe, expect, it } from "vitest";
import { localAssetAttachmentRepository, resolveAssetAttachmentRepository } from "./repository";

describe("asset lock attachment repository resolver", () => {
  it("returns the local repository when DATABASE_URL is missing even if DB mode is requested", () => {
    const repository = resolveAssetAttachmentRepository({
      ASSET_LOCK_ATTACHMENTS_REPOSITORY: "db",
      ASSET_LOCK_RECORDS_REPOSITORY: "db"
    });

    expect(repository).toBe(localAssetAttachmentRepository);
    expect(repository.mode).toBe("local");
  });

  it("falls back to local when attachment DB mode is requested without record DB mode", () => {
    const repository = resolveAssetAttachmentRepository({
      ASSET_LOCK_ATTACHMENTS_REPOSITORY: "db",
      DATABASE_URL: "postgres://example.invalid/aigc"
    });

    expect(repository).toBe(localAssetAttachmentRepository);
    expect(repository.mode).toBe("local");
  });

  it("requires attachment DB mode, record DB mode, and DATABASE_URL before selecting the DB repository", () => {
    expect(
      resolveAssetAttachmentRepository({
        DATABASE_URL: "postgres://example.invalid/aigc"
      }).mode
    ).toBe("local");
    expect(
      resolveAssetAttachmentRepository({
        ASSET_LOCK_ATTACHMENTS_REPOSITORY: "db",
        ASSET_LOCK_RECORDS_REPOSITORY: "db",
        DATABASE_URL: "postgres://example.invalid/aigc"
      }).mode
    ).toBe("db");
  });
});
