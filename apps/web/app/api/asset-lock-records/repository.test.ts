import { describe, expect, it } from "vitest";
import { localAssetLockRecordRepository, resolveAssetLockRecordRepository } from "./repository";

describe("asset lock record repository resolver", () => {
  it("returns the local repository when DB mode is not requested", () => {
    expect(resolveAssetLockRecordRepository({})).toBe(localAssetLockRecordRepository);
    expect(
      resolveAssetLockRecordRepository({
        DATABASE_URL: "postgres://example.invalid/aigc"
      }).mode
    ).toBe("local");
  });

  it("fails closed when DB mode is requested without DATABASE_URL", () => {
    expect(() =>
      resolveAssetLockRecordRepository({
        ASSET_LOCK_RECORDS_REPOSITORY: "db"
      })
    ).toThrow("asset_lock_record_database_url_required");
  });

  it("selects the DB repository when DB mode and DATABASE_URL are both configured", () => {
    const repository = resolveAssetLockRecordRepository({
      ASSET_LOCK_RECORDS_REPOSITORY: "db",
      DATABASE_URL: "postgres://example.invalid/aigc"
    });

    expect(repository).not.toBe(localAssetLockRecordRepository);
    expect(repository.mode).toBe("db");
  });
});
