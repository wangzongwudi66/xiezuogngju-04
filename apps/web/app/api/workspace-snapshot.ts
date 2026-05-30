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
): WorkspaceState {
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
