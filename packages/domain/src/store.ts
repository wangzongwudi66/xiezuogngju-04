import type {
  AssetLockRecord,
  AssetLockRecordDisputeInput,
  AssetLockRecordFinalLockInput,
  AssetLockRecordInput,
  AssetLockRecordNeedsInfoInput,
  AssetLockRecordProductionConfirmationInput,
  AssetLockRecordWriterConfirmationInput,
  AssignmentInput,
  DeliveryPackage,
  DeliveryPackageConfirmationInput,
  DeliveryPackageDraftInput,
  DeliveryPackageEpisode,
  Episode,
  EpisodeAssignment,
  EpisodeCurrent,
  EpisodeRevision,
  MemberInput,
  MemberPermissionsInput,
  MemberRolesInput,
  PermissionKey,
  Project,
  ProjectInput,
  ProjectMember,
  ProjectRole,
  RegisterInput,
  WorkspacePermissions,
  WorkspaceState
} from "./types";
import { diffEpisodeScript } from "./script-diff";

const timestamp = () => new Date().toISOString();

const rolePower: ProjectRole[] = ["owner", "coordinator", "head_writer", "writer", "creator"];
const permissionKeys: PermissionKey[] = [
  "canManageProjects",
  "canManageMembers",
  "canAssignEpisodes",
  "canViewProjectOverview",
  "canViewAllEpisodes",
  "canSubmitWriting",
  "canReviewAssets",
  "canViewAssignedEpisodes"
];

const avatarTones = ["ink", "violet", "amber", "teal", "rose"];

const slugifyCode = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);

const createId = (prefix: string, value: string) =>
  `${prefix}-${value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-|-$/g, "")}-${Math.random().toString(36).slice(2, 8)}`;

export function registerUser(state: WorkspaceState, input: RegisterInput): WorkspaceState {
  const name = input.name.trim();

  if (!name) {
    throw new Error("名称不能为空");
  }

  if (state.users.some((user) => user.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("名称已存在，请直接登录");
  }

  const userId = createId("user", name);
  return {
    ...state,
    currentUserId: userId,
    users: [
      ...state.users,
      {
        id: userId,
        name,
        defaultRole: input.role,
        avatarTone: avatarTones[state.users.length % avatarTones.length]
      }
    ]
  };
}

export function loginAsUser(state: WorkspaceState, userId: string): WorkspaceState {
  if (!state.users.some((user) => user.id === userId)) {
    throw new Error("用户不存在");
  }

  return {
    ...state,
    currentUserId: userId
  };
}

export function logout(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    currentUserId: null
  };
}

export function createProject(state: WorkspaceState, input: ProjectInput): WorkspaceState {
  const name = input.name.trim();
  const code = slugifyCode(input.code || name);

  if (!name) {
    throw new Error("项目名称不能为空");
  }

  if (input.episodeCount < 1 || input.episodeCount > 200) {
    throw new Error("集数必须在 1 到 200 之间");
  }

  if (state.projects.some((project) => project.code === code)) {
    throw new Error("项目代号已存在");
  }

  const projectId = createId("project", code);
  const createdAt = timestamp();
  const project: Project = {
    id: projectId,
    name,
    code,
    episodeCount: input.episodeCount,
    status: "active",
    createdAt
  };

  const episodes: Episode[] = Array.from({ length: input.episodeCount }, (_, index) => {
    const episodeNo = index + 1;
    return {
      id: `${projectId}-episode-${episodeNo}`,
      projectId,
      episodeNo,
      title: `第 ${episodeNo} 集`,
      productionStatus: "not_started",
      hasUnreadKeyChange: false,
      openIssueCount: 0,
      assetTodoCount: 0
    };
  });

  return {
    ...state,
    projects: [...state.projects, project],
    episodes: [...state.episodes, ...episodes]
  };
}

export function updateProject(state: WorkspaceState, projectId: string, patch: Partial<ProjectInput>): WorkspaceState {
  return {
    ...state,
    projects: state.projects.map((project) => {
      if (project.id !== projectId) {
        return project;
      }

      return {
        ...project,
        name: patch.name?.trim() || project.name,
        code: patch.code ? slugifyCode(patch.code) : project.code,
        episodeCount: patch.episodeCount ?? project.episodeCount
      };
    })
  };
}

export function archiveProject(state: WorkspaceState, projectId: string): WorkspaceState {
  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === projectId ? { ...project, status: "archived" } : project
    )
  };
}

export function upsertProjectMember(state: WorkspaceState, input: MemberInput): WorkspaceState {
  const existing = state.members.find(
    (member) => member.projectId === input.projectId && member.userId === input.userId && member.role === input.role
  );

  const nextMember: ProjectMember = {
    id: existing?.id ?? createId("member", `${input.projectId}-${input.userId}-${input.role}`),
    projectId: input.projectId,
    userId: input.userId,
    role: input.role,
    createdAt: existing?.createdAt ?? timestamp()
  };

  return {
    ...state,
    members: existing
      ? state.members.map((member) => (member.id === existing.id ? nextMember : member))
      : [...state.members, nextMember]
  };
}

