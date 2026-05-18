import type {
  AssignmentInput,
  Episode,
  EpisodeAssignment,
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
