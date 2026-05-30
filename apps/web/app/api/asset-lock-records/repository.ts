import type { AssetLockRecord, ScriptSourceBinding, WorkspaceState } from "@aigc/domain";
import { mutateDeliveryImportWorkspace, readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { createDbAssetLockRecordRepository } from "./db-repository";

export interface AssetLockRecordRepositorySnapshot {
  state: WorkspaceState;
  assetLockRecords: AssetLockRecord[];
  scriptSourceBindings: ScriptSourceBinding[];
}

export interface LocalAssetLockRecordRepository {
  mode: "local";
  read(): Promise<AssetLockRecordRepositorySnapshot>;
  mutate(
    mutate: (snapshot: AssetLockRecordRepositorySnapshot) => WorkspaceState
  ): Promise<AssetLockRecordRepositorySnapshot>;
}

export interface DbAssetLockRecordRepository {
  mode: "db";
  read(): Promise<AssetLockRecordRepositorySnapshot>;
  createAssetLockRecord(record: AssetLockRecord): Promise<AssetLockRecordRepositorySnapshot>;
  createAssetLockRecords(records: AssetLockRecord[]): Promise<AssetLockRecordRepositorySnapshot>;
  updateAssetLockRecord(record: AssetLockRecord): Promise<AssetLockRecordRepositorySnapshot>;
  createSourceBinding(binding: ScriptSourceBinding): Promise<AssetLockRecordRepositorySnapshot>;
  removeSourceBinding(id: string): Promise<AssetLockRecordRepositorySnapshot>;
}

export type AssetLockRecordRepository = LocalAssetLockRecordRepository | DbAssetLockRecordRepository;

const assetLockRecordRepositoryEnvKey = "ASSET_LOCK_RECORDS_REPOSITORY";
type AssetLockRecordRepositoryEnv = Record<string, string | undefined>;

export const localAssetLockRecordRepository: LocalAssetLockRecordRepository = {
  mode: "local",
  async read() {
    const workspace = await readDeliveryImportWorkspace();

    return toAssetLockRecordRepositorySnapshot(workspace.state);
  },
  async mutate(mutate) {
    const workspace = await mutateDeliveryImportWorkspace((state) => mutate(toAssetLockRecordRepositorySnapshot(state)));

    return toAssetLockRecordRepositorySnapshot(workspace.state);
  }
};

export function resolveAssetLockRecordRepository(env: AssetLockRecordRepositoryEnv = process.env): AssetLockRecordRepository {
  if (isAssetLockRecordDbRepositoryEnabled(env)) {
    return createDbAssetLockRecordRepository();
  }

  return localAssetLockRecordRepository;
}

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

function toAssetLockRecordRepositorySnapshot(state: WorkspaceState): AssetLockRecordRepositorySnapshot {
  return {
    state,
    assetLockRecords: state.assetLockRecords ?? [],
    scriptSourceBindings: state.scriptSourceBindings ?? []
  };
}