export function saveProjectMemberRoles(state: WorkspaceState, input: MemberRolesInput): WorkspaceState {
  const roles = Array.from(new Set(input.roles));

  if (roles.length === 0) {
    throw new Error("请至少选择一个成员身份");
  }

  const preservedMembers = state.members.filter(
    (member) => !(member.projectId === input.projectId && member.userId === input.userId)
  );
  const existingMembers = state.members.filter(
    (member) => member.projectId === input.projectId && member.userId === input.userId
  );
  const createdAt = timestamp();

  const nextMembers: ProjectMember[] = roles.map((role) => {
    const existing = existingMembers.find((member) => member.role === role);
    return {
      id: existing?.id ?? createId("member", `${input.projectId}-${input.userId}-${role}`),
      projectId: input.projectId,
      userId: input.userId,
      role,
      createdAt: existing?.createdAt ?? createdAt
    };
  });

  return {
    ...state,
    members: [...preservedMembers, ...nextMembers]
  };
}

export function updateProjectMemberPermissions(state: WorkspaceState, input: MemberPermissionsInput): WorkspaceState {
  const isProjectMember = state.members.some(
    (member) => member.projectId === input.projectId && member.userId === input.userId
  );

  if (!isProjectMember) {
    throw new Error("请先保存成员身份，再分配权限");
  }

  const permissions = Array.from(new Set(input.permissions)).filter((permission) => permissionKeys.includes(permission));
  const preservedPermissions = state.memberPermissions.filter(
    (item) => !(item.projectId === input.projectId && item.userId === input.userId)
  );
  const grantedAt = timestamp();

  return {
    ...state,
    memberPermissions: [
      ...preservedPermissions,
      ...permissions.map((permission) => ({
        id: createId("permission", `${input.projectId}-${input.userId}-${permission}`),
        projectId: input.projectId,
        userId: input.userId,
        permission,
        grantedAt
      }))
    ]
  };
}

export function assignEpisodes(state: WorkspaceState, input: AssignmentInput): WorkspaceState {
  validateEpisodeRange(input.episodeFrom, input.episodeTo);

  const isProjectMember = state.members.some(
    (member) => member.projectId === input.projectId && member.userId === input.userId
  );

  if (!isProjectMember) {
    throw new Error("请先把该用户添加为项目成员，再分配集数");
  }

  const episodes = state.episodes.filter(
    (episode) =>
      episode.projectId === input.projectId &&
      episode.episodeNo >= input.episodeFrom &&
      episode.episodeNo <= input.episodeTo
  );

  if (episodes.length !== input.episodeTo - input.episodeFrom + 1) {
    throw new Error("分配范围超出项目集数");
  }

  const assignedEpisodeIds = new Set(episodes.map((episode) => episode.id));
  const preservedAssignments = state.assignments.filter(
    (assignment) => !(assignedEpisodeIds.has(assignment.episodeId) && assignment.userId === input.userId)
  );

  const createdAt = timestamp();
  const nextAssignments: EpisodeAssignment[] = episodes.map((episode) => ({
    id: createId("assign", `${episode.id}-${input.userId}`),
    episodeId: episode.id,
    userId: input.userId,
    responsibility: input.responsibility,
    createdAt
  }));

  return {
    ...state,
    assignments: [...preservedAssignments, ...nextAssignments]
  };
}

