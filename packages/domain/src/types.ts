export type ProjectStatus = "active" | "archived";

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

export interface RegisterInput {
  name: string;
  role: ProjectRole;
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
