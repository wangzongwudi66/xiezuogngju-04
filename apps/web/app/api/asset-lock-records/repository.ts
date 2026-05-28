import type { AssetLockRecord, ScriptSourceBinding, WorkspaceState } from "@aigc/domain";
import { mutateDeliveryImportWorkspace, readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";

export interface AssetLockRecordRepositorySnapshot {
  state: WorkspaceState;
  assetLockRecords: AssetLockRecord[];
  scriptSourceBindings: ScriptSourceBinding[];
}

export interface AssetLockRecordRepository {
  read(): Promise<AssetLockRecordRepositorySnapshot>;
  mutate(
    mutate: (snapshot: AssetLockRecordRepositorySnapshot) => WorkspaceState
  ): Promise<AssetLockRecordRepositorySnapshot>;
}

export const localAssetLockRecordRepository: AssetLockRecordRepository = {
  async read() {
    const workspace = await readDeliveryImportWorkspace();

    return toAssetLockRecordRepositorySnapshot(workspace.state);
  },
  async mutate(mutate) {
    const workspace = await mutateDeliveryImportWorkspace((state) => mutate(toAssetLockRecordRepositorySnapshot(state)));

    return toAssetLockRecordRepositorySnapshot(workspace.state);
  }
};

function toAssetLockRecordRepositorySnapshot(state: WorkspaceState): AssetLockRecordRepositorySnapshot {
  return {
    state,
    assetLockRecords: state.assetLockRecords ?? [],
    scriptSourceBindings: state.scriptSourceBindings ?? []
  };
}