export function createDeliveryPackageDraft(state: WorkspaceState, input: DeliveryPackageDraftInput): WorkspaceState {
  const project = requireProject(state, input.projectId);
  assertProjectRole(state, input.projectId, input.uploadedByUserId, ["owner", "coordinator", "head_writer"], "创建交稿包");
  validateEpisodeRange(input.declaredEpisodeFrom, input.declaredEpisodeTo);

  if (input.type === "single_replace" && input.declaredEpisodeFrom !== input.declaredEpisodeTo) {
    throw new Error("单集替换只能声明一个集号");
  }

  const parsedEpisodes = normalizePackageEpisodes(input.episodes);

  if (parsedEpisodes.length === 0) {
    throw new Error("交稿包至少需要包含一集剧本");
  }

  const confirmedEpisodeNos = normalizeConfirmedEpisodeNos(
    input.confirmedEpisodeNos ?? parsedEpisodes.map((episode) => episode.episodeNo)
  );
  const parsedEpisodeNos = new Set(parsedEpisodes.map((episode) => episode.episodeNo));
  const declaredEpisodeNos = new Set(
    Array.from({ length: input.declaredEpisodeTo - input.declaredEpisodeFrom + 1 }, (_, index) => input.declaredEpisodeFrom + index)
  );

  for (const episodeNo of confirmedEpisodeNos) {
    if (!parsedEpisodeNos.has(episodeNo)) {
      throw new Error("确认变更集不在交稿包内容中");
    }
  }

  for (const episode of parsedEpisodes) {
    if (!declaredEpisodeNos.has(episode.episodeNo)) {
      throw new Error("交稿包内容超出声明范围");
    }

    requireEpisodeByNo(state, input.projectId, episode.episodeNo);
  }

  if (input.type === "single_replace" && confirmedEpisodeNos.length !== 1) {
    throw new Error("单集替换必须只确认一集变更");
  }

  const packageId = createId("delivery", `${project.code}-${input.declaredEpisodeFrom}-${input.declaredEpisodeTo}`);
  const createdAt = timestamp();
  const deliveryPackage: DeliveryPackage = {
    id: packageId,
    projectId: input.projectId,
    type: input.type,
    title:
      input.title?.trim() ||
      `${project.name} 第 ${input.declaredEpisodeFrom}-${input.declaredEpisodeTo} 集交稿`,
    sourceFileName: input.sourceFileName,
    declaredEpisodeFrom: input.declaredEpisodeFrom,
    declaredEpisodeTo: input.declaredEpisodeTo,
    status: "draft",
    uploadedByUserId: input.uploadedByUserId,
    createdAt
  };

  const packageEpisodes: DeliveryPackageEpisode[] = parsedEpisodes.map((episode) => ({
    id: createId("delivery-episode", `${packageId}-${episode.episodeNo}`),
    deliveryPackageId: packageId,
    episodeNo: episode.episodeNo,
    title: episode.title || `第 ${episode.episodeNo} 集`,
    content: episode.content,
    isConfirmedChange: confirmedEpisodeNos.includes(episode.episodeNo)
  }));

  return {
    ...state,
    deliveryPackages: [...state.deliveryPackages, deliveryPackage],
    deliveryPackageEpisodes: [...state.deliveryPackageEpisodes, ...packageEpisodes]
  };
}

export function updateDeliveryPackageConfirmation(
  state: WorkspaceState,
  input: DeliveryPackageConfirmationInput
): WorkspaceState {
  const deliveryPackage = requireDeliveryPackage(state, input.deliveryPackageId);
  assertDeliveryStatus(deliveryPackage, "draft");

  const confirmedEpisodeNos = normalizeConfirmedEpisodeNos(input.confirmedEpisodeNos);
  const packageEpisodes = state.deliveryPackageEpisodes.filter(
    (episode) => episode.deliveryPackageId === input.deliveryPackageId
  );
  const packageEpisodeNos = new Set(packageEpisodes.map((episode) => episode.episodeNo));

  for (const episodeNo of confirmedEpisodeNos) {
    if (!packageEpisodeNos.has(episodeNo)) {
      throw new Error("确认变更集不在交稿包内容中");
    }
  }

  return {
    ...state,
    deliveryPackageEpisodes: state.deliveryPackageEpisodes.map((episode) =>
      episode.deliveryPackageId === input.deliveryPackageId
        ? { ...episode, isConfirmedChange: confirmedEpisodeNos.includes(episode.episodeNo) }
        : episode
    )
  };
}

export function submitDeliveryPackageForReview(
  state: WorkspaceState,
  deliveryPackageId: string,
  submittedByUserId: string
): WorkspaceState {
  const deliveryPackage = requireDeliveryPackage(state, deliveryPackageId);
  assertDeliveryStatus(deliveryPackage, "draft");
  assertProjectRole(state, deliveryPackage.projectId, submittedByUserId, ["owner", "coordinator", "head_writer"], "提交交稿包");

  const confirmedCount = state.deliveryPackageEpisodes.filter(
    (episode) => episode.deliveryPackageId === deliveryPackageId && episode.isConfirmedChange
  ).length;

  if (confirmedCount === 0) {
    throw new Error("请至少确认一集实际变更后再提交");
  }

  return {
    ...state,
    deliveryPackages: state.deliveryPackages.map((item) =>
      item.id === deliveryPackageId
        ? {
            ...item,
            status: "pending_review",
            submittedByUserId,
            submittedAt: timestamp()
          }
        : item
    )
  };
}

export function rejectDeliveryPackage(
  state: WorkspaceState,
  deliveryPackageId: string,
  reviewedByUserId: string,
  reason: string
): WorkspaceState {
  const deliveryPackage = requireDeliveryPackage(state, deliveryPackageId);
  assertDeliveryStatus(deliveryPackage, "pending_review");
  assertProjectRole(state, deliveryPackage.projectId, reviewedByUserId, ["owner", "coordinator"], "驳回交稿包");

  if (!reason.trim()) {
    throw new Error("驳回原因不能为空");
  }

  return {
    ...state,
    deliveryPackages: state.deliveryPackages.map((item) =>
      item.id === deliveryPackageId
        ? {
            ...item,
            status: "rejected",
            reviewedByUserId,
            rejectionReason: reason.trim(),
            rejectedAt: timestamp()
          }
        : item
    )
  };
}

