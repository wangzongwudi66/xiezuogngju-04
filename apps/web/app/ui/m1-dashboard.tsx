"use client";

import {
  Archive,
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  CirclePlus,
  Clapperboard,
  ClipboardList,
  Command,
  FileText,
  FolderKanban,
  Home,
  Image,
  Inbox,
  LayoutDashboard,
  LogIn,
  LogOut,
  Package,
  Pencil,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import {
  archiveProject,
  assignEpisodes,
  createProject,
  loginAsUser,
  logout,
  markNotificationRead,
  registerUser,
  saveProjectMemberRoles,
  seedWorkspace,
  selectCurrentUser,
  selectMyEpisodes,
  selectPermissions,
  selectPrimaryRole,
  selectProjectMembers,
  selectProjectOverview,
  selectUnreadNotifications,
  updateProject,
  updateProjectMemberPermissions
} from "@aigc/domain";
import type { EpisodeAssignment, EpisodeProductionStatus, PermissionKey, ProjectRole, WorkspaceState } from "@aigc/domain";

const roleLabels: Record<ProjectRole, string> = {
  owner: "项目所有者",
  coordinator: "统筹",
  head_writer: "主编剧",
  writer: "编剧",
  creator: "创作人"
};

const roleHelp: Record<ProjectRole, string> = {
  owner: "拥有全部项目管理权限",
  coordinator: "管理项目、成员和集数分配",
  head_writer: "查看全局剧本协作状态",
  writer: "查看编剧相关项目状态",
  creator: "只处理自己负责的集数"
};

const permissionLabels: Record<PermissionKey, string> = {
  canManageProjects: "管理项目",
  canManageMembers: "管理成员",
  canAssignEpisodes: "分配集数",
  canViewProjectOverview: "查看项目总览",
  canViewAllEpisodes: "查看全部集数",
  canSubmitWriting: "提交剧本协作",
  canReviewAssets: "审阅资产与重点",
  canViewAssignedEpisodes: "查看自己的负责集"
};

const assignmentLabels: Record<EpisodeAssignment["responsibility"], string> = {
  writer: "编剧负责",
  lead_creator: "主制作",
  creator: "创作制作",
  reviewer: "审阅负责",
  support: "协助"
};

const statusLabels: Record<EpisodeProductionStatus, string> = {
  not_started: "未开始",
  in_progress: "进行中",
  key_update: "待处理",
  blocked: "高风险",
  done: "已完成"
};

const shortcutItems = [
  { label: "集数分配", icon: ClipboardList },
  { label: "素材库", icon: Image },
  { label: "模型与模板", icon: BookOpen },
  { label: "文档中心", icon: FileText },
  { label: "团队成员", icon: Users },
  { label: "数据报表", icon: BarChart3 }
];

export function M1Dashboard() {
  const [state, setState] = useState<WorkspaceState>(seedWorkspace);
  const [selectedProjectId, setSelectedProjectId] = useState(seedWorkspace.projects[0].id);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectDraft, setProjectDraft] = useState({ name: "裂隙边境", code: "LX", episodeCount: 60 });
  const [memberDraft, setMemberDraft] = useState({
    userId: seedWorkspace.users[2].id,
    roles: ["writer"] as ProjectRole[]
  });
  const [permissionDraft, setPermissionDraft] = useState({
    userId: seedWorkspace.users[2].id,
    permissions: ["canViewProjectOverview", "canSubmitWriting", "canReviewAssets", "canViewAssignedEpisodes"] as PermissionKey[]
  });
  const [assignmentDraft, setAssignmentDraft] = useState({
    userId: seedWorkspace.users[3].id,
    responsibility: "creator" as EpisodeAssignment["responsibility"],
    episodeFrom: 1,
    episodeTo: 8
  });
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>("episode-jc-3");
  const [activeModule, setActiveModule] = useState("项目总览");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const currentUser = selectCurrentUser(state);
  const activeProjects = state.projects.filter((project) => project.status === "active");
  const selectedProject = state.projects.find((project) => project.id === selectedProjectId) ?? activeProjects[0];

  if (!currentUser || !selectedProject) {
    return <AuthGate state={state} setState={setState} />;
  }

  const permissions = selectPermissions(state, currentUser.id, selectedProject.id);
  const primaryRole = selectPrimaryRole(state, currentUser.id, selectedProject.id);
  const overview = selectProjectOverview(state, selectedProject.id);
  const projectMembers = selectProjectMembers(state, selectedProject.id);
  const myEpisodes = selectMyEpisodes(state, currentUser.id);
  const unreadNotifications = selectUnreadNotifications(state, currentUser.id);
  const inProgressCount = overview.episodes.filter((episode) => episode.productionStatus === "in_progress").length;
  const pendingCount = overview.episodes.filter((episode) => episode.productionStatus === "key_update").length;
  const todayTasks = buildTodayTasks(myEpisodes, selectedProject.name);
  const recentUpdates = buildRecentUpdates(overview.episodes, selectedProject.name);
  const selectedEpisode = overview.episodes.find((episode) => episode.id === selectedEpisodeId) ?? overview.episodes[0];
  const assignmentSummary = buildAssignmentSummary(overview.episodes);
  const searchResults = buildSearchResults(searchQuery, activeProjects, projectMembers, overview.episodes);

  function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState((current) => {
      const next = createProject(current, projectDraft);
      const created = next.projects.at(-1);
      if (created) {
        setSelectedProjectId(created.id);
      }
      return next;
    });
  }

  function handleStartNewProject() {
    setEditingProjectId(null);
    setProjectDraft({ name: "新项目", code: "NEW", episodeCount: 12 });
  }

  function handleUpdateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProjectId) {
      return;
    }

    setState((current) => updateProject(current, editingProjectId, projectDraft));
    setEditingProjectId(null);
  }

  function handleArchiveProject(projectId: string) {
    setState((current) => archiveProject(current, projectId));
    const nextProject = activeProjects.find((project) => project.id !== projectId);
    if (nextProject) {
      setSelectedProjectId(nextProject.id);
    }
  }

  function handleUpsertMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState((current) =>
      saveProjectMemberRoles(current, {
        projectId: selectedProject.id,
        ...memberDraft
      })
    );
  }

  function handleUpdateMemberPermissions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState((current) =>
      updateProjectMemberPermissions(current, {
        projectId: selectedProject.id,
        ...permissionDraft
      })
    );
  }

  function handleAssignEpisodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState((current) =>
      assignEpisodes(current, {
        projectId: selectedProject.id,
        userId: assignmentDraft.userId,
        episodeFrom: assignmentDraft.episodeFrom,
        episodeTo: assignmentDraft.episodeTo,
        responsibility: assignmentDraft.responsibility
      })
    );
  }

  return (
    <main className="replica-shell">
      <IconRail
        activeModule={activeModule}
        currentUser={currentUser}
        onLogout={() => setState((current) => logout(current))}
        onSelectModule={setActiveModule}
      />

      <section className="replica-main">
        <header className="replica-topbar">
          <div className="topbar-project">
            <strong>AIGC 协作台</strong>
            <span>{selectedProject.name} / M1 工作台</span>
          </div>
          <div className="topbar-actions">
            <label className="search-box">
              <Search size={15} />
              <input
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索（Ctrl+K）"
                value={searchQuery}
              />
              {searchResults.length > 0 ? (
                <div className="search-popover">
                  {searchResults.map((item) => (
                    <button
                      key={`${item.type}-${item.id}`}
                      onClick={() => {
                        setActiveModule(item.module);
                        if (item.episodeId) {
                          setSelectedEpisodeId(item.episodeId);
                        }
                        setSearchQuery("");
                      }}
                      type="button"
                    >
                      <strong>{item.title}</strong>
                      <span>{item.meta}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </label>
            <button
              className="top-icon-button has-badge"
              onClick={() => {
                setNoticeOpen((open) => !open);
                setUserMenuOpen(false);
              }}
              title="通知"
              type="button"
            >
              <Bell size={17} />
              <span>{unreadNotifications.length}</span>
            </button>
            <button
              className="user-menu"
              onClick={() => {
                setUserMenuOpen((open) => !open);
                setNoticeOpen(false);
              }}
              type="button"
            >
              <span className={`avatar tiny ${currentUser.avatarTone}`}>{currentUser.name.slice(0, 1)}</span>
              <ChevronDown size={15} />
            </button>
            {noticeOpen ? (
              <FloatingPanel title="通知">
                <CompactNotificationList
                  notifications={unreadNotifications}
                  onRead={(notificationId) => setState((current) => markNotificationRead(current, notificationId))}
                />
              </FloatingPanel>
            ) : null}
            {userMenuOpen ? (
              <FloatingPanel title={currentUser.name}>
                <div className="menu-stack">
                  <span>{roleLabels[primaryRole]}</span>
                  <button onClick={() => setState((current) => logout(current))} type="button">
                    退出登录
                  </button>
                </div>
              </FloatingPanel>
            ) : null}
          </div>
        </header>

        <div className="replica-grid">
          <aside className="personal-column">
            <section className="hello-card">
              <span className={`avatar ${currentUser.avatarTone}`}>{currentUser.name.slice(0, 1)}</span>
              <div>
                <h1>你好，{currentUser.name}</h1>
                <p>{roleLabels[primaryRole]}</p>
              </div>
            </section>

            <section className="panel today-card">
              <PanelTitle title="今日任务" eyebrow={`${todayTasks.length} 项`} />
              <div className="task-list">
                {todayTasks.map((task) => (
                  <article className={`task-item ${task.status}`} key={task.title}>
                    <span />
                    <div>
                      <strong>{task.title}</strong>
                      <small>{task.meta}</small>
                    </div>
                    <em>{task.badge}</em>
                  </article>
                ))}
              </div>
              <button className="text-link" onClick={() => setActiveModule("任务中心")} type="button">查看全部任务（{Math.max(todayTasks.length, 6)}）</button>
            </section>

            <section className="panel mine-card">
              <PanelTitle title={`我的集（${myEpisodes.length}）`} eyebrow="进度" />
              <div className="mine-list">
                {myEpisodes.slice(0, 3).map((episode) => (
                  <article key={`${episode.projectCode}-${episode.episodeNo}`}>
                    <div>
                      <strong>第 {episode.episodeNo} 集 · {episode.projectName}</strong>
                      <small>{assignmentLabels[episode.responsibility]}</small>
                    </div>
                    <ProgressBar value={episode.productionStatus === "in_progress" ? 60 : episode.productionStatus === "key_update" ? 35 : 15} />
                  </article>
                ))}
              </div>
            </section>
          </aside>

          <section className="project-banner">
            <img alt="" src="/assets/jincheng-banner.png" />
            <div className="banner-shade" />
            <div className="banner-copy">
              <span>当前项目</span>
              <h2>{selectedProject.name}</h2>
              <p>科幻 / {selectedProject.episodeCount} 集 / {inProgressCount} 制作中</p>
            </div>
            <div className="banner-stats">
              <Metric label="总集数" value={selectedProject.episodeCount.toString()} />
              <Metric label="我的参与" value={myEpisodes.length.toString()} />
              <Metric label="进行中" value={inProgressCount.toString()} />
            </div>
            <button className="banner-button" onClick={() => setActiveModule("项目总览")} type="button">进入项目</button>
          </section>

          <NotificationsPanel
            notifications={unreadNotifications}
            onRead={(notificationId) => setState((current) => markNotificationRead(current, notificationId))}
          />

          <UpdatesPanel updates={recentUpdates} />

          <section className="panel shortcuts-panel">
            <PanelTitle title="快捷入口" />
            <div className="shortcut-grid">
              {shortcutItems.map((item) => (
                <button key={item.label} onClick={() => setActiveModule(item.label)} type="button">
                  <item.icon size={20} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel status-panel">
            <PanelTitle title="项目状态灯" eyebrow={`${overview.memberCount} 位成员 · ${overview.episodes.length} 集`} />
            <div className="episode-grid" role="list" aria-label="集状态灯">
              {overview.episodes.slice(0, 36).map((episode) => (
                <button
                  className={`episode-cell ${episode.productionStatus} ${selectedEpisode.id === episode.id ? "selected" : ""}`}
                  key={episode.id}
                  onClick={() => {
                    setSelectedEpisodeId(episode.id);
                    setActiveModule("集工作台");
                  }}
                  type="button"
                >
                  <span className="status-dot" />
                  <strong>{episode.episodeNo}</strong>
                  <span>{statusLabels[episode.productionStatus]}</span>
                  <small>
                    {episode.assignments.length > 0
                      ? episode.assignments.map((assignment) => assignment.userName).join("、")
                      : "未分配"}
                  </small>
                </button>
              ))}
            </div>
          </section>

          <ModuleWorkbench
            activeModule={activeModule}
            assignmentSummary={assignmentSummary}
            episode={selectedEpisode}
            projectName={selectedProject.name}
            recentUpdates={recentUpdates}
            tasks={todayTasks}
          />

          {permissions.canManageProjects || permissions.canManageMembers || permissions.canAssignEpisodes ? (
            <section className="ops-drawer">
              {permissions.canManageProjects ? (
                <ProjectOpsPanel
                  activeProjects={activeProjects}
                  editingProjectId={editingProjectId}
                  handleArchiveProject={handleArchiveProject}
                  handleCreateProject={handleCreateProject}
                  handleStartNewProject={handleStartNewProject}
                  handleUpdateProject={handleUpdateProject}
                  projectDraft={projectDraft}
                  setEditingProjectId={setEditingProjectId}
                  setProjectDraft={setProjectDraft}
                />
              ) : null}
              {permissions.canManageMembers ? (
                <MembersPanel
                  handleUpdateMemberPermissions={handleUpdateMemberPermissions}
                  handleUpsertMember={handleUpsertMember}
                  memberDraft={memberDraft}
                  members={projectMembers}
                  permissionDraft={permissionDraft}
                  setPermissionDraft={setPermissionDraft}
                  setMemberDraft={setMemberDraft}
                  users={state.users}
                />
              ) : null}
              {permissions.canAssignEpisodes ? (
                <AssignmentPanel
                  assignmentDraft={assignmentDraft}
                  assignmentSummary={assignmentSummary}
                  handleAssignEpisodes={handleAssignEpisodes}
                  projectMembers={projectMembers}
                  setAssignmentDraft={setAssignmentDraft}
                />
              ) : null}
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function AuthGate({
  state,
  setState
}: {
  state: WorkspaceState;
  setState: React.Dispatch<React.SetStateAction<WorkspaceState>>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginUserId, setLoginUserId] = useState("user-creator-a");
  const [registerDraft, setRegisterDraft] = useState({ name: "linyu", role: "creator" as ProjectRole });
  const previewStats = useMemo(
    () => [
      { label: "活跃项目", value: state.projects.filter((project) => project.status === "active").length },
      { label: "协作成员", value: state.users.length },
      { label: "剧集总量", value: state.episodes.length }
    ],
    [state]
  );

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState((current) => loginAsUser(current, loginUserId));
  }

  function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState((current) => registerUser(current, registerDraft));
  }

  return (
    <main className="auth-shell">
      <section className="auth-copy">
        <div className="brand large">
          <div className="brand-mark">
            <Clapperboard size={26} />
          </div>
          <div>
            <strong>AIGC 协作台</strong>
            <span>M1 登录与角色入口</span>
          </div>
        </div>
        <h1>选择一个身份，进入自己的工作视图。</h1>
        <p>默认先以创作人视角进入，看到个人负责集、通知和风险事项；统筹账号仍可进入项目管理与分配区。</p>

        <div className="auth-stats">
          {previewStats.map((item) => (
            <div key={item.label}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-card-header">
          <Sparkles size={18} />
          <span>Personal Workspace</span>
        </div>
        <div className="segmented">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">
            登录
          </button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")} type="button">
            注册
          </button>
        </div>

        {mode === "login" ? (
          <form className="form-stack" onSubmit={handleLogin}>
            <label>
              选择已有账号
              <select value={loginUserId} onChange={(event) => setLoginUserId(event.target.value)}>
                {state.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {roleLabels[user.defaultRole]}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button" type="submit">
              <LogIn size={16} />
              进入我的工作台
            </button>
          </form>
        ) : (
          <form className="form-stack" onSubmit={handleRegister}>
            <label>
              名称
              <input
                value={registerDraft.name}
                onChange={(event) => setRegisterDraft((draft) => ({ ...draft, name: event.target.value }))}
                placeholder="例如 linyu"
              />
            </label>
            <label>
              角色
              <select
                value={registerDraft.role}
                onChange={(event) => setRegisterDraft((draft) => ({ ...draft, role: event.target.value as ProjectRole }))}
              >
                {Object.entries(roleLabels).map(([role, label]) => (
                  <option key={role} value={role}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button" type="submit">
              <UserPlus size={16} />
              注册并进入
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function IconRail({
  activeModule,
  currentUser,
  onLogout,
  onSelectModule
}: {
  activeModule: string;
  currentUser: NonNullable<ReturnType<typeof selectCurrentUser>>;
  onLogout: () => void;
  onSelectModule: (module: string) => void;
}) {
  const icons = [
    { icon: Home, label: "项目总览" },
    { icon: Inbox, label: "通知中心" },
    { icon: CalendarDays, label: "任务中心" },
    { icon: Package, label: "素材库" },
    { icon: FileText, label: "文档中心" },
    { icon: Users, label: "团队成员" },
    { icon: BarChart3, label: "数据报表" },
    { icon: Settings, label: "系统设置" }
  ];

  return (
    <aside className="icon-rail" aria-label="主导航">
      <span className={`avatar mini ${currentUser.avatarTone}`}>{currentUser.name.slice(0, 1)}</span>
      <nav>
        {icons.map((item) => (
          <button
            className={activeModule === item.label ? "active" : ""}
            key={item.label}
            onClick={() => onSelectModule(item.label)}
            title={item.label}
            type="button"
          >
            <item.icon size={18} />
          </button>
        ))}
      </nav>
      <button className="rail-logout" onClick={onLogout} title="退出登录" type="button">
        <LogOut size={17} />
      </button>
    </aside>
  );
}

function NotificationsPanel({
  notifications,
  onRead
}: {
  notifications: ReturnType<typeof selectUnreadNotifications>;
  onRead: (notificationId: string) => void;
}) {
  return (
    <section className="panel notifications-card">
      <PanelTitle title="未读通知" eyebrow={notifications.length.toString()} />
      <div className="notification-list">
        {notifications.length === 0 ? (
          <p className="empty-state">当前没有未读通知。</p>
        ) : (
          notifications.slice(0, 5).map((notification) => (
            <article className="notification-line" key={notification.id}>
              <span />
              <div>
                <strong>{notification.title}</strong>
                <small>{notification.body}</small>
              </div>
              <button onClick={() => onRead(notification.id)} title="标记已读" type="button">
                <Check size={14} />
              </button>
            </article>
          ))
        )}
      </div>
      <button className="text-link" type="button">查看全部</button>
    </section>
  );
}

function CompactNotificationList({
  notifications,
  onRead
}: {
  notifications: ReturnType<typeof selectUnreadNotifications>;
  onRead: (notificationId: string) => void;
}) {
  if (notifications.length === 0) {
    return <p className="empty-state">当前没有未读通知。</p>;
  }

  return (
    <div className="floating-list">
      {notifications.map((notification) => (
        <article key={notification.id}>
          <div>
            <strong>{notification.title}</strong>
            <span>{notification.body}</span>
          </div>
          <button onClick={() => onRead(notification.id)} type="button">
            已读
          </button>
        </article>
      ))}
    </div>
  );
}

function FloatingPanel({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="floating-panel">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function UpdatesPanel({ updates }: { updates: ReturnType<typeof buildRecentUpdates> }) {
  return (
    <section className="panel updates-card">
      <PanelTitle title="最近更新" />
      <div className="update-list">
        {updates.map((item) => (
          <article key={item.title}>
            <span className={`avatar mini ${item.tone}`}>{item.name.slice(0, 1)}</span>
            <div>
              <strong>{item.title}</strong>
              <small>{item.meta}</small>
            </div>
            <em>{item.status}</em>
          </article>
        ))}
      </div>
      <button className="text-link" type="button">查看全部更新</button>
    </section>
  );
}

function ModuleWorkbench({
  activeModule,
  assignmentSummary,
  episode,
  projectName,
  recentUpdates,
  tasks
}: {
  activeModule: string;
  assignmentSummary: AssignmentSummaryItem[];
  episode: ReturnType<typeof selectProjectOverview>["episodes"][number];
  projectName: string;
  recentUpdates: ReturnType<typeof buildRecentUpdates>;
  tasks: ReturnType<typeof buildTodayTasks>;
}) {
  if (activeModule === "集工作台") {
    return (
      <section className="panel module-panel">
        <PanelTitle title={`第 ${episode.episodeNo} 集工作台`} eyebrow={projectName} />
        <div className="episode-workbench">
          <div>
            <span className={`status-pill ${episode.productionStatus}`}>{statusLabels[episode.productionStatus]}</span>
            <p>这里是 M1 的集工作台入口空壳。M2 会接入当前生效剧本、diff、创作重点和问题反馈；M3 会接入资产位。</p>
          </div>
          <div className="detail-grid">
            <DetailItem label="负责人" value={episode.assignments.map((item) => `${item.userName} · ${assignmentLabels[item.responsibility]}`).join("、") || "未分配"} />
            <DetailItem label="资产待办" value={`${episode.assetTodoCount} 项`} />
            <DetailItem label="问题反馈" value={`${episode.openIssueCount} 条`} />
          </div>
        </div>
      </section>
    );
  }

  if (activeModule === "任务中心") {
    return (
      <section className="panel module-panel">
        <PanelTitle title="任务中心" eyebrow={`${tasks.length} tasks`} />
        <div className="module-list">
          {tasks.map((task) => (
            <article key={task.title}>
              <strong>{task.title}</strong>
              <span>{task.meta} · {task.badge}</span>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (activeModule === "通知中心") {
    return (
      <section className="panel module-panel">
        <PanelTitle title="通知中心" eyebrow="M1" />
        <p className="empty-state">顶部通知按钮和右侧未读通知列表已可标记已读。完整筛选、跳转和通知历史会在后续持久化阶段补齐。</p>
      </section>
    );
  }

  if (activeModule === "团队成员") {
    return (
      <section className="panel module-panel">
        <PanelTitle title="团队成员与当前分配" eyebrow={`${assignmentSummary.length} groups`} />
        <AssignmentSummaryList items={assignmentSummary} />
      </section>
    );
  }

  if (activeModule === "项目总览") {
    return (
      <section className="panel module-panel">
        <PanelTitle title="项目总览说明" eyebrow="M1" />
        <div className="module-list">
          {recentUpdates.slice(0, 3).map((item) => (
            <article key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.meta} · {item.status}</span>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="panel module-panel">
      <PanelTitle title={activeModule} eyebrow="暂未开放" />
      <p className="empty-state">这个入口已经在 M1 中有明确反馈，但完整业务能力属于后续模块：素材库对应 M3，文档中心对应 M2/M1 Bible，数据报表和系统设置会在持久化后实现。</p>
    </section>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AssignmentSummaryList({ items }: { items: AssignmentSummaryItem[] }) {
  if (items.length === 0) {
    return <p className="empty-state">当前项目还没有集数分配。</p>;
  }

  return (
    <div className="assignment-summary-list">
      {items.map((item) => (
        <article key={`${item.userName}-${item.responsibility}`}>
          <span className={`avatar mini ${item.avatarTone}`}>{item.userName.slice(0, 1)}</span>
          <div>
            <strong>{item.userName} · {assignmentLabels[item.responsibility]}</strong>
            <small>{item.ranges.join("、")}</small>
          </div>
        </article>
      ))}
    </div>
  );
}

function ProjectOpsPanel({
  activeProjects,
  editingProjectId,
  handleArchiveProject,
  handleCreateProject,
  handleStartNewProject,
  handleUpdateProject,
  projectDraft,
  setEditingProjectId,
  setProjectDraft
}: {
  activeProjects: WorkspaceState["projects"];
  editingProjectId: string | null;
  handleArchiveProject: (projectId: string) => void;
  handleCreateProject: (event: FormEvent<HTMLFormElement>) => void;
  handleStartNewProject: () => void;
  handleUpdateProject: (event: FormEvent<HTMLFormElement>) => void;
  projectDraft: { name: string; code: string; episodeCount: number };
  setEditingProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  setProjectDraft: React.Dispatch<React.SetStateAction<{ name: string; code: string; episodeCount: number }>>;
}) {
  return (
    <section className="panel ops-panel">
      <div className="panel-title-row">
        <PanelTitle title={editingProjectId ? "编辑项目" : "项目管理"} eyebrow="Project" />
        {editingProjectId ? (
          <button className="secondary-button compact" onClick={handleStartNewProject} type="button">
            <CirclePlus size={15} />
            新增项目
          </button>
        ) : null}
      </div>
      <form className="form-stack" onSubmit={editingProjectId ? handleUpdateProject : handleCreateProject}>
        <label>
          项目名
          <input value={projectDraft.name} onChange={(event) => setProjectDraft((draft) => ({ ...draft, name: event.target.value }))} />
        </label>
        <div className="inline-fields">
          <label>
            代号
            <input value={projectDraft.code} onChange={(event) => setProjectDraft((draft) => ({ ...draft, code: event.target.value }))} />
          </label>
          <label>
            集数
            <input
              min={1}
              max={200}
              type="number"
              value={projectDraft.episodeCount}
              onChange={(event) => setProjectDraft((draft) => ({ ...draft, episodeCount: Number(event.target.value) }))}
            />
          </label>
        </div>
        <button className="primary-button" type="submit">
          {editingProjectId ? <Save size={16} /> : <CirclePlus size={16} />}
          {editingProjectId ? "保存项目" : "创建项目"}
        </button>
      </form>

      <div className="compact-list">
        {activeProjects.map((project) => (
          <div className="project-row" key={project.id}>
            <span>
              <strong>{project.name}</strong>
              <small>{project.code} · {project.episodeCount} 集</small>
            </span>
            <div className="row-actions">
              <button
                className="icon-button"
                onClick={() => {
                  setEditingProjectId(project.id);
                  setProjectDraft({
                    name: project.name,
                    code: project.code,
                    episodeCount: project.episodeCount
                  });
                }}
                title="编辑项目"
                type="button"
              >
                <Pencil size={16} />
              </button>
              <button className="icon-button danger" onClick={() => handleArchiveProject(project.id)} title="归档项目" type="button">
                <Archive size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MembersPanel({
  handleUpdateMemberPermissions,
  handleUpsertMember,
  memberDraft,
  members,
  permissionDraft,
  setPermissionDraft,
  setMemberDraft,
  users
}: {
  handleUpdateMemberPermissions: (event: FormEvent<HTMLFormElement>) => void;
  handleUpsertMember: (event: FormEvent<HTMLFormElement>) => void;
  memberDraft: { userId: string; roles: ProjectRole[] };
  members: ReturnType<typeof selectProjectMembers>;
  permissionDraft: { userId: string; permissions: PermissionKey[] };
  setPermissionDraft: React.Dispatch<React.SetStateAction<{ userId: string; permissions: PermissionKey[] }>>;
  setMemberDraft: React.Dispatch<React.SetStateAction<{ userId: string; roles: ProjectRole[] }>>;
  users: WorkspaceState["users"];
}) {
  const selectedPermissionMember = members.find((member) => member.userId === permissionDraft.userId) ?? members[0];
  const roleEntries = Object.entries(roleLabels) as [ProjectRole, string][];
  const permissionEntries = Object.entries(permissionLabels) as [PermissionKey, string][];

  function toggleRole(role: ProjectRole) {
    setMemberDraft((draft) => {
      const hasRole = draft.roles.includes(role);
      const roles = hasRole ? draft.roles.filter((item) => item !== role) : [...draft.roles, role];
      return { ...draft, roles: roles.length > 0 ? roles : draft.roles };
    });
  }

  function togglePermission(permission: PermissionKey) {
    setPermissionDraft((draft) => {
      const hasPermission = draft.permissions.includes(permission);
      return {
        ...draft,
        permissions: hasPermission
          ? draft.permissions.filter((item) => item !== permission)
          : [...draft.permissions, permission]
      };
    });
  }

  function handlePermissionMemberChange(userId: string) {
    const member = members.find((item) => item.userId === userId);
    setPermissionDraft({
      userId,
      permissions: member?.permissions ?? []
    });
  }

  return (
    <section className="panel ops-panel">
      <PanelTitle title="成员与角色" eyebrow="Access" />
      <form className="form-stack" onSubmit={handleUpsertMember}>
        <label>
          成员
          <select
            value={memberDraft.userId}
            onChange={(event) => {
              const member = members.find((item) => item.userId === event.target.value);
              setMemberDraft((draft) => ({
                ...draft,
                userId: event.target.value,
                roles: member?.roles ?? draft.roles
              }));
            }}
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <div className="choice-group" aria-label="角色">
          {roleEntries.map(([role, label]) => (
            <label className="check-row" key={role}>
              <input checked={memberDraft.roles.includes(role)} onChange={() => toggleRole(role)} type="checkbox" />
              <span>
                <strong>{label}</strong>
                <small>{roleHelp[role]}</small>
              </span>
            </label>
          ))}
        </div>
        <button className="primary-button" type="submit">
          <UserPlus size={16} />
          保存成员身份
        </button>
      </form>

      {members.length > 0 ? (
        <form className="form-stack permission-form" onSubmit={handleUpdateMemberPermissions}>
          <label>
            权限分配
            <select value={selectedPermissionMember?.userId ?? ""} onChange={(event) => handlePermissionMemberChange(event.target.value)}>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.userName} · {member.roles.map((role) => roleLabels[role]).join("、")}
                </option>
              ))}
            </select>
          </label>
          <div className="choice-group permissions" aria-label="权限">
            {permissionEntries.map(([permission, label]) => (
              <label className="check-row" key={permission}>
                <input
                  checked={permissionDraft.permissions.includes(permission)}
                  onChange={() => togglePermission(permission)}
                  type="checkbox"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <button className="secondary-button" type="submit">
            <ShieldCheck size={16} />
            保存权限
          </button>
        </form>
      ) : null}

      <div className="member-list">
        {members.map((member) => (
          <article key={member.id}>
            <span className={`avatar mini ${member.avatarTone}`}>{member.userName.slice(0, 1)}</span>
            <div>
              <strong>{member.userName}</strong>
              <small>{member.roles.map((role) => roleLabels[role]).join("、")}</small>
              <small>
                权限：{member.permissions.map((permission) => permissionLabels[permission]).join("、")}
                {member.hasCustomPermissions ? "（已自定义）" : ""}
              </small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AssignmentPanel({
  assignmentDraft,
  assignmentSummary,
  handleAssignEpisodes,
  projectMembers,
  setAssignmentDraft
}: {
  assignmentDraft: { userId: string; responsibility: EpisodeAssignment["responsibility"]; episodeFrom: number; episodeTo: number };
  assignmentSummary: AssignmentSummaryItem[];
  handleAssignEpisodes: (event: FormEvent<HTMLFormElement>) => void;
  projectMembers: ReturnType<typeof selectProjectMembers>;
  setAssignmentDraft: React.Dispatch<
    React.SetStateAction<{ userId: string; responsibility: EpisodeAssignment["responsibility"]; episodeFrom: number; episodeTo: number }>
  >;
}) {
  return (
    <section className="panel ops-panel">
      <PanelTitle title="集数分配" eyebrow="Assignment" />
      <form className="form-stack" onSubmit={handleAssignEpisodes}>
        <label>
          成员
          <select value={assignmentDraft.userId} onChange={(event) => setAssignmentDraft((draft) => ({ ...draft, userId: event.target.value }))}>
            {projectMembers.map((member) => (
              <option key={member.id} value={member.userId}>
                {member.userName} · {roleLabels[member.role]}
              </option>
            ))}
          </select>
        </label>
        <label>
          分工类型
          <select
            value={assignmentDraft.responsibility}
            onChange={(event) =>
              setAssignmentDraft((draft) => ({
                ...draft,
                responsibility: event.target.value as EpisodeAssignment["responsibility"]
              }))
            }
          >
            {Object.entries(assignmentLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <EpisodeRangeFields
          episodeFrom={assignmentDraft.episodeFrom}
          episodeTo={assignmentDraft.episodeTo}
          onChange={(range) => setAssignmentDraft((draft) => ({ ...draft, ...range }))}
        />
        <button className="primary-button" type="submit">
          <Save size={16} />
          分配集范围
        </button>
      </form>
      <AssignmentSummaryList items={assignmentSummary.slice(0, 4)} />
    </section>
  );
}

function EpisodeRangeFields({
  episodeFrom,
  episodeTo,
  onChange
}: {
  episodeFrom: number;
  episodeTo: number;
  onChange: (range: { episodeFrom?: number; episodeTo?: number }) => void;
}) {
  return (
    <div className="inline-fields">
      <label>
        起始集
        <input min={1} type="number" value={episodeFrom} onChange={(event) => onChange({ episodeFrom: Number(event.target.value) })} />
      </label>
      <label>
        结束集
        <input min={1} type="number" value={episodeTo} onChange={(event) => onChange({ episodeTo: Number(event.target.value) })} />
      </label>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="banner-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress-line">
      <span style={{ width: `${value}%` }} />
      <em>{value}%</em>
    </div>
  );
}

function PanelTitle({ title, eyebrow }: { title: string; eyebrow?: string }) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      {eyebrow ? <small>{eyebrow}</small> : null}
    </div>
  );
}

function buildTodayTasks(episodes: ReturnType<typeof selectMyEpisodes>, fallbackProjectName: string) {
  const source = episodes.length > 0 ? episodes : [];
  const tasks = source.slice(0, 3).map((episode) => ({
    title: `第 ${episode.episodeNo} 集 · ${episode.projectName}`,
    meta: episode.openIssueCount ? `问题 ${episode.openIssueCount}` : episode.assetTodoCount ? `资产 ${episode.assetTodoCount}` : "优先级 · 中",
    badge: statusLabels[episode.productionStatus],
    status: episode.productionStatus
  }));

  return tasks.length > 0
    ? tasks
    : [
        { title: `第 27 集 · ${fallbackProjectName}`, meta: "优先级 · 高", badge: "待处理", status: "key_update" as const },
        { title: `第 28 集 · ${fallbackProjectName}`, meta: "截止 5/21", badge: "进行中", status: "in_progress" as const },
        { title: `第 31 集 · ${fallbackProjectName}`, meta: "协作补充", badge: "待处理", status: "key_update" as const }
      ];
}

function buildRecentUpdates(episodes: ReturnType<typeof selectProjectOverview>["episodes"], projectName: string) {
  return episodes
    .filter((episode) => episode.productionStatus !== "not_started" || episode.openIssueCount || episode.assetTodoCount)
    .slice(0, 5)
    .map((episode, index) => ({
      name: ["周", "林", "陈", "沈", "王"][index] ?? "协",
      tone: ["amber", "violet", "ink", "teal", "rose"][index] ?? "ink",
      title: `第 ${episode.episodeNo} 集 ${projectName}`,
      meta: episode.openIssueCount ? "问题待处理" : episode.assetTodoCount ? "资产准备中" : "状态已更新",
      status: statusLabels[episode.productionStatus]
    }));
}

type AssignmentSummaryItem = {
  avatarTone: string;
  episodeNos: number[];
  ranges: string[];
  responsibility: EpisodeAssignment["responsibility"];
  userName: string;
};

type SearchResult = {
  episodeId?: string;
  id: string;
  meta: string;
  module: string;
  title: string;
  type: string;
};

function buildAssignmentSummary(episodes: ReturnType<typeof selectProjectOverview>["episodes"]): AssignmentSummaryItem[] {
  const groups = new Map<string, AssignmentSummaryItem>();

  for (const episode of episodes) {
    for (const assignment of episode.assignments) {
      const key = `${assignment.userId}-${assignment.responsibility}`;
      const existing = groups.get(key);

      if (existing) {
        existing.episodeNos.push(episode.episodeNo);
      } else {
        groups.set(key, {
          avatarTone: "ink",
          episodeNos: [episode.episodeNo],
          ranges: [],
          responsibility: assignment.responsibility,
          userName: assignment.userName
        });
      }
    }
  }

  return Array.from(groups.values())
    .map((item) => ({
      ...item,
      episodeNos: item.episodeNos.sort((a, b) => a - b),
      ranges: compactEpisodeRanges(item.episodeNos)
    }))
    .sort((a, b) => a.userName.localeCompare(b.userName, "zh-CN"));
}

function compactEpisodeRanges(episodeNos: number[]) {
  if (episodeNos.length === 0) {
    return [];
  }

  const ranges: string[] = [];
  let start = episodeNos[0];
  let previous = episodeNos[0];

  for (const episodeNo of episodeNos.slice(1)) {
    if (episodeNo === previous + 1) {
      previous = episodeNo;
      continue;
    }

    ranges.push(start === previous ? `第 ${start} 集` : `第 ${start}-${previous} 集`);
    start = episodeNo;
    previous = episodeNo;
  }

  ranges.push(start === previous ? `第 ${start} 集` : `第 ${start}-${previous} 集`);
  return ranges;
}

function buildSearchResults(
  query: string,
  projects: WorkspaceState["projects"],
  members: ReturnType<typeof selectProjectMembers>,
  episodes: ReturnType<typeof selectProjectOverview>["episodes"]
): SearchResult[] {
  const keyword = query.trim().toLowerCase();

  if (!keyword) {
    return [];
  }

  return [
    ...projects
      .filter((project) => project.name.toLowerCase().includes(keyword) || project.code.toLowerCase().includes(keyword))
      .map((project) => ({
        id: project.id,
        meta: `${project.episodeCount} 集`,
        module: "项目总览",
        title: project.name,
        type: "project"
      })),
    ...members
      .filter(
        (member) =>
          member.userName.toLowerCase().includes(keyword) ||
          member.roles.some((role) => roleLabels[role].toLowerCase().includes(keyword))
      )
      .map((member) => ({
        id: member.id,
        meta: member.roles.map((role) => roleLabels[role]).join("、"),
        module: "团队成员",
        title: member.userName,
        type: "member"
      })),
    ...episodes
      .filter((episode) => `第 ${episode.episodeNo} 集`.includes(keyword) || statusLabels[episode.productionStatus].toLowerCase().includes(keyword))
      .slice(0, 8)
      .map((episode) => ({
        episodeId: episode.id,
        id: episode.id,
        meta: statusLabels[episode.productionStatus],
        module: "集工作台",
        title: `第 ${episode.episodeNo} 集`,
        type: "episode"
      }))
  ].slice(0, 8);
}
