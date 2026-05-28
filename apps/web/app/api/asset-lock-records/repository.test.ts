import { describe, expect, it } from "vitest";
import { localAssetLockRecordRepository, resolveAssetLockRecordRepository } from "./repository";

describe("asset lock record repository resolver", () => {
  it("returns the local repository when DATABASE_URL is missing even if DB mode is requested", () => {
    const repository = resolveAssetLockRecordRepository({
      ASSET_LOCK_RECORDS_REPOSITORY: "db"
    });

    expect(repository).toBe(localAssetLockRecordRepository);
    expect(repository.mode).toBe("local");
  });

  it("requires both explicit DB mode and DATABASE_URL before selecting the DB repository", () => {
    expect(
      resolveAssetLockRecordRepository({
        DATABASE_URL: "postgres://example.invalid/aigc"
      }).mode
    ).toBe("local");
    expect(
      resolveAssetLockRecordRepository({
        ASSET_LOCK_RECORDS_REPOSITORY: "db",
        DATABASE_URL: "postgres://example.invalid/aigc"
      }).mode
    ).toBe("db");
  });
});