export function publishDeliveryPackage(
  state: WorkspaceState,
  deliveryPackageId: string,
  reviewedByUserId: string
): WorkspaceState {
  const deliveryPackage = requireDeliveryPackage(state, deliveryPackageId);
  assertDeliveryStatus(deliveryPackage, "pending_review");
  assertProjectRole(state, deliveryPackage.projectId, reviewedByUserId, ["owner", "coordinator"], "发布交稿包");

  const confirmedEpisodes = state.deliveryPackageEpisodes.filter(
    (episode) => episode.deliveryPackageId === deliveryPackageId && episode.isConfirmedChange
  );

  if (confirmedEpisodes.length === 0) {
    throw new Error("没有可发布的确认变更集");
  }

  const createdAt = timestamp();
  const nextRevisions: EpisodeRevision[] = confirmedEpisodes.map((packageEpisode) => {
    const episode = requireEpisodeByNo(state, deliveryPackage.projectId, packageEpisode.episodeNo);
    const previousCurrent = state.episodeCurrents.find((current) => current.episodeId === episode.id);
    const previousRevision = previousCurrent
      ? state.episodeRevisions.find((revision) => revision.id === previousCurrent.currentRevisionId)
      : undefined;
    const revisionNo = nextRevisionNo(state, episode.id);
    const diff = diffEpisodeScript(previousRevision?.content ?? "", packageEpisode.content);

    return {
      id: createId("revision", `${episode.id}-${revisionNo}`),
      projectId: deliveryPackage.projectId,
      episodeId: episode.id,
      episodeNo: packageEpisode.episodeNo,
      deliveryPackageId,
      revisionNo,
      title: packageEpisode.title,
      content: packageEpisode.content,
      previousRevisionId: previousRevision?.id,
      changeSummary: previousRevision ? diff.summary.headline : "本集首次发布当前生效剧本。",
      createdAt
    };
  });

  const nextCurrents = upsertEpisodeCurrents(state.episodeCurrents, nextRevisions, createdAt);
  const changedEpisodeIds = new Set(nextRevisions.map((revision) => revision.episodeId));
  const nextNotifications = buildPublishNotifications(state, nextRevisions, deliveryPackage, createdAt);

  return {
    ...state,
    deliveryPackages: state.deliveryPackages.map((item) =>
      item.id === deliveryPackageId
        ? {
            ...item,
            status: "published",
            reviewedByUserId,
            publishedAt: createdAt
          }
        : item
    ),
    episodeRevisions: [...state.episodeRevisions, ...nextRevisions],
    episodeCurrents: nextCurrents,
    episodes: state.episodes.map((episode) =>
      changedEpisodeIds.has(episode.id)
        ? { ...episode, hasUnreadKeyChange: true, productionStatus: "key_update" }
        : episode
    ),
    notifications: [...state.notifications, ...nextNotifications]
  };
}

export function createAssetLockRecord(state: WorkspaceState, input: AssetLockRecordInput): WorkspaceState {
  requireProject(state, input.projectId);
  const deliveryPackage = requireDeliveryPackage(state, input.deliveryPackageId);

  if (deliveryPackage.projectId !== input.projectId) {
    throw new Error("资产核对记录必须关联同一项目的交稿包");
  }

  assertDeliveryStatus(deliveryPackage, "published");
  assertProjectRole(state, input.projectId, input.createdByUserId, ["owner", "coordinator", "head_writer", "writer"], "创建资产核对记录");
  const episodeNos = normalizeAssetEpisodeNos(input.episodeNos);
  assertEpisodeNosBelongToDeliveryPackage(state, deliveryPackage.id, episodeNos);

  const assetName = input.assetName.trim();
  if (!assetName) {
    throw new Error("资产名称不能为空");
  }

  const createdAt = timestamp();
  const record: AssetLockRecord = {
    id: createId("asset-lock", `${deliveryPackage.id}-${assetName}`),
    projectId: input.projectId,
    deliveryPackageId: input.deliveryPackageId,
    episodeNos,
    assetName,
    assetType: input.assetType,
    changeType: input.changeType,
    writerConfirmation: "pending",
    writerNote: input.writerNote?.trim() || undefined,
    productionConfirmation: "pending",
    productionNote: input.productionNote?.trim() || undefined,
    risk: input.risk ?? "normal",
    status: "draft",
    createdByUserId: input.createdByUserId,
    createdAt,
    updatedAt: createdAt
  };

  return {
    ...state,
    assetLockRecords: [...getAssetLockRecords(state), record]
  };
}

export function confirmAssetLockRecordByWriter(
  state: WorkspaceState,
  input: AssetLockRecordWriterConfirmationInput
): WorkspaceState {
  const record = requireAssetLockRecord(state, input.assetLockRecordId);
  assertProjectRole(state, record.projectId, input.confirmedByUserId, ["owner", "coordinator", "head_writer", "writer"], "编剧确认资产核对记录");
  const updated = {
    ...record,
    writerConfirmation: "confirmed" as const,
    writerConfirmedByUserId: input.confirmedByUserId,
    writerConfirmedAt: timestamp(),
    writerNote: input.note?.trim() || record.writerNote,
    status: nextAssetLockStatus({
      writerConfirmation: "confirmed",
      productionConfirmation: record.productionConfirmation
    }),
    missingInfo: undefined,
    disputeReason: undefined
  };

  return replaceAssetLockRecord(state, { ...updated, updatedAt: updated.writerConfirmedAt });
}

