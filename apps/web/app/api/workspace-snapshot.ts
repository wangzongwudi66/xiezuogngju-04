import type {
  AssetLockRecord,
  DeliveryPackage,
  DeliveryPackageEpisode,
  Episode,
  EpisodeAssignment,
  Project,
  ProjectMember,
  ProjectMemberPermission,
  ScriptSourceBinding,
  User,
  WorkspaceState
} from "@aigc/domain";
import { readDbAssetLockRecordParts } from "./asset-lock-records/db-parts";
import { readDbAuthScopeSnapshot } from "./auth-scope/db-repository";
import { readDbDeliveryPackageSnapshot } from "./delivery-packages/db-repository";

export interface DbWorkspaceSnapshotOverlay {
  users: User[];
  projects: Project[];
  members: ProjectMember[];
  memberPermissions: ProjectMemberPermission[];
  episodes: Episode[];
  assignments: EpisodeAssignment[];
  assetLockRecords: AssetLockRecord[];
  scriptSourceBindings: ScriptSourceBinding[];
  deliveryPackages: DeliveryPackage[];
  deliveryPackageEpisodes: DeliveryPackageEpisode[];
}

export function composeDbWorkspaceSnapshotOverlay(
  localState: WorkspaceState,
  overlay: DbWorkspaceSnapshotOverlay
): WorkspaceState & DbWorkspaceSnapshotOverlay {
  return {
    ...localState,
    users: overlay.users,
    projects: overlay.projects,
    members: overlay.members,
    memberPermissions: overlay.memberPermissions,
    episodes: overlay.episodes,
    assignments: overlay.assignments,
    assetLockRecords: overlay.assetLockRecords,
    scriptSourceBindings: overlay.scriptSourceBindings,
    deliveryPackages: overlay.deliveryPackages,
    deliveryPackageEpisodes: overlay.deliveryPackageEpisodes
  };
}

export async function readDbWorkspaceOverlayParts(): Promise<DbWorkspaceSnapshotOverlay> {
  const [authScopeSnapshot, assetLockRecordParts, deliveryPackageSnapshot] = await Promise.all([
    readDbAuthScopeSnapshot(),
    readDbAssetLockRecordParts(),
    readDbDeliveryPackageSnapshot()
  ]);

  return {
    users: authScopeSnapshot.users,
    projects: authScopeSnapshot.projects,
    members: authScopeSnapshot.members,
    memberPermissions: authScopeSnapshot.memberPermissions,
    episodes: authScopeSnapshot.episodes,
    assignments: authScopeSnapshot.assignments,
    assetLockRecords: assetLockRecordParts.assetLockRecords,
    scriptSourceBindings: assetLockRecordParts.scriptSourceBindings,
    deliveryPackages: deliveryPackageSnapshot.deliveryPackages,
    deliveryPackageEpisodes: deliveryPackageSnapshot.deliveryPackageEpisodes
  };
}

export async function readDbWorkspaceSnapshotOverlay(localState: WorkspaceState): Promise<WorkspaceState & DbWorkspaceSnapshotOverlay> {
  return composeDbWorkspaceSnapshotOverlay(localState, await readDbWorkspaceOverlayParts());
}
