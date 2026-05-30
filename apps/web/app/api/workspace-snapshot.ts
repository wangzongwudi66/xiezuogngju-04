import type {
  AssetLockRecord,
  DeliveryPackage,
  DeliveryPackageEpisode,
  ScriptSourceBinding,
  WorkspaceState
} from "@aigc/domain";

export interface DbWorkspaceSnapshotOverlay {
  assetLockRecords: AssetLockRecord[];
  scriptSourceBindings: ScriptSourceBinding[];
  deliveryPackages: DeliveryPackage[];
  deliveryPackageEpisodes: DeliveryPackageEpisode[];
}

export function composeDbWorkspaceSnapshotOverlay(
  localState: WorkspaceState,
  overlay: DbWorkspaceSnapshotOverlay
): WorkspaceState {
  return {
    ...localState,
    assetLockRecords: overlay.assetLockRecords,
    scriptSourceBindings: overlay.scriptSourceBindings,
    deliveryPackages: overlay.deliveryPackages,
    deliveryPackageEpisodes: overlay.deliveryPackageEpisodes
  };
}