export function confirmAssetLockRecordByProduction(
  state: WorkspaceState,
  input: AssetLockRecordProductionConfirmationInput
): WorkspaceState {
  const record = requireAssetLockRecord(state, input.assetLockRecordId);
  assertProjectRole(state, record.projectId, input.confirmedByUserId, ["owner", "coordinator", "creator"], "制作确认资产核对记录");
  const updated = {
    ...record,
    productionConfirmation: "confirmed" as const,
    productionConfirmedByUserId: input.confirmedByUserId,
    productionConfirmedAt: timestamp(),
    productionNote: input.note?.trim() || record.productionNote,
    status: nextAssetLockStatus({
      writerConfirmation: record.writerConfirmation,
      productionConfirmation: "confirmed"
    }),
    missingInfo: undefined,
    disputeReason: undefined
  };

  return replaceAssetLockRecord(state, { ...updated, updatedAt: updated.productionConfirmedAt });
}

export function markAssetLockRecordNeedsInfo(
  state: WorkspaceState,
  input: AssetLockRecordNeedsInfoInput
): WorkspaceState {
  const record = requireAssetLockRecord(state, input.assetLockRecordId);
  assertProjectRole(state, record.projectId, input.markedByUserId, ["owner", "coordinator", "head_writer", "writer", "creator"], "标记资产补充信息");
  const missingInfo = input.missingInfo.trim();

  if (!missingInfo) {
    throw new Error("补充信息说明不能为空");
  }

  return replaceAssetLockRecord(state, {
    ...record,
    writerConfirmation: record.writerConfirmation === "confirmed" ? record.writerConfirmation : "returned",
    productionConfirmation: record.productionConfirmation === "confirmed" ? record.productionConfirmation : "returned",
    status: "needs_info",
    missingInfo,
    disputeReason: undefined,
    updatedAt: timestamp()
  });
}

export function markAssetLockRecordDisputed(state: WorkspaceState, input: AssetLockRecordDisputeInput): WorkspaceState {
  const record = requireAssetLockRecord(state, input.assetLockRecordId);
  assertProjectRole(state, record.projectId, input.markedByUserId, ["owner", "coordinator", "head_writer", "writer", "creator"], "标记资产争议");
  const disputeReason = input.disputeReason.trim();

  if (!disputeReason) {
    throw new Error("争议说明不能为空");
  }

  return replaceAssetLockRecord(state, {
    ...record,
    status: "disputed",
    risk: "high",
    disputeReason,
    updatedAt: timestamp()
  });
}

export function finalLockAssetRecord(state: WorkspaceState, input: AssetLockRecordFinalLockInput): WorkspaceState {
  const record = requireAssetLockRecord(state, input.assetLockRecordId);
  assertProjectRole(state, record.projectId, input.lockedByUserId, ["owner", "coordinator"], "定版资产核对记录");

  if (record.writerConfirmation !== "confirmed" || record.productionConfirmation !== "confirmed") {
    throw new Error("编剧和制作确认完成后才能定版");
  }

  if (record.status === "needs_info") {
    throw new Error("资产仍需补充信息，不能定版");
  }

  if (record.status === "disputed") {
    throw new Error("资产仍有争议，不能定版");
  }

  const lockedAt = timestamp();
  return replaceAssetLockRecord(state, {
    ...record,
    status: "locked",
    finalLockedByUserId: input.lockedByUserId,
    finalLockedAt: lockedAt,
    updatedAt: lockedAt
  });
}

export function markNotificationRead(state: WorkspaceState, notificationId: string): WorkspaceState {
  const readAt = timestamp();

  return {
    ...state,
    notifications: state.notifications.map((notification) =>
      notification.id === notificationId ? { ...notification, readAt } : notification
    )
  };
}

export function selectCurrentUser(state: WorkspaceState) {
  return state.users.find((user) => user.id === state.currentUserId) ?? null;
}

export function selectPrimaryRole(state: WorkspaceState, userId: string, projectId?: string): ProjectRole {
  const user = state.users.find((item) => item.id === userId);

  if (!user) {
    throw new Error("用户不存在");
  }

  const roles = state.members
    .filter((member) => member.userId === userId && (!projectId || member.projectId === projectId))
    .map((member) => member.role);

  if (roles.length === 0) {
    return user.defaultRole;
  }

  return roles.sort((a, b) => rolePower.indexOf(a) - rolePower.indexOf(b))[0];
}

