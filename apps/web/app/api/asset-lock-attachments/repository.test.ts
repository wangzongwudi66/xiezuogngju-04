import { describe, expect, it } from "vitest";
import { localAssetAttachmentRepository, resolveAssetAttachmentRepository } from "./repository";

describe("asset lock attachment repository resolver", () => {
  it("returns the local repository when attachment DB mode is not requested", () => {
    expect(resolveAssetAttachmentRepository({})).toBe(localAssetAttachmentRepository);
    expect(
      resolveAssetAttachmentRepository({
        ASSET_LOCK_RECORDS_REPOSITORY: "db",
        DATABASE_URL: "postgres://example.invalid/aigc"
      }).mode
    ).toBe("local");
  });

  it("fails closed when attachment DB mode is requested without record DB mode", () => {
    expect(() =>
      resolveAssetAttachmentRepository({
        ASSET_LOCK_ATTACHMENTS_REPOSITORY: "db",
        DATABASE_URL: "postgres://example.invalid/aigc"
      })
    ).toThrow("asset_attachment_record_db_required");
  });

  it("fails closed when attachment and record DB modes are requested without DATABASE_URL", () => {
    expect(() =>
      resolveAssetAttachmentRepository({
        ASSET_LOCK_ATTACHMENTS_REPOSITORY: "db",
        ASSET_LOCK_RECORDS_REPOSITORY: "db"
      })
    ).toThrow("asset_lock_record_database_url_required");
  });

  it("selects the DB repository when attachment DB mode, record DB mode, and DATABASE_URL are configured", () => {
    const repository = resolveAssetAttachmentRepository({
      ASSET_LOCK_ATTACHMENTS_REPOSITORY: "db",
      ASSET_LOCK_RECORDS_REPOSITORY: "db",
      DATABASE_URL: "postgres://example.invalid/aigc"
    });

    expect(repository).not.toBe(localAssetAttachmentRepository);
    expect(repository.mode).toBe("db");
  });
});
