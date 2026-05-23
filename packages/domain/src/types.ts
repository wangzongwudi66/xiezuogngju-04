export type ProjectStatus = "active" | "archived";

export type DeliveryPackageStatus = "draft" | "pending_review" | "published" | "rejected";

export type DeliveryPackageType = "range" | "single_replace";

export type AssetChangeType = "new" | "modified" | "removed" | "reused";

export type AssetConfirmationStatus = "pending" | "confirmed" | "returned";

export type AssetLockStatus = "draft" | "needs_info" | "disputed" | "ready_to_lock" | "locked";

export type AssetRiskLevel = "normal" | "attention" | "high";

export type AssetType = "character" | "scene" | "prop" | "vehicle" | "effect";

export type ProjectRole =
  | "owner"
  | "coordinator"
  | "head_writer"
  | "writer"
  | "creator";

export type PermissionKey =
  | "canManageProjects"
  | "canManageMembers"
  | "canAssignEpisodes"
  | "canViewProjectOverview"
  | "canViewAllEpisodes"
  | "canSubmitWriting"
  | "canReviewAssets"
  | "canViewAssignedEpisodes";

export type EpisodeProductionStatus =
  | "not_started"
  | "in_progress"
  | "key_update"
  | "blocked"
  | "done";

export type NotificationType =
  | "mention"
  | "key_change"
  | "assignment"
  | "system";

export interface Project {
  id: string;
  name: string;
  code: string;
  episodeCount: number;
  status: ProjectStatus;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  defaultRole: ProjectRole;
  avatarTone: string;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  createdAt: string;
}

export interface ProjectMemberPermission {
  id: string;
  projectId: string;
  userId: string;
  permission: PermissionKey;
  grantedAt: string;
}

export interface Episode {
  id: string;
  projectId: string;
  episodeNo: number;
  title: string;
  productionStatus: EpisodeProductionStatus;
  hasUnreadKeyChange: boolean;
  openIssueCount: number;
  assetTodoCount: number;
}

export interface EpisodeAssignment {
  id: string;
  episodeId: string;
  userId: string;
  responsibility: "writer" | "lead_creator" | "creator" | "reviewer" | "support";
  createdAt: string;
}

export interface AssetLockRecord {
  id: string;
  projectId: string;
  deliveryPackageId: string;
  episodeNos: number[];
  assetName: string;
  assetType: AssetType;
  changeType: AssetChangeType;
  writerConfirmation: AssetConfirmationStatus;
  writerConfirmedByUserId?: string;
  writerConfirmedAt?: string;
  writerNote?: string;
  productionConfirmation: AssetConfirmationStatus;
  productionConfirmedByUserId?: string;
  productionConfirmedAt?: string;
  productionNote?: string;
  risk: AssetRiskLevel;
  status: AssetLockStatus;
  missingInfo?: string;
  disputeReason?: string;
  finalLockedByUserId?: string;
  finalLockedAt?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryPackage {
  id: string;
  projectId: string;
  type: DeliveryPackageType;
  title: string;
  sourceFileName?: string;
  declaredEpisodeFrom: number;
  declaredEpisodeTo: number;
  status: DeliveryPackageStatus;
  uploadedByUserId: string;
  submittedByUserId?: string;
  reviewedByUserId?: string;
  rejectionReason?: string;
  createdAt: string;
  submittedAt?: string;
  publishedAt?: string;
  rejectedAt?: string;
}

export interface DeliveryPackageEpisode {
  id: string;
  deliveryPackageId: string;
  episodeNo: number;
  title: string;
  content: string;
  isConfirmedChange: boolean;
}

export interface EpisodeRevision {
  id: string;
  projectId: string;
  episodeId: string;
  episodeNo: number;
  deliveryPackageId: string;
  revisionNo: number;
  title: string;
  content: string;
  previousRevisionId?: string;
  changeSummary: string;
  createdAt: string;
}

export interface EpisodeCurrent {
  id: string;
  projectId: string;
  episodeId: string;
  currentRevisionId: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  projectId: string;
  episodeId?: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt?: string;
  createdAt: string;
}

export interface WorkspaceState {
  currentUserId: string | null;
  users: User[];
  projects: Project[];
  members: ProjectMember[];
  memberPermissions: ProjectMemberPermission[];
  episodes: Episode[];
  assignments: EpisodeAssignment[];
  assetLockRecords?: AssetLockRecord[];
  deliveryPackages: DeliveryPackage[];
  deliveryPackageEpisodes: DeliveryPackageEpisode[];
  episodeRevisions: EpisodeRevision[];
  episodeCurrents: EpisodeCurrent[];
  notifications: Notification[];
}

export interface ProjectInput {
  name: string;
  code: string;
  episodeCount: number;
}

export interface MemberInput {
  projectId: string;
  userId: string;
  role: ProjectRole;
}

export interface MemberRolesInput {
  projectId: string;
  userId: string;
  roles: ProjectRole[];
}

export interface MemberPermissionsInput {
  projectId: string;
  userId: string;
  permissions: PermissionKey[];
}

export interface AssignmentInput {
  projectId: string;
  userId: string;
  episodeFrom: number;
  episodeTo: number;
  responsibility: EpisodeAssignment["responsibility"];
}

export interface AssetLockRecordInput {
  projectId: string;
  deliveryPackageId: string;
  episodeNos: number[];
  assetName: string;
  assetType: AssetType;
  changeType: AssetChangeType;
  createdByUserId: string;
  risk?: AssetRiskLevel;
  writerNote?: string;
  productionNote?: string;
}

export interface AssetLockRecordWriterConfirmationInput {
  assetLockRecordId: string;
  confirmedByUserId: string;
  note?: string;
}

export interface AssetLockRecordProductionConfirmationInput {
  assetLockRecordId: string;
  confirmedByUserId: string;
  note?: string;
}

export interface AssetLockRecordNeedsInfoInput {
  assetLockRecordId: string;
  markedByUserId: string;
  missingInfo: string;
}

export interface AssetLockRecordDisputeInput {
  assetLockRecordId: string;
  markedByUserId: string;
  disputeReason: string;
}

export interface AssetLockRecordFinalLockInput {
  assetLockRecordId: string;
  lockedByUserId: string;
}

export interface RegisterInput {
  name: string;
  role: ProjectRole;
}

export interface DeliveryPackageEpisodeInput {
  episodeNo: number;
  title?: string;
  content: string;
}

export interface DeliveryPackageDraftInput {
  projectId: string;
  uploadedByUserId: string;
  type: DeliveryPackageType;
  declaredEpisodeFrom: number;
  declaredEpisodeTo: number;
  sourceFileName?: string;
  title?: string;
  episodes: DeliveryPackageEpisodeInput[];
  confirmedEpisodeNos?: number[];
}

export interface DeliveryPackageConfirmationInput {
  deliveryPackageId: string;
  confirmedEpisodeNos: number[];
}

export interface WorkspacePermissions {
  canManageProjects: boolean;
  canManageMembers: boolean;
  canAssignEpisodes: boolean;
  canViewProjectOverview: boolean;
  canViewAllEpisodes: boolean;
  canSubmitWriting: boolean;
  canReviewAssets: boolean;
  canViewAssignedEpisodes: boolean;
  homeView: "coordination" | "writing" | "creator";
}