export function selectPermissions(state: WorkspaceState, userId: string, projectId?: string): WorkspacePermissions {
  const permissions = selectPermissionKeys(state, userId, projectId);
  const hasPermission = (permission: PermissionKey) => permissions.includes(permission);
  const isCoordination =
    hasPermission("canManageProjects") || hasPermission("canManageMembers") || hasPermission("canAssignEpisodes");
  const isWriting =
    hasPermission("canViewProjectOverview") || hasPermission("canSubmitWriting") || hasPermission("canReviewAssets");

  return {
    canManageProjects: hasPermission("canManageProjects"),
    canManageMembers: hasPermission("canManageMembers"),
    canAssignEpisodes: hasPermission("canAssignEpisodes"),
    canViewProjectOverview: hasPermission("canViewProjectOverview"),
    canViewAllEpisodes: hasPermission("canViewAllEpisodes"),
    canSubmitWriting: hasPermission("canSubmitWriting"),
    canReviewAssets: hasPermission("canReviewAssets"),
    canViewAssignedEpisodes: hasPermission("canViewAssignedEpisodes"),
    homeView: isCoordination ? "coordination" : isWriting ? "writing" : "creator"
  };
}

export function selectPermissionKeys(state: WorkspaceState, userId: string, projectId?: string): PermissionKey[] {
  if (projectId) {
    const customPermissions = state.memberPermissions.filter(
      (item) => item.projectId === projectId && item.userId === userId
    );

    if (customPermissions.length > 0) {
      return sortPermissions(customPermissions.map((item) => item.permission));
    }
  }

  const roles = selectProjectRoles(state, userId, projectId);
  return sortPermissions(roles.flatMap((role) => defaultPermissionsForRole(role)));
}

export function selectProjectMembers(state: WorkspaceState, projectId: string) {
  return Array.from(
    state.members
      .filter((member) => member.projectId === projectId)
      .reduce((groups, member) => {
        const roles = groups.get(member.userId) ?? [];
        roles.push(member.role);
        groups.set(member.userId, roles);
        return groups;
      }, new Map<string, ProjectRole[]>())
      .entries()
  )
    .map(([userId, roles]) => {
      const user = state.users.find((item) => item.id === userId);

      if (!user) {
        throw new Error("项目成员缺少用户信息");
      }

      const sortedRoles = roles.sort((a, b) => rolePower.indexOf(a) - rolePower.indexOf(b));
      const role = sortedRoles[0];

      return {
        id: `${projectId}-${userId}`,
        projectId,
        userId,
        role,
        roles: sortedRoles,
        permissions: selectPermissionKeys(state, userId, projectId),
        hasCustomPermissions: state.memberPermissions.some((item) => item.projectId === projectId && item.userId === userId),
        userName: user.name,
        avatarTone: user.avatarTone
      };
    })
    .sort((a, b) => rolePower.indexOf(a.role) - rolePower.indexOf(b.role) || a.userName.localeCompare(b.userName, "zh-CN"));
}

export function selectMyEpisodes(state: WorkspaceState, userId = state.currentUserId) {
  if (!userId) {
    return [];
  }

  const assignedIds = new Set(
    state.assignments.filter((assignment) => assignment.userId === userId).map((assignment) => assignment.episodeId)
  );

  return state.episodes
    .filter((episode) => assignedIds.has(episode.id))
    .map((episode) => {
      const project = state.projects.find((item) => item.id === episode.projectId);
      const assignment = state.assignments.find((item) => item.episodeId === episode.id && item.userId === userId);

      if (!project || !assignment) {
        throw new Error("数据不完整：集分配缺少项目或责任信息");
      }

      return {
        ...episode,
        projectName: project.name,
        projectCode: project.code,
        responsibility: assignment.responsibility
      };
    })
    .sort((a, b) => a.projectName.localeCompare(b.projectName, "zh-CN") || a.episodeNo - b.episodeNo);
}

