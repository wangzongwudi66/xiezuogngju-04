const assetLockRecordRepositoryEnvKey = "ASSET_LOCK_RECORDS_REPOSITORY";

export type AssetLockRecordRepositoryEnv = Record<string, string | undefined>;

export function isAssetLockRecordDbRepositoryEnabled(env: AssetLockRecordRepositoryEnv = process.env) {
  if (!isAssetLockRecordDbRepositoryRequested(env)) {
    return false;
  }

  if (!env.DATABASE_URL?.trim()) {
    throw new Error("asset_lock_record_database_url_required");
  }

  return true;
}

function isAssetLockRecordDbRepositoryRequested(env: AssetLockRecordRepositoryEnv) {
  return env[assetLockRecordRepositoryEnvKey]?.trim().toLowerCase() === "db";
}