export function selectMyProjects(state: WorkspaceState, userId = state.currentUserId) {
  if (!userId) {
    return [];
  }

  return Array.from(new Set(state.members.filter((member) => member.userId === userId).map((member) => member.projectId)))
    .map((projectId) => {
      const project = requireProject(state, projectId);
      const roles = selectProjectRoles(state, userId, projectId);
      const assignedEpisodeNos = selectMyEpisodes(state, userId)
        .filter((episode) => episode.projectId === projectId)
        .map((episode) => episode.episodeNo)
        .sort((a, b) => a - b);

      return {
        ...project,
        roles,
        assignedEpisodeNos
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export function selectProjectOverview(state: WorkspaceState, projectId: string) {
  const project = state.projects.find((item) => item.id === projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  const episodes = state.episodes
    .filter((episode) => episode.projectId === projectId)
    .sort((a, b) => a.episodeNo - b.episodeNo)
    .map((episode) => {
      const assignments = state.assignments
        .filter((assignment) => assignment.episodeId === episode.id)
        .map((assignment) => {
          const user = state.users.find((item) => item.id === assignment.userId);
          return user ? { ...assignment, userName: user.name } : undefined;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      return {
        ...episode,
        assignments
      };
    });

  return {
    project,
    episodes,
    memberCount: state.members.filter((member) => member.projectId === projectId).length
  };
}

export function selectUnreadNotifications(state: WorkspaceState, userId = state.currentUserId) {
  if (!userId) {
    return [];
  }

  return state.notifications
    .filter((notification) => notification.recipientId === userId && !notification.readAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function selectDeliveryPackageDetail(state: WorkspaceState, deliveryPackageId: string) {
  const deliveryPackage = requireDeliveryPackage(state, deliveryPackageId);
  const episodes = state.deliveryPackageEpisodes
    .filter((episode) => episode.deliveryPackageId === deliveryPackageId)
    .sort((a, b) => a.episodeNo - b.episodeNo);

  return {
    ...deliveryPackage,
    episodes,
    confirmedEpisodeNos: episodes.filter((episode) => episode.isConfirmedChange).map((episode) => episode.episodeNo)
  };
}

export function selectEpisodeScriptTimeline(state: WorkspaceState, episodeId: string) {
  const episode = state.episodes.find((item) => item.id === episodeId);

  if (!episode) {
    throw new Error("集不存在");
  }

  const current = state.episodeCurrents.find((item) => item.episodeId === episodeId);
  const currentRevision = current
    ? state.episodeRevisions.find((revision) => revision.id === current.currentRevisionId)
    : undefined;
  const revisions = state.episodeRevisions
    .filter((revision) => revision.episodeId === episodeId)
    .sort((a, b) => b.revisionNo - a.revisionNo)
    .map((revision) => {
      const deliveryPackage = state.deliveryPackages.find((item) => item.id === revision.deliveryPackageId);
      return {
        ...revision,
        deliveryPackageTitle: deliveryPackage?.title ?? "未知交稿包",
        deliveryPackageStatus: deliveryPackage?.status ?? "draft"
      };
    });

  return {
    episode,
    currentRevision,
    revisions
  };
}

function selectProjectRoles(state: WorkspaceState, userId: string, projectId?: string): ProjectRole[] {
  const user = state.users.find((item) => item.id === userId);

  if (!user) {
    throw new Error("用户不存在");
  }

  const roles = state.members
    .filter((member) => member.userId === userId && (!projectId || member.projectId === projectId))
    .map((member) => member.role);

  return roles.length > 0 ? roles : [user.defaultRole];
}

function requireProject(state: WorkspaceState, projectId: string) {
  const project = state.projects.find((item) => item.id === projectId);

  if (!project) {
    throw new Error("项目不存在");
  }

  return project;
}

function requireEpisodeByNo(state: WorkspaceState, projectId: string, episodeNo: number) {
  const episode = state.episodes.find((item) => item.projectId === projectId && item.episodeNo === episodeNo);

  if (!episode) {
    throw new Error("集不存在");
  }

  return episode;
}

function requireDeliveryPackage(state: WorkspaceState, deliveryPackageId: string) {
  const deliveryPackage = state.deliveryPackages.find((item) => item.id === deliveryPackageId);

  if (!deliveryPackage) {
    throw new Error("交稿包不存在");
  }

  return deliveryPackage;
}

function getAssetLockRecords(state: WorkspaceState) {
  return state.assetLockRecords ?? [];
}

function requireAssetLockRecord(state: WorkspaceState, assetLockRecordId: string) {
  const record = getAssetLockRecords(state).find((item) => item.id === assetLockRecordId);

  if (!record) {
    throw new Error("资产核对记录不存在");
  }

  return record;
}

function replaceAssetLockRecord(state: WorkspaceState, record: AssetLockRecord): WorkspaceState {
  return {
    ...state,
    assetLockRecords: getAssetLockRecords(state).map((item) => (item.id === record.id ? record : item))
  };
}

function assertDeliveryStatus(deliveryPackage: DeliveryPackage, status: DeliveryPackage["status"]) {
  if (deliveryPackage.status !== status) {
    throw new Error(`交稿包状态必须是 ${status}`);
  }
}

function assertProjectRole(
  state: WorkspaceState,
  projectId: string,
  userId: string,
  allowedRoles: ProjectRole[],
  actionName: string
) {
  const user = state.users.find((item) => item.id === userId);

  if (!user) {
    throw new Error("用户不存在");
  }

  const roles = state.members
    .filter((member) => member.projectId === projectId && member.userId === userId)
    .map((member) => member.role);

  if (roles.length === 0) {
    throw new Error(`${actionName}需要先成为项目成员`);
  }

  if (!roles.some((role) => allowedRoles.includes(role))) {
    throw new Error(`${actionName}权限不足`);
  }
}

function normalizePackageEpisodes(episodes: DeliveryPackageDraftInput["episodes"]) {
  const seen = new Set<number>();

  return episodes.map((episode) => {
    if (!Number.isInteger(episode.episodeNo) || episode.episodeNo < 1) {
      throw new Error("集号不合法");
    }

    if (seen.has(episode.episodeNo)) {
      throw new Error("交稿包内存在重复集号");
    }

    seen.add(episode.episodeNo);

    const content = episode.content.trim();
    if (!content) {
      throw new Error("单集剧本内容不能为空");
    }

    return {
      episodeNo: episode.episodeNo,
      title: episode.title?.trim() || `第 ${episode.episodeNo} 集`,
      content
    };
  });
}

function normalizeConfirmedEpisodeNos(episodeNos: number[]) {
  return Array.from(new Set(episodeNos)).sort((a, b) => a - b);
}

function normalizeAssetEpisodeNos(episodeNos: number[]) {
  const normalized = Array.from(new Set(episodeNos)).sort((a, b) => a - b);

  if (normalized.length === 0 || normalized.some((episodeNo) => !Number.isInteger(episodeNo) || episodeNo < 1)) {
    throw new Error("资产关联集数不合法");
  }

  return normalized;
}

function assertEpisodeNosBelongToDeliveryPackage(state: WorkspaceState, deliveryPackageId: string, episodeNos: number[]) {
  const packageEpisodeNos = new Set(
    state.deliveryPackageEpisodes
      .filter((episode) => episode.deliveryPackageId === deliveryPackageId)
      .map((episode) => episode.episodeNo)
  );

  for (const episodeNo of episodeNos) {
    if (!packageEpisodeNos.has(episodeNo)) {
      throw new Error("资产关联集数不在交稿包内容中");
    }
  }
}

function nextAssetLockStatus(record: Pick<AssetLockRecord, "writerConfirmation" | "productionConfirmation">) {
  if (record.writerConfirmation !== "confirmed") {
    return "draft" as const;
  }

  if (record.productionConfirmation !== "confirmed") {
    return "draft" as const;
  }

  return "ready_to_lock" as const;
}

function nextRevisionNo(state: WorkspaceState, episodeId: string) {
  const latest = state.episodeRevisions
    .filter((revision) => revision.episodeId === episodeId)
    .reduce((max, revision) => Math.max(max, revision.revisionNo), 0);

  return latest + 1;
}

function upsertEpisodeCurrents(currents: EpisodeCurrent[], revisions: EpisodeRevision[], updatedAt: string) {
  const revisionByEpisodeId = new Map(revisions.map((revision) => [revision.episodeId, revision]));
  const touchedEpisodeIds = new Set(revisionByEpisodeId.keys());
  const preserved = currents.filter((current) => !touchedEpisodeIds.has(current.episodeId));
  const next = revisions.map((revision) => ({
    id: createId("current", revision.episodeId),
    projectId: revision.projectId,
    episodeId: revision.episodeId,
    currentRevisionId: revision.id,
    updatedAt
  }));

  return [...preserved, ...next];
}

function buildPublishNotifications(
  state: WorkspaceState,
  revisions: EpisodeRevision[],
  deliveryPackage: DeliveryPackage,
  createdAt: string
) {
  return revisions.flatMap((revision) => {
    const assignments = state.assignments.filter((assignment) => assignment.episodeId === revision.episodeId);
    const recipientIds = Array.from(new Set(assignments.map((assignment) => assignment.userId)));

    return recipientIds.map((recipientId) => ({
      id: createId("notification", `${revision.id}-${recipientId}`),
      projectId: revision.projectId,
      episodeId: revision.episodeId,
      recipientId,
      type: "key_change" as const,
      title: `第 ${revision.episodeNo} 集剧本已更新`,
      body: `${deliveryPackage.title} 已发布：${revision.changeSummary}`,
      createdAt
    }));
  });
}

function defaultPermissionsForRole(role: ProjectRole): PermissionKey[] {
  if (role === "owner") {
    return permissionKeys;
  }

  if (role === "coordinator") {
    return [
      "canManageProjects",
      "canManageMembers",
      "canAssignEpisodes",
      "canViewProjectOverview",
      "canViewAllEpisodes",
      "canViewAssignedEpisodes"
    ];
  }

  if (role === "head_writer") {
    return ["canViewProjectOverview", "canViewAllEpisodes", "canSubmitWriting", "canReviewAssets", "canViewAssignedEpisodes"];
  }

  if (role === "writer") {
    return ["canViewProjectOverview", "canSubmitWriting", "canReviewAssets", "canViewAssignedEpisodes"];
  }

  return ["canViewAssignedEpisodes"];
}

function sortPermissions(permissions: PermissionKey[]) {
  const unique = Array.from(new Set(permissions));
  return unique.sort((a, b) => permissionKeys.indexOf(a) - permissionKeys.indexOf(b));
}

function validateEpisodeRange(episodeFrom?: number, episodeTo?: number) {
  if (episodeFrom === undefined && episodeTo === undefined) {
    return;
  }

  if (!episodeFrom || !episodeTo || episodeFrom < 1 || episodeTo < episodeFrom) {
    throw new Error("集范围不合法");
  }
}
