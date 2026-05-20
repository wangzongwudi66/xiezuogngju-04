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
  Download,
  FileText,
  FolderKanban,
  GitCompareArrows,
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
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  archiveProject,
  assignEpisodes,
  createEpisodeScriptDocxBlob,
  createDeliveryPackageDraft,
  createProject,
  loginAsUser,
  logout,
  markNotificationRead,
  parseWordDelivery,
  publishDeliveryPackage,
  registerUser,
  rejectDeliveryPackage,
  saveProjectMemberRoles,
  seedWorkspace,
  selectCurrentUser,
  selectDeliveryPackageDetail,
  selectEpisodeScriptTimeline,
  selectMyEpisodes,
  selectPermissions,
  selectPrimaryRole,
  selectProjectMembers,
  selectProjectOverview,
  selectUnreadNotifications,
  submitDeliveryPackageForReview,
  updateDeliveryPackageConfirmation,
  updateProject,
  updateProjectMemberPermissions
} from "@aigc/domain";
import type {
  DeliveryPackageDraftInput,
  DeliveryPackageStatus,
  EpisodeAssignment,
  EpisodeProductionStatus,
  PermissionKey,
  ProjectRole,
  WordDeliveryIssue,
  WorkspaceState
} from "@aigc/domain";
import { buildTodayTasks } from "./dashboard-tasks";
import { buildDeliveryPackageDraftFromParsed, buildTextDeliveryPackageDraft } from "./delivery-text-parser";
import { clearM2WorkspacePersistence, readM2WorkspacePersistence, writeM2WorkspacePersistence } from "./workspace-persistence";
import type { DeliveryImportJob } from "./workspace-persistence";

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

const deliveryStatusLabels: Record<DeliveryPackageStatus, string> = {
  draft: "草稿",
  pending_review: "待发布",
  published: "已发布",
  rejected: "已驳回"
};

type NavigationItem = {
  icon: LucideIcon;
  label: string;
};

const baseShortcutItems: NavigationItem[] = [
  { label: "集数分配", icon: ClipboardList },
  { label: "素材库", icon: Image },
  { label: "模型与模板", icon: BookOpen },
  { label: "交稿中心", icon: FileText },
  { label: "团队成员", icon: Users },
  { label: "数据报表", icon: BarChart3 }
];

type MockDeliveryKey = "range-1-10" | "range-1-20" | "single-replace-5";
type WordUploadType = "range" | "single_replace";
type WordUploadStatus = "empty" | "selected" | "parsing" | "success" | "failed";
type TextParseFeedback = {
  tone: "success" | "warning" | "error";
  title: string;
  issues: WordDeliveryIssue[];
  remedies?: string[];
};

const deliveryImportJobStatusLabels: Record<DeliveryImportJob["status"], string> = {
  processing: "处理中",
  success: "已生成草稿",
  failed: "解析失败"
};

const wordUploadStatusCopy: Record<WordUploadStatus, { title: string; body: string }> = {
  empty: {
    title: "待选择文件",
    body: "先选择或拖入 .docx 文件。上传后只会切成单集草稿，不会立刻发布。"
  },
  selected: {
    title: "已选择文件",
    body: "文件已就绪。下一步会解析 docx 正文并创建草稿，解析完成后仍需要在确认页勾选实际变更集。"
  },
  parsing: {
    title: "正在解析",
    body: "正在读取 Word 正文并按集切段。解析完成后会进入交稿确认。"
  },
  success: {
    title: "解析成功，等待确认",
    body: "已生成可确认的单集草稿。必须在确认页勾选实际变更集，提交后也不会立刻发布。"
  },
  failed: {
    title: "解析失败，可手动粘贴单集补救",
    body: "没有识别出可靠的单集内容。不要反复上传同一份文件；可以改用“手动粘贴单集文本”的补救流程，再确认这一集是否真的变更。"
  }
};

const wordUploadTypeLabels: Record<WordUploadType, string> = {
  range: "范围交稿",
  single_replace: "单集替换"
};

const mockDeliveryTemplates: Array<{
  key: MockDeliveryKey;
  label: string;
  description: string;
  build: (projectId: string, uploadedByUserId: string) => DeliveryPackageDraftInput;
}> = [
  {
    key: "range-1-10",
    label: "range 1-10 初版交稿",
    description: "预置第 1-10 集文本，默认确认 1、2、5 集有实际变更。",
    build: (projectId, uploadedByUserId) => ({
      projectId,
      uploadedByUserId,
      type: "range",
      declaredEpisodeFrom: 1,
      declaredEpisodeTo: 10,
      sourceFileName: "mock-jc-1-10.docx",
      title: "M2 mock：1-10 初版交稿",
      episodes: Array.from({ length: 10 }, (_, index) => {
        const episodeNo = index + 1;
        return {
          episodeNo,
          title: `第 ${episodeNo} 集`,
          content: `第 ${episodeNo} 集\n矿山入口版本 A。镜头强调角色目标与本集制作重点。`
        };
      }),
      confirmedEpisodeNos: [1, 2, 5]
    })
  },
  {
    key: "range-1-20",
    label: "range 1-20 retroactive",
    description: "模拟后续交稿，确认第 2 集回改、第 11-12 集新增。",
    build: (projectId, uploadedByUserId) => ({
      projectId,
      uploadedByUserId,
      type: "range",
      declaredEpisodeFrom: 1,
      declaredEpisodeTo: 20,
      sourceFileName: "mock-jc-1-20-retro.docx",
      title: "M2 mock：1-20 后续交稿",
      episodes: Array.from({ length: 20 }, (_, index) => {
        const episodeNo = index + 1;
        return {
          episodeNo,
          title: `第 ${episodeNo} 集`,
          content:
            episodeNo === 2
              ? "第 2 集\nretroactive 版本：线索提前露出，制作侧需要更新分镜重点。"
              : `第 ${episodeNo} 集\n二次交稿版本 B。保留项目主线，并补充本集制作提示。`
        };
      }),
      confirmedEpisodeNos: [2, 11, 12]
    })
  },
  {
    key: "single-replace-5",
    label: "single_replace 第 5 集",
    description: "整集替换第 5 集，只确认这一集变化。",
    build: (projectId, uploadedByUserId) => ({
      projectId,
      uploadedByUserId,
      type: "single_replace",
      declaredEpisodeFrom: 5,
      declaredEpisodeTo: 5,
      sourceFileName: "mock-jc-ep5-replace.docx",
      title: "M2 mock：第 5 集整集替换",
      episodes: [
        {
          episodeNo: 5,
          title: "第 5 集",
          content: "第 5 集\nsingle_replace 版本：整集重写为矿道坍塌救援线，旧分段全部失效。"
        }
      ],
      confirmedEpisodeNos: [5]
    })
  }
];

function buildRangeDeliveryDraftInput(
  projectId: string,
  uploadedByUserId: string,
  from: number,
  to: number,
  confirmedEpisodeNos: number[],
  title: string,
  sourceFileName: string
): DeliveryPackageDraftInput {
  return {
    projectId,
    uploadedByUserId,
    type: "range",
    declaredEpisodeFrom: from,
    declaredEpisodeTo: to,
    sourceFileName,
    title,
    episodes: Array.from({ length: to - from + 1 }, (_, index) => {
      const episodeNo = from + index;
      return {
        episodeNo,
        title: `第 ${episodeNo} 集`,
        content: `第 ${episodeNo} 集\nM2 原型交稿版本。开场目标、转场节奏与制作提示已整理，供发布后作为当前生效剧本。`
      };
    }),
    confirmedEpisodeNos
  };
}

function buildM2PrototypeWorkspace(): WorkspaceState {
  const projectId = "project-jincheng";
  const headWriterId = "user-head-writer";
  const reviewerId = "user-owner";
  let next = seedWorkspace;

  next = createDeliveryPackageDraft(
    next,
    buildRangeDeliveryDraftInput(projectId, headWriterId, 3, 4, [3, 4], "M2 原型：已发布交稿包", "m2-published-ep3-4.docx")
  );
  const publishedId = next.deliveryPackages.at(-1)?.id ?? "";
  next = submitDeliveryPackageForReview(next, publishedId, headWriterId);
  next = publishDeliveryPackage(next, publishedId, reviewerId);

  next = createDeliveryPackageDraft(
    next,
    buildRangeDeliveryDraftInput(projectId, headWriterId, 12, 13, [12], "M2 原型：待发布交稿包", "m2-pending-ep12-13.docx")
  );
  const pendingId = next.deliveryPackages.at(-1)?.id ?? "";
  next = submitDeliveryPackageForReview(next, pendingId, headWriterId);

  next = createDeliveryPackageDraft(
    next,
    buildRangeDeliveryDraftInput(projectId, headWriterId, 27, 28, [27], "M2 原型：已驳回交稿包", "m2-rejected-ep27-28.docx")
  );
  const rejectedId = next.deliveryPackages.at(-1)?.id ?? "";
  next = submitDeliveryPackageForReview(next, rejectedId, headWriterId);
  next = rejectDeliveryPackage(next, rejectedId, reviewerId, "声明范围与实际变更集不一致，需主编剧重新确认。");

  next = createDeliveryPackageDraft(
    next,
    buildRangeDeliveryDraftInput(projectId, headWriterId, 31, 34, [31, 34], "M2 原型：草稿交稿包", "m2-draft-ep31-34.docx")
  );

  return next;
}

export function M1Dashboard() {
  const [persistedWorkspace] = useState(() => readM2WorkspacePersistence());
  const [state, setState] = useState<WorkspaceState>(() => persistedWorkspace?.state ?? buildM2PrototypeWorkspace());
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
  const [selectedMockDeliveryKey, setSelectedMockDeliveryKey] = useState<MockDeliveryKey>("range-1-10");
  const [selectedDeliveryPackageId, setSelectedDeliveryPackageId] = useState<string | null>(null);
  const [wordTextDraft, setWordTextDraft] = useState("");
  const [wordDeclaredRangeDraft, setWordDeclaredRangeDraft] = useState("1-2");
  const [wordParseFeedback, setWordParseFeedback] = useState<TextParseFeedback | null>(null);
  const [deliveryParseIssuesByPackageId, setDeliveryParseIssuesByPackageId] = useState<Record<string, WordDeliveryIssue[]>>(
    () => persistedWorkspace?.deliveryParseIssuesByPackageId ?? {}
  );
  const [deliveryImportJobs, setDeliveryImportJobs] = useState<DeliveryImportJob[]>(() => persistedWorkspace?.deliveryImportJobs ?? []);
  const [rejectionReason, setRejectionReason] = useState("范围声明需要再确认");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionMessage, setActionMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    writeM2WorkspacePersistence({ state, deliveryImportJobs, deliveryParseIssuesByPackageId });
  }, [deliveryImportJobs, deliveryParseIssuesByPackageId, state]);

  const currentUser = selectCurrentUser(state);
  const activeProjects = state.projects.filter((project) => project.status === "active");
  const selectedProject = state.projects.find((project) => project.id === selectedProjectId) ?? activeProjects[0];

  if (!currentUser || !selectedProject) {
    return <AuthGate state={state} setState={setState} />;
  }

  const currentUserId = currentUser.id;
  const permissions = selectPermissions(state, currentUser.id, selectedProject.id);
  const primaryRole = selectPrimaryRole(state, currentUser.id, selectedProject.id);
  const canReviewDelivery = primaryRole === "owner" || primaryRole === "coordinator";
  const canSubmitDelivery = primaryRole === "head_writer" || canReviewDelivery;
  const overview = selectProjectOverview(state, selectedProject.id);
  const projectMembers = selectProjectMembers(state, selectedProject.id);
  const myEpisodes = selectMyEpisodes(state, currentUser.id);
  const unreadNotifications = selectUnreadNotifications(state, currentUser.id);
  const inProgressCount = overview.episodes.filter((episode) => episode.productionStatus === "in_progress").length;
  const canViewFullProject = permissions.canViewAllEpisodes;
  const visibleEpisodes = canViewFullProject
    ? overview.episodes
    : overview.episodes.filter((episode) => episode.assignments.some((assignment) => assignment.userId === currentUser.id));
  const todayTasks = buildTodayTasks(myEpisodes);
  const recentUpdates = buildRecentUpdates(visibleEpisodes, selectedProject.name);
  const selectedEpisode = visibleEpisodes.find((episode) => episode.id === selectedEpisodeId) ?? visibleEpisodes[0] ?? null;
  const assignmentSummary = buildAssignmentSummary(visibleEpisodes);
  const shortcutItems = buildShortcutItems(permissions, primaryRole);
  const navigationItems = buildNavigationItems(permissions, primaryRole);
  const allowedModules = new Set([...shortcutItems.map((item) => item.label), ...navigationItems.map((item) => item.label), "集工作台"]);
  const effectiveActiveModule = allowedModules.has(activeModule) ? activeModule : "项目总览";
  const searchableMembers = permissions.canManageMembers || permissions.canViewAllEpisodes ? projectMembers : [];
  const searchResults = buildSearchResults(searchQuery, activeProjects, searchableMembers, visibleEpisodes);
  const currentProjectParticipation = canViewFullProject ? myEpisodes.length : visibleEpisodes.length;
  const projectDeliveryPackages = state.deliveryPackages.filter((deliveryPackage) => deliveryPackage.projectId === selectedProject.id);
  const projectDeliveryImportJobs = deliveryImportJobs.filter((job) => job.projectId === selectedProject.id).slice(0, 8);
  const activeDeliveryPackageId =
    selectedDeliveryPackageId && projectDeliveryPackages.some((deliveryPackage) => deliveryPackage.id === selectedDeliveryPackageId)
      ? selectedDeliveryPackageId
      : projectDeliveryPackages.at(-1)?.id ?? null;
  const activeDeliveryPackage = activeDeliveryPackageId ? selectDeliveryPackageDetail(state, activeDeliveryPackageId) : null;
  const activeDeliveryParseIssues = activeDeliveryPackageId ? deliveryParseIssuesByPackageId[activeDeliveryPackageId] ?? [] : [];
  const deliveryPackageDetails = projectDeliveryPackages
    .map((deliveryPackage) => selectDeliveryPackageDetail(state, deliveryPackage.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  function runMutation(mutator: (current: WorkspaceState) => WorkspaceState, successText: string) {
    try {
      setState((current) => mutator(current));
      setActionMessage({ tone: "success", text: successText });
    } catch (error) {
      setActionMessage({ tone: "error", text: formatActionError(error) });
    }
  }

  function handleResetPrototypeState() {
    const next = buildM2PrototypeWorkspace();
    clearM2WorkspacePersistence();
    setState(next);
    setSelectedProjectId(next.projects[0]?.id ?? seedWorkspace.projects[0].id);
    setSelectedDeliveryPackageId(null);
    setDeliveryImportJobs([]);
    setDeliveryParseIssuesByPackageId({});
    setWordParseFeedback(null);
    setActionMessage({ tone: "success", text: "原型数据已重置为默认演示状态。" });
    setUserMenuOpen(false);
  }

  function createDeliveryImportJob(input: Pick<DeliveryImportJob, "declaredRangeText" | "fileName" | "projectId" | "source">) {
    const job: DeliveryImportJob = {
      ...input,
      id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: "processing",
      createdAt: new Date().toISOString()
    };

    setDeliveryImportJobs((items) => [job, ...items].slice(0, 20));
    return job.id;
  }

  function updateDeliveryImportJob(jobId: string, patch: Partial<DeliveryImportJob>) {
    setDeliveryImportJobs((items) =>
      items.map((item) =>
        item.id === jobId
          ? {
              ...item,
              ...patch,
              completedAt: patch.status === "success" || patch.status === "failed" ? new Date().toISOString() : item.completedAt
            }
          : item
      )
    );
  }

  function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runMutation((current) => {
      const next = createProject(current, projectDraft);
      const created = next.projects.at(-1);
      if (created) {
        setSelectedProjectId(created.id);
      }
      return next;
    }, "项目已创建");
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

    runMutation((current) => updateProject(current, editingProjectId, projectDraft), "项目已保存");
    setEditingProjectId(null);
  }

  function handleArchiveProject(projectId: string) {
    runMutation((current) => archiveProject(current, projectId), "项目已归档");
    const nextProject = activeProjects.find((project) => project.id !== projectId);
    if (nextProject) {
      setSelectedProjectId(nextProject.id);
    }
  }

  function handleUpsertMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runMutation((current) =>
      saveProjectMemberRoles(current, {
        projectId: selectedProject.id,
        ...memberDraft
      }),
      "成员身份已保存"
    );
  }

  function handleUpdateMemberPermissions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runMutation((current) =>
      updateProjectMemberPermissions(current, {
        projectId: selectedProject.id,
        ...permissionDraft
      }),
      "成员权限已保存"
    );
  }

  function handleAssignEpisodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runMutation((current) =>
      assignEpisodes(current, {
        projectId: selectedProject.id,
        userId: assignmentDraft.userId,
        episodeFrom: assignmentDraft.episodeFrom,
        episodeTo: assignmentDraft.episodeTo,
        responsibility: assignmentDraft.responsibility
      }),
      "集数分配已保存"
    );
  }

  function handleCreateMockDelivery() {
    const template = mockDeliveryTemplates.find((item) => item.key === selectedMockDeliveryKey) ?? mockDeliveryTemplates[0];

    runMutation((current) => {
      const next = createDeliveryPackageDraft(current, template.build(selectedProject.id, currentUserId));
      const created = next.deliveryPackages.at(-1);
      if (created) {
        setSelectedDeliveryPackageId(created.id);
      }
      return next;
    }, "已创建模拟交稿包：先确认哪些集真的改过，再提交给统筹发布。");
    setActiveModule("交稿中心");
  }

  function handleCreateTextDelivery() {
    if (!canSubmitDelivery) {
      setActionMessage({ tone: "error", text: "当前身份不能创建交稿包。请让主编剧或统筹处理。" });
      return;
    }

    const jobId = createDeliveryImportJob({
      projectId: selectedProject.id,
      source: "text",
      fileName: "pasted-word-text.txt",
      declaredRangeText: wordDeclaredRangeDraft
    });
    const parsed = buildTextDeliveryPackageDraft({
      projectId: selectedProject.id,
      uploadedByUserId: currentUserId,
      rawText: wordTextDraft,
      declaredRangeText: wordDeclaredRangeDraft
    });

    if (!parsed.ok) {
      setWordParseFeedback({
        tone: "error",
        title: "解析失败，可手动粘贴单集补救",
        issues: parsed.issues,
        remedies: parsed.remedies
      });
      updateDeliveryImportJob(jobId, {
        status: "failed",
        issueCount: parsed.issues.length,
        errorText: parsed.issues[0]?.message ?? "未识别到集边界"
      });
      setActionMessage({ tone: "error", text: "没有识别到集边界。可改用手动粘贴单集补救，不阻塞后续确认流程。" });
      return;
    }

    try {
      const next = createDeliveryPackageDraft(state, parsed.draft);
      const created = next.deliveryPackages.at(-1);
      if (created) {
        setSelectedDeliveryPackageId(created.id);
        setDeliveryParseIssuesByPackageId((items) => ({
          ...items,
          [created.id]: parsed.issues
        }));
        updateDeliveryImportJob(jobId, {
          status: "success",
          deliveryPackageId: created.id,
          issueCount: parsed.issues.length
        });
      }
      setState(next);
      setActionMessage({ tone: "success", text: "文本解析已生成交稿包草稿：请在确认页检查 warnings 并勾选实际变更集。" });
      setWordParseFeedback({
        tone: parsed.issues.length > 0 ? "warning" : "success",
        title: parsed.issues.length > 0 ? "解析完成，存在 warnings" : "解析完成，已进入确认页",
        issues: parsed.issues
      });
      setActiveModule("交稿中心");
    } catch (error) {
      setWordParseFeedback({
        tone: "error",
        title: "解析已完成，但交稿包草稿未创建",
        issues: parsed.issues,
        remedies: [formatActionError(error), "可手动粘贴单集补救，或调整声明范围后重新解析。"]
      });
      updateDeliveryImportJob(jobId, {
        status: "failed",
        issueCount: parsed.issues.length,
        errorText: formatActionError(error)
      });
      setActionMessage({ tone: "error", text: formatActionError(error) });
    }
  }

  async function handleCreateDocxDelivery(file: File, declaredRangeText: string): Promise<WordUploadStatus> {
    if (!canSubmitDelivery) {
      setActionMessage({ tone: "error", text: "当前身份不能创建交稿包。请让主编剧或统筹处理。" });
      return "failed";
    }

    const jobId = createDeliveryImportJob({
      projectId: selectedProject.id,
      source: "docx",
      fileName: file.name,
      declaredRangeText
    });
    const parsed = await parseWordDelivery(file, {
      declaredRange: declaredRangeText.trim() || undefined,
      fileName: file.name
    });

    if (!parsed.ok) {
      setWordParseFeedback({
        tone: "error",
        title: "Word 解析失败，可手动粘贴单集补救",
        issues: [...parsed.warnings, ...parsed.errors],
        remedies: parsed.remedies
      });
      updateDeliveryImportJob(jobId, {
        status: "failed",
        issueCount: parsed.warnings.length + parsed.errors.length,
        errorText: parsed.errors[0]?.message ?? "Word 解析失败"
      });
      setActionMessage({ tone: "error", text: "Word 没有解析出可靠的单集内容。可以改用手动粘贴单集补救。" });
      return "failed";
    }

    const built = buildDeliveryPackageDraftFromParsed({
      projectId: selectedProject.id,
      uploadedByUserId: currentUserId,
      sourceFileName: file.name,
      parsed
    });

    try {
      const next = createDeliveryPackageDraft(state, built.draft);
      const created = next.deliveryPackages.at(-1);
      if (created) {
        setSelectedDeliveryPackageId(created.id);
        setDeliveryParseIssuesByPackageId((items) => ({
          ...items,
          [created.id]: built.issues
        }));
        updateDeliveryImportJob(jobId, {
          status: "success",
          deliveryPackageId: created.id,
          issueCount: built.issues.length
        });
      }
      setState(next);
      setWordParseFeedback({
        tone: built.issues.length > 0 ? "warning" : "success",
        title: built.issues.length > 0 ? "Word 解析完成，存在 warnings" : "Word 解析完成，已进入确认页",
        issues: built.issues
      });
      setActionMessage({ tone: "success", text: "Word 已解析成交稿包草稿：请在确认页检查 warnings 并勾选实际变更集。" });
      setActiveModule("交稿中心");
      return "success";
    } catch (error) {
      setWordParseFeedback({
        tone: "error",
        title: "Word 已解析，但交稿包草稿未创建",
        issues: built.issues,
        remedies: [formatActionError(error), "可改用手动粘贴单集补救，或调整声明范围后重新解析。"]
      });
      updateDeliveryImportJob(jobId, {
        status: "failed",
        issueCount: built.issues.length,
        errorText: formatActionError(error)
      });
      setActionMessage({ tone: "error", text: formatActionError(error) });
      return "failed";
    }
  }

  function handleUpdateConfirmedEpisode(deliveryPackageId: string, episodeNo: number, checked: boolean) {
    const detail = selectDeliveryPackageDetail(state, deliveryPackageId);
    const confirmedEpisodeNos = checked
      ? [...detail.confirmedEpisodeNos, episodeNo]
      : detail.confirmedEpisodeNos.filter((item) => item !== episodeNo);

    runMutation(
      (current) =>
        updateDeliveryPackageConfirmation(current, {
          deliveryPackageId,
          confirmedEpisodeNos
        }),
      "实际变更集已更新"
    );
  }

  function handleSubmitDeliveryForReview(deliveryPackageId: string) {
    const detail = selectDeliveryPackageDetail(state, deliveryPackageId);
    if (detail.confirmedEpisodeNos.length === 0) {
      setActionMessage({
        tone: "error",
        text: "还没有勾选实际变更集。请先勾选至少一集真的改过的内容；没有改动的集不会进入本次发布。"
      });
      return;
    }

    runMutation(
      (current) => submitDeliveryPackageForReview(current, deliveryPackageId, currentUserId),
      "已提交给统筹。现在还没有覆盖当前剧本；统筹发布后，勾选的集才会变成当前生效剧本。"
    );
  }

  function handlePublishDelivery(deliveryPackageId: string) {
    if (!canReviewDelivery) {
      setActionMessage({ tone: "error", text: "你当前不是统筹，不能发布交稿包。请让统筹账号处理发布或驳回。" });
      return;
    }

    const detail = selectDeliveryPackageDetail(state, deliveryPackageId);
    runMutation(
      (current) => publishDeliveryPackage(current, deliveryPackageId, currentUserId),
      `发布成功。第 ${detail.confirmedEpisodeNos.join("、")} 集现在是当前生效剧本；已分配到这些集的人会收到“剧本已更新，请查看关键变更”。`
    );
  }

  function handleRejectDelivery(deliveryPackageId: string) {
    if (!canReviewDelivery) {
      setActionMessage({ tone: "error", text: "你当前不是统筹，不能驳回交稿包。请让统筹账号处理发布或驳回。" });
      return;
    }

    runMutation(
      (current) => rejectDeliveryPackage(current, deliveryPackageId, currentUserId, rejectionReason),
      "已驳回。这次不会生成新剧本版本；交稿人按驳回原因补齐后，可以重新提交。"
    );
  }

  return (
    <main className="replica-shell">
      <IconRail
        activeModule={effectiveActiveModule}
        currentUser={currentUser}
        items={navigationItems}
        onLogout={() => setState((current) => logout(current))}
        onSelectModule={setActiveModule}
      />

      <section className="replica-main">
        <header className="replica-topbar">
          <div className="topbar-project">
            <strong>AIGC 协作台</strong>
            <span>{selectedProject.name} / M2 交稿协作</span>
          </div>
          <div className="topbar-actions">
            <div className="search-box">
              <Search size={15} />
              <input
                aria-label="搜索"
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
                        if (item.type === "project") {
                          setSelectedProjectId(item.id);
                        }
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
            </div>
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
                  <button onClick={handleResetPrototypeState} type="button">
                    重置原型数据
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
                {todayTasks.length === 0 ? (
                  <p className="empty-text">还没有分配给你的负责集。请等待统筹分配，分配后这里才会出现任务。</p>
                ) : null}
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
              {todayTasks.length > 0 ? (
                <button className="text-link" onClick={() => setActiveModule("任务中心")} type="button">
                  查看全部任务（{todayTasks.length}）
                </button>
              ) : null}
            </section>

            {actionMessage ? (
              <div className={`action-message ${actionMessage.tone}`} role="status">
                {actionMessage.text}
              </div>
            ) : null}

            <section className="panel mine-card">
              <PanelTitle title={`我的集（${myEpisodes.length}）`} eyebrow="进度" />
              <div className="mine-list">
                {myEpisodes.length === 0 ? (
                  <p className="empty-state">你还没有负责集。先不用处理任务，等统筹分配具体集数后，这里会自动出现你的单集工作入口。</p>
                ) : (
                  myEpisodes.slice(0, 3).map((episode) => (
                    <article key={`${episode.projectCode}-${episode.episodeNo}`}>
                      <div>
                        <strong>第 {episode.episodeNo} 集 · {episode.projectName}</strong>
                        <small>
                          {assignmentLabels[episode.responsibility]}
                          {episode.hasUnreadKeyChange ? " · 关键变更待查看" : ""}
                        </small>
                      </div>
                      <ProgressBar value={episode.productionStatus === "in_progress" ? 60 : episode.productionStatus === "key_update" ? 35 : 15} />
                    </article>
                  ))
                )}
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
              <Metric label="我的参与" value={currentProjectParticipation.toString()} />
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
            <PanelTitle
              title={canViewFullProject ? "项目状态灯" : "我的负责集状态"}
              eyebrow={canViewFullProject ? `${overview.memberCount} 位成员 · ${overview.episodes.length} 集` : `${visibleEpisodes.length} 集`}
            />
            {visibleEpisodes.length === 0 ? (
              <p className="empty-state">当前项目还没有分配给你的集。请等待统筹分配，这里不会生成临时任务或伪进度。</p>
            ) : (
              <div className="episode-grid" role="list" aria-label="集状态灯">
                {visibleEpisodes.slice(0, 36).map((episode) => (
                  <button
                    className={`episode-cell ${episode.productionStatus} ${selectedEpisode?.id === episode.id ? "selected" : ""}`}
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
            )}
          </section>

          <ModuleWorkbench
            activeModule={effectiveActiveModule}
            activeDeliveryPackage={activeDeliveryPackage}
            activeDeliveryParseIssues={activeDeliveryParseIssues}
            assignmentSummary={assignmentSummary}
            canReviewDelivery={canReviewDelivery}
            canSubmitDelivery={canSubmitDelivery}
            deliveryImportJobs={projectDeliveryImportJobs}
            deliveryPackageDetails={deliveryPackageDetails}
            episode={selectedEpisode}
            handleCreateMockDelivery={handleCreateMockDelivery}
            handleCreateDocxDelivery={handleCreateDocxDelivery}
            handleCreateTextDelivery={handleCreateTextDelivery}
            handlePublishDelivery={handlePublishDelivery}
            handleRejectDelivery={handleRejectDelivery}
            handleSubmitDeliveryForReview={handleSubmitDeliveryForReview}
            handleUpdateConfirmedEpisode={handleUpdateConfirmedEpisode}
            projectName={selectedProject.name}
            recentUpdates={recentUpdates}
            rejectionReason={rejectionReason}
            selectedMockDeliveryKey={selectedMockDeliveryKey}
            setRejectionReason={setRejectionReason}
            setSelectedDeliveryPackageId={setSelectedDeliveryPackageId}
            setSelectedMockDeliveryKey={setSelectedMockDeliveryKey}
            state={state}
            tasks={todayTasks}
            wordDeclaredRangeDraft={wordDeclaredRangeDraft}
            wordParseFeedback={wordParseFeedback}
            wordTextDraft={wordTextDraft}
            setWordDeclaredRangeDraft={setWordDeclaredRangeDraft}
            setWordTextDraft={setWordTextDraft}
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
  items,
  onLogout,
  onSelectModule
}: {
  activeModule: string;
  currentUser: NonNullable<ReturnType<typeof selectCurrentUser>>;
  items: NavigationItem[];
  onLogout: () => void;
  onSelectModule: (module: string) => void;
}) {
  return (
    <aside className="icon-rail" aria-label="主导航">
      <span className={`avatar mini ${currentUser.avatarTone}`}>{currentUser.name.slice(0, 1)}</span>
      <nav>
        {items.map((item) => (
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
                <small>{formatNotificationBody(notification)}</small>
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
            <span>{formatNotificationBody(notification)}</span>
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
      {updates.length === 0 ? (
        <p className="empty-state">当前还没有与你相关的更新。</p>
      ) : (
        <>
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
        </>
      )}
    </section>
  );
}

function ModuleWorkbench({
  activeModule,
  activeDeliveryPackage,
  activeDeliveryParseIssues,
  assignmentSummary,
  canReviewDelivery,
  canSubmitDelivery,
  deliveryImportJobs,
  deliveryPackageDetails,
  episode,
  handleCreateDocxDelivery,
  handleCreateMockDelivery,
  handleCreateTextDelivery,
  handlePublishDelivery,
  handleRejectDelivery,
  handleSubmitDeliveryForReview,
  handleUpdateConfirmedEpisode,
  projectName,
  recentUpdates,
  rejectionReason,
  selectedMockDeliveryKey,
  setRejectionReason,
  setSelectedDeliveryPackageId,
  setSelectedMockDeliveryKey,
  state,
  tasks,
  wordDeclaredRangeDraft,
  wordParseFeedback,
  wordTextDraft,
  setWordDeclaredRangeDraft,
  setWordTextDraft
}: {
  activeModule: string;
  activeDeliveryPackage: ReturnType<typeof selectDeliveryPackageDetail> | null;
  activeDeliveryParseIssues: WordDeliveryIssue[];
  assignmentSummary: AssignmentSummaryItem[];
  canReviewDelivery: boolean;
  canSubmitDelivery: boolean;
  deliveryImportJobs: DeliveryImportJob[];
  deliveryPackageDetails: Array<ReturnType<typeof selectDeliveryPackageDetail>>;
  episode: ReturnType<typeof selectProjectOverview>["episodes"][number] | null;
  handleCreateDocxDelivery: (file: File, declaredRangeText: string) => Promise<WordUploadStatus>;
  handleCreateMockDelivery: () => void;
  handleCreateTextDelivery: () => void;
  handlePublishDelivery: (deliveryPackageId: string) => void;
  handleRejectDelivery: (deliveryPackageId: string) => void;
  handleSubmitDeliveryForReview: (deliveryPackageId: string) => void;
  handleUpdateConfirmedEpisode: (deliveryPackageId: string, episodeNo: number, checked: boolean) => void;
  projectName: string;
  recentUpdates: ReturnType<typeof buildRecentUpdates>;
  rejectionReason: string;
  selectedMockDeliveryKey: MockDeliveryKey;
  setRejectionReason: React.Dispatch<React.SetStateAction<string>>;
  setSelectedDeliveryPackageId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedMockDeliveryKey: React.Dispatch<React.SetStateAction<MockDeliveryKey>>;
  state: WorkspaceState;
  tasks: ReturnType<typeof buildTodayTasks>;
  wordDeclaredRangeDraft: string;
  wordParseFeedback: TextParseFeedback | null;
  wordTextDraft: string;
  setWordDeclaredRangeDraft: React.Dispatch<React.SetStateAction<string>>;
  setWordTextDraft: React.Dispatch<React.SetStateAction<string>>;
}) {
  if (activeModule === "集工作台") {
    if (!episode) {
      return (
        <section className="panel module-panel">
          <PanelTitle title="集工作台" eyebrow={projectName} />
          <p className="empty-state">当前项目还没有分配给你的集。请等待统筹分配，分配后这里会显示真实的单集工作台。</p>
        </section>
      );
    }

    const timeline = selectEpisodeScriptTimeline(state, episode.id);
    const currentRevision = timeline.currentRevision;
    const currentRevisionDetail = currentRevision
      ? timeline.revisions.find((revision) => revision.id === currentRevision.id)
      : undefined;
    const docxDisabledHint = "暂无当前生效剧本，发布交稿包后才能导出 docx。";

    return (
      <section className="panel module-panel">
        <PanelTitle title={`第 ${episode.episodeNo} 集工作台`} eyebrow={projectName} />
        <div className="episode-workbench">
          <div>
            <span className={`status-pill ${episode.productionStatus}`}>{statusLabels[episode.productionStatus]}</span>
            <p>
              {currentRevision
                ? `当前生效剧本来自 ${currentRevisionDetail?.deliveryPackageTitle ?? "已发布交稿包"}，修订号 v${currentRevision.revisionNo}。`
                : "当前还没有已发布剧本。主编剧提交交稿包并由统筹发布后，这里会显示 EpisodeCurrent 对应的最新修订。"}
            </p>
          </div>
          <div className="detail-grid">
            <DetailItem label="负责人" value={episode.assignments.map((item) => `${item.userName} · ${assignmentLabels[item.responsibility]}`).join("、") || "未分配"} />
            <DetailItem label="关键变更" value={episode.hasUnreadKeyChange ? "有新改动" : "暂无"} />
            <DetailItem label="问题反馈" value={`${episode.openIssueCount} 条`} />
          </div>
          <div className="script-preview">
            <div className="script-card-head">
              <div>
                <span>当前生效剧本</span>
                <strong>{currentRevision?.title ?? "未发布当前剧本"}</strong>
              </div>
              <div className="script-tools">
                <button disabled={timeline.revisions.length === 0} type="button">
                  <FileText size={15} />
                  历史修订
                </button>
                <button disabled={!currentRevision} type="button">
                  <GitCompareArrows size={15} />
                  diff 摘要
                </button>
                <button
                  disabled={!currentRevision}
                  onClick={() => {
                    if (!currentRevision) {
                      return;
                    }

                    void downloadCurrentRevisionDocx({
                      deliveryPackageTitle: currentRevisionDetail?.deliveryPackageTitle,
                      episodeNo: episode.episodeNo,
                      projectName,
                      revision: currentRevision
                    });
                  }}
                  title={currentRevision ? "导出当前集生效剧本 docx" : docxDisabledHint}
                  type="button"
                >
                  <Download size={15} />
                  导出 docx
                </button>
              </div>
            </div>
            {!currentRevision ? <p className="script-tool-hint">{docxDisabledHint}</p> : null}
            {currentRevision ? (
              <p className="script-diff-summary">{currentRevision.changeSummary}</p>
            ) : null}
            <pre>{currentRevision?.content ?? "暂无当前生效剧本内容。"}</pre>
          </div>
          {timeline.revisions.length > 0 ? (
            <div className="revision-list">
              {timeline.revisions.slice(0, 4).map((revision) => (
                <article key={revision.id}>
                  <strong>v{revision.revisionNo} · {revision.deliveryPackageTitle}</strong>
                  <span>{revision.changeSummary}</span>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  if (activeModule === "交稿中心") {
    return (
      <M2DeliveryCenter
        activeDeliveryPackage={activeDeliveryPackage}
        activeDeliveryParseIssues={activeDeliveryParseIssues}
        canReviewDelivery={canReviewDelivery}
        canSubmitDelivery={canSubmitDelivery}
        deliveryImportJobs={deliveryImportJobs}
        deliveryPackageDetails={deliveryPackageDetails}
        handleCreateDocxDelivery={handleCreateDocxDelivery}
        handleCreateMockDelivery={handleCreateMockDelivery}
        handleCreateTextDelivery={handleCreateTextDelivery}
        handlePublishDelivery={handlePublishDelivery}
        handleRejectDelivery={handleRejectDelivery}
        handleSubmitDeliveryForReview={handleSubmitDeliveryForReview}
        handleUpdateConfirmedEpisode={handleUpdateConfirmedEpisode}
        rejectionReason={rejectionReason}
        selectedMockDeliveryKey={selectedMockDeliveryKey}
        setRejectionReason={setRejectionReason}
        setSelectedDeliveryPackageId={setSelectedDeliveryPackageId}
        setSelectedMockDeliveryKey={setSelectedMockDeliveryKey}
        wordDeclaredRangeDraft={wordDeclaredRangeDraft}
        wordParseFeedback={wordParseFeedback}
        wordTextDraft={wordTextDraft}
        setWordDeclaredRangeDraft={setWordDeclaredRangeDraft}
        setWordTextDraft={setWordTextDraft}
      />
    );
  }

  if (activeModule === "任务中心") {
    return (
      <section className="panel module-panel">
        <PanelTitle title="任务中心" eyebrow={`${tasks.length} tasks`} />
        {tasks.length === 0 ? (
          <p className="empty-state">当前没有分配给你的剧集任务。请等待统筹分配负责集，系统不会先生成占位任务。</p>
        ) : (
          <div className="module-list">
            {tasks.map((task) => (
              <article key={task.title}>
                <strong>{task.title}</strong>
                <span>{task.meta} · {task.badge}</span>
              </article>
            ))}
          </div>
        )}
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
        {recentUpdates.length === 0 ? (
          <p className="empty-state">当前视图下还没有与你相关的状态更新。</p>
        ) : (
          <div className="module-list">
            {recentUpdates.slice(0, 3).map((item) => (
              <article key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.meta} · {item.status}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="panel module-panel">
      <PanelTitle title={activeModule} eyebrow="暂未开放" />
      <p className="empty-state">这个入口已经有明确反馈，但完整业务能力属于后续模块：素材库对应 M3，交稿中心对应 M2，数据报表和系统设置会在持久化后实现。</p>
    </section>
  );
}

function M2DeliveryCenter({
  activeDeliveryPackage,
  activeDeliveryParseIssues,
  canReviewDelivery,
  canSubmitDelivery,
  deliveryImportJobs,
  deliveryPackageDetails,
  handleCreateDocxDelivery,
  handleCreateMockDelivery,
  handleCreateTextDelivery,
  handlePublishDelivery,
  handleRejectDelivery,
  handleSubmitDeliveryForReview,
  handleUpdateConfirmedEpisode,
  rejectionReason,
  selectedMockDeliveryKey,
  setRejectionReason,
  setSelectedDeliveryPackageId,
  setSelectedMockDeliveryKey,
  wordDeclaredRangeDraft,
  wordParseFeedback,
  wordTextDraft,
  setWordDeclaredRangeDraft,
  setWordTextDraft
}: {
  activeDeliveryPackage: ReturnType<typeof selectDeliveryPackageDetail> | null;
  activeDeliveryParseIssues: WordDeliveryIssue[];
  canReviewDelivery: boolean;
  canSubmitDelivery: boolean;
  deliveryImportJobs: DeliveryImportJob[];
  deliveryPackageDetails: Array<ReturnType<typeof selectDeliveryPackageDetail>>;
  handleCreateDocxDelivery: (file: File, declaredRangeText: string) => Promise<WordUploadStatus>;
  handleCreateMockDelivery: () => void;
  handleCreateTextDelivery: () => void;
  handlePublishDelivery: (deliveryPackageId: string) => void;
  handleRejectDelivery: (deliveryPackageId: string) => void;
  handleSubmitDeliveryForReview: (deliveryPackageId: string) => void;
  handleUpdateConfirmedEpisode: (deliveryPackageId: string, episodeNo: number, checked: boolean) => void;
  rejectionReason: string;
  selectedMockDeliveryKey: MockDeliveryKey;
  setRejectionReason: React.Dispatch<React.SetStateAction<string>>;
  setSelectedDeliveryPackageId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedMockDeliveryKey: React.Dispatch<React.SetStateAction<MockDeliveryKey>>;
  wordDeclaredRangeDraft: string;
  wordParseFeedback: TextParseFeedback | null;
  wordTextDraft: string;
  setWordDeclaredRangeDraft: React.Dispatch<React.SetStateAction<string>>;
  setWordTextDraft: React.Dispatch<React.SetStateAction<string>>;
}) {
  const selectedTemplate = mockDeliveryTemplates.find((item) => item.key === selectedMockDeliveryKey) ?? mockDeliveryTemplates[0];
  const confirmedCount = activeDeliveryPackage?.confirmedEpisodeNos.length ?? 0;
  const [uploadType, setUploadType] = useState<WordUploadType>("range");
  const [uploadEpisodeFrom, setUploadEpisodeFrom] = useState(1);
  const [uploadEpisodeTo, setUploadEpisodeTo] = useState(10);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadStatus, setUploadStatus] = useState<WordUploadStatus>("empty");
  const [isDraggingDocx, setIsDraggingDocx] = useState(false);
  const uploadStatusText = wordUploadStatusCopy[uploadStatus];

  function handleUploadTypeChange(nextType: WordUploadType) {
    setUploadType(nextType);

    if (nextType === "single_replace") {
      setUploadEpisodeTo(uploadEpisodeFrom);
    }
  }

  function handleUploadFromChange(value: number) {
    const nextFrom = Number.isFinite(value) && value > 0 ? value : 1;
    setUploadEpisodeFrom(nextFrom);

    if (uploadType === "single_replace") {
      setUploadEpisodeTo(nextFrom);
    } else if (uploadEpisodeTo < nextFrom) {
      setUploadEpisodeTo(nextFrom);
    }
  }

  function handleDocxFile(file?: File) {
    if (!file) {
      return;
    }

    setUploadFileName(file.name);
    setUploadFile(file);
    setUploadStatus("selected");
  }

  async function handleParseSelectedDocx() {
    if (!uploadFile || uploadStatus === "parsing") {
      return;
    }

    setUploadStatus("parsing");
    const nextStatus = await handleCreateDocxDelivery(uploadFile, `${uploadEpisodeFrom}-${uploadEpisodeTo}`);
    setUploadStatus(nextStatus);
  }

  return (
    <section className="panel module-panel delivery-center">
      <PanelTitle title="交稿中心" eyebrow="M2" />

      <div className="delivery-grid">
        <div className="delivery-column">
          <section className="word-upload-panel">
            <div className="word-upload-head">
              <div>
                <strong>Word 上传入口</strong>
                <p>上传 Word 后会先切成单集，不会立刻发布；必须在确认页勾选实际变更集。</p>
              </div>
              <span>{uploadStatusText.title}</span>
            </div>

            <div className="upload-type-switch" aria-label="选择上传类型">
              {(["range", "single_replace"] as WordUploadType[]).map((type) => (
                <button
                  className={uploadType === type ? "active" : ""}
                  key={type}
                  onClick={() => handleUploadTypeChange(type)}
                  type="button"
                >
                  {wordUploadTypeLabels[type]}
                </button>
              ))}
            </div>

            <div className="inline-fields">
              <label>
                起始集
                <input
                  min={1}
                  type="number"
                  value={uploadEpisodeFrom}
                  onChange={(event) => handleUploadFromChange(Number(event.target.value))}
                />
              </label>
              <label>
                结束集
                <input
                  disabled={uploadType === "single_replace"}
                  min={uploadEpisodeFrom}
                  type="number"
                  value={uploadEpisodeTo}
                  onChange={(event) => setUploadEpisodeTo(Math.max(uploadEpisodeFrom, Number(event.target.value) || uploadEpisodeFrom))}
                />
              </label>
            </div>

            {canSubmitDelivery ? (
              <>
                <label
                  className={`docx-dropzone ${isDraggingDocx ? "dragging" : ""}`}
                  onDragLeave={() => setIsDraggingDocx(false)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDraggingDocx(true);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDraggingDocx(false);
                    handleDocxFile(event.dataTransfer.files.item(0) ?? undefined);
                  }}
                >
                  <FileText size={22} />
                  <span>{uploadFileName || "选择或拖拽 docx 文件到这里"}</span>
                  <small>.docx only · 解析成功后会创建交稿草稿</small>
                  <input
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={(event) => handleDocxFile(event.target.files?.item(0) ?? undefined)}
                    type="file"
                  />
                </label>

                <div className={`upload-status-card ${uploadStatus}`}>
                  <strong>{uploadStatusText.title}</strong>
                  <span>{uploadStatusText.body}</span>
                </div>

                {uploadStatus === "failed" ? (
                  <div className="manual-fallback-card">
                    <strong>手动粘贴单集补救</strong>
                    <p>适用于 Word 标题不规范、漏写“第 X 集”、或内容在图片里导致切段失败的情况。</p>
                    <ol>
                      <li>先把需要补救的单集正文复制出来，例如只复制第 12 集。</li>
                      <li>按“单集替换”处理，只确认这一集为实际变更。</li>
                      <li>提交后仍需统筹发布，发布前不会覆盖当前生效剧本。</li>
                    </ol>
                    <small>文件解析失败时，可用下面的粘贴文本入口创建草稿。</small>
                  </div>
                ) : null}

                <div className="upload-actions">
                  <button
                    className="primary-button"
                    disabled={!uploadFileName || uploadStatus === "parsing"}
                    onClick={() => {
                      void handleParseSelectedDocx();
                    }}
                    type="button"
                  >
                    解析 Word 并创建草稿
                  </button>
                </div>

                <div className="word-text-parser">
                  <div>
                    <strong>粘贴 Word 文本/解析文本</strong>
                    <p>本轮只接文本解析。粘贴包含“第 1 集 / 第 2 集”的正文后，会生成交稿包草稿并进入确认页。</p>
                  </div>
                  <label>
                    声明范围
                    <input
                      placeholder="1-10"
                      value={wordDeclaredRangeDraft}
                      onChange={(event) => setWordDeclaredRangeDraft(event.target.value)}
                    />
                  </label>
                  <label>
                    Word 正文文本
                    <textarea
                      placeholder={"第 1 集 开场\n场 1-1 金城矿山 日 外\n正文...\n第 2 集 追踪\n正文..."}
                      rows={8}
                      value={wordTextDraft}
                      onChange={(event) => setWordTextDraft(event.target.value)}
                    />
                  </label>
                  <button className="primary-button" disabled={!wordTextDraft.trim()} onClick={handleCreateTextDelivery} type="button">
                    <FileText size={16} />
                    解析文本并创建草稿
                  </button>
                  {wordParseFeedback ? (
                    <div className={`parse-feedback ${wordParseFeedback.tone}`}>
                      <strong>{wordParseFeedback.title}</strong>
                      <ParserIssueList issues={wordParseFeedback.issues} remedies={wordParseFeedback.remedies} />
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="permission-note">当前身份不能上传 Word。主编剧或统筹上传并确认后，创作者只查看自己负责集的当前剧本。</p>
            )}
          </section>

          <DeliveryImportJobList jobs={deliveryImportJobs} />

          {deliveryPackageDetails.length === 0 ? (
            <div className="empty-card">
              <Inbox size={22} />
              <strong>当前没有交稿包需要处理</strong>
              <p>主编剧或统筹创建交稿包后，这里会显示切出的单集、实际变更集确认、待发布和已发布状态。</p>
              <p>如果 Word 切段失败，不要反复上传同一个文件；可以先手动粘贴单集内容补救，确认这一集后再提交。</p>
            </div>
          ) : (
            <div className="delivery-list">
              {deliveryPackageDetails.map((deliveryPackage) => (
                <button
                  className={activeDeliveryPackage?.id === deliveryPackage.id ? "active" : ""}
                  key={deliveryPackage.id}
                  onClick={() => setSelectedDeliveryPackageId(deliveryPackage.id)}
                  type="button"
                >
                  <strong>{deliveryPackage.title}</strong>
                  <span>
                    {deliveryPackage.status} / {deliveryStatusLabels[deliveryPackage.status]} · 第 {deliveryPackage.declaredEpisodeFrom}-{deliveryPackage.declaredEpisodeTo} 集
                  </span>
                  <small>{deliveryPackage.confirmedEpisodeNos.length} 集已勾选为实际变更</small>
                </button>
              ))}
            </div>
          )}

          <div className="delivery-create">
            <strong>创建演示交稿包</strong>
            <p>当前 M2 只演示交稿包确认流，不做真正 Word 文件解析，也不做 M3 资产审核。切段失败时，可改用“手动粘贴单集补救”。</p>
            <label>
              选择交稿包场景
              <select value={selectedMockDeliveryKey} onChange={(event) => setSelectedMockDeliveryKey(event.target.value as MockDeliveryKey)}>
                {mockDeliveryTemplates.map((template) => (
                  <option key={template.key} value={template.key}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
            <small>{selectedTemplate.description}</small>
            {canSubmitDelivery ? (
              <button className="primary-button" onClick={handleCreateMockDelivery} type="button">
                <CirclePlus size={16} />
                创建交稿包
              </button>
            ) : (
              <p className="permission-note">当前身份不能创建或提交交稿包。等待主编剧或统筹创建后，你可以查看与你相关的集。</p>
            )}
          </div>
        </div>

        <div className="delivery-column detail">
          {!activeDeliveryPackage ? (
            <div className="empty-card soft">
              <FileText size={22} />
              <strong>请选择一个交稿包查看详情</strong>
              <p>交稿包出现后，先确认“这次真的改过”的集。没勾选的集不会生成新版本，也不会通知对应负责人。</p>
            </div>
          ) : (
            <>
              <div className="delivery-detail-header">
                <div>
                  <strong>{activeDeliveryPackage.title}</strong>
                  <span>{activeDeliveryPackage.status} / {deliveryStatusLabels[activeDeliveryPackage.status]}</span>
                </div>
                <small>
                  声明范围：第 {activeDeliveryPackage.declaredEpisodeFrom}-{activeDeliveryPackage.declaredEpisodeTo} 集
                </small>
              </div>

              {activeDeliveryPackage.status === "rejected" && activeDeliveryPackage.rejectionReason ? (
                <p className="inline-warning">已驳回：{activeDeliveryPackage.rejectionReason}</p>
              ) : null}

              {activeDeliveryParseIssues.length > 0 ? (
                <div className="parse-feedback warning">
                  <strong>解析 warnings</strong>
                  <ParserIssueList issues={activeDeliveryParseIssues} />
                </div>
              ) : null}

              {activeDeliveryPackage.status === "draft" ? (
                <>
                  <p className={confirmedCount === 0 ? "inline-warning" : "inline-help"}>
                    {confirmedCount === 0
                      ? "还没勾选实际变更集。请勾选这次真的改过的集，没改的不要提交发布。"
                      : `已勾选 ${confirmedCount} 集实际变更。提交后会进入统筹待发布，不会立刻覆盖当前生效剧本。`}
                  </p>
                  <div className="delivery-episode-list">
                    {activeDeliveryPackage.episodes.map((episode) => (
                      <label className="check-row" key={episode.id}>
                        <input
                          checked={episode.isConfirmedChange}
                          onChange={(event) => handleUpdateConfirmedEpisode(activeDeliveryPackage.id, episode.episodeNo, event.target.checked)}
                          type="checkbox"
                        />
                        <span>
                          <strong>第 {episode.episodeNo} 集</strong>
                          <small>{episode.isConfirmedChange ? "会生成新修订" : "本次不发布这一集"}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  {canSubmitDelivery ? (
                    <button
                      className="primary-button"
                      onClick={() => handleSubmitDeliveryForReview(activeDeliveryPackage.id)}
                      title={confirmedCount === 0 ? "请先勾选至少一集实际变更，再提交给统筹。" : "提交后等待统筹发布。"}
                      type="button"
                    >
                      <Send size={16} />
                      {confirmedCount === 0 ? "先勾选实际变更集" : "提交给统筹发布"}
                    </button>
                  ) : (
                    <p className="permission-note">当前身份只能查看交稿包，不能提交。请让主编剧或统筹确认实际变更集后提交。</p>
                  )}
                </>
              ) : null}

              {activeDeliveryPackage.status === "pending_review" ? (
                <div className="review-box">
                  <p className="inline-help">这个交稿包正在等统筹处理。发布后，勾选的集会成为当前生效剧本，并通知对应负责人查看关键变更。</p>
                  <div className="delivery-confirmed-list" aria-label="待发布确认集">
                    <strong>本次确认发布</strong>
                    {activeDeliveryPackage.episodes
                      .filter((episode) => episode.isConfirmedChange)
                      .map((episode) => (
                        <span key={episode.id}>第 {episode.episodeNo} 集</span>
                      ))}
                  </div>
                  {canReviewDelivery ? (
                    <>
                      <label>
                        驳回原因
                        <input value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} />
                      </label>
                      <div className="row-actions">
                        <button className="primary-button" onClick={() => handlePublishDelivery(activeDeliveryPackage.id)} type="button">
                          <Check size={16} />
                          发布为当前生效剧本
                        </button>
                        <button className="secondary-button" onClick={() => handleRejectDelivery(activeDeliveryPackage.id)} type="button">
                          驳回并说明原因
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="permission-note">发布和驳回只给统筹显示。你当前可以查看待发布内容，但不能发布或驳回，请等待统筹处理。</p>
                  )}
                </div>
              ) : null}

              {activeDeliveryPackage.status === "published" ? (
                <p className="inline-help">发布完成。勾选过的集已经更新为当前生效剧本，相关创作者会看到“剧本已更新，请查看关键变更”的提醒。</p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function DeliveryImportJobList({ jobs }: { jobs: DeliveryImportJob[] }) {
  if (jobs.length === 0) {
    return (
      <section className="import-job-panel">
        <div className="import-job-head">
          <strong>切段任务</strong>
          <span>暂无任务</span>
        </div>
        <p>上传 Word 或粘贴文本后，这里会记录解析状态、warning 数量和生成的交稿草稿。</p>
      </section>
    );
  }

  return (
    <section className="import-job-panel">
      <div className="import-job-head">
        <strong>切段任务</strong>
        <span>{jobs.length} 条</span>
      </div>
      <div className="import-job-list">
        {jobs.map((job) => (
          <article className={`import-job-card ${job.status}`} key={job.id}>
            <div>
              <strong>{job.fileName}</strong>
              <span>
                {job.source === "docx" ? "Word 文件" : "粘贴文本"} · 声明范围 {job.declaredRangeText || "未填写"}
              </span>
            </div>
            <em>{deliveryImportJobStatusLabels[job.status]}</em>
            {job.deliveryPackageId ? <small>已关联交稿草稿：{job.deliveryPackageId}</small> : null}
            {job.issueCount ? <small>{job.issueCount} 条 warning/error 需要确认</small> : null}
            {job.errorText ? <small>{job.errorText}</small> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function ParserIssueList({ issues, remedies }: { issues: WordDeliveryIssue[]; remedies?: string[] }) {
  if (issues.length === 0 && (!remedies || remedies.length === 0)) {
    return <span>未发现解析 warning。</span>;
  }

  return (
    <div className="parse-issue-list">
      {issues.map((issue, index) => (
        <article key={`${issue.code}-${issue.episodeNo ?? "global"}-${issue.line ?? index}`}>
          <span>{formatParseIssueMeta(issue)}</span>
          <strong>{issue.message}</strong>
          {issue.remedy ? <small>{issue.remedy}</small> : null}
        </article>
      ))}
      {remedies && remedies.length > 0 ? (
        <article>
          <span>补救</span>
          <strong>可手动粘贴单集补救</strong>
          {remedies.map((remedy) => (
            <small key={remedy}>{remedy}</small>
          ))}
        </article>
      ) : null}
    </div>
  );
}

function formatParseIssueMeta(issue: WordDeliveryIssue) {
  const parts: string[] = [issue.severity, issue.code];

  if (issue.episodeNo) {
    parts.push(`第 ${issue.episodeNo} 集`);
  }

  if (issue.line) {
    parts.push(`第 ${issue.line} 行`);
  }

  return parts.join(" / ");
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

function buildNavigationItems(permissions: ReturnType<typeof selectPermissions>, primaryRole: ProjectRole): NavigationItem[] {
  const items: NavigationItem[] = [
    { icon: Home, label: "项目总览" },
    { icon: Inbox, label: "通知中心" },
    { icon: CalendarDays, label: "任务中心" },
    { icon: Package, label: "素材库" }
  ];
  const canUseDeliveryCenter = primaryRole === "owner" || primaryRole === "coordinator" || primaryRole === "head_writer";

  if (canUseDeliveryCenter) {
    items.push({ icon: FileText, label: "交稿中心" });
  }

  if (permissions.canManageMembers || permissions.canViewAllEpisodes) {
    items.push({ icon: Users, label: "团队成员" });
  }

  if (permissions.canManageProjects) {
    items.push({ icon: BarChart3, label: "数据报表" }, { icon: Settings, label: "系统设置" });
  }

  return items;
}

function buildShortcutItems(permissions: ReturnType<typeof selectPermissions>, primaryRole: ProjectRole): NavigationItem[] {
  const canUseDeliveryCenter = primaryRole === "owner" || primaryRole === "coordinator" || primaryRole === "head_writer";

  return baseShortcutItems.filter((item) => {
    if (item.label === "集数分配") {
      return permissions.canAssignEpisodes;
    }

    if (item.label === "团队成员") {
      return permissions.canManageMembers || permissions.canViewAllEpisodes;
    }

    if (item.label === "数据报表") {
      return permissions.canManageProjects;
    }

    if (item.label === "交稿中心") {
      return canUseDeliveryCenter;
    }

    return true;
  });
}

function formatActionError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("请至少确认一集实际变更")) {
    return "还没有勾选实际变更集。请先勾选至少一集真的改过的内容；没改的集不会进入本次发布。";
  }

  if (message.includes("发布交稿包权限不足") || message.includes("驳回交稿包权限不足")) {
    return "你当前不是统筹，不能发布或驳回交稿包。可以查看内容，但这一步需要统筹处理。";
  }

  if (message.includes("创建交稿包权限不足") || message.includes("提交交稿包权限不足")) {
    return "当前身份不能创建或提交交稿包。请让主编剧或统筹处理这一步。";
  }

  if (message.includes("交稿包至少需要包含一集剧本")) {
    return "交稿包里没有识别到单集内容。Word 切段失败时，可以手动粘贴单集补救。";
  }

  return message || "操作失败，请检查输入。";
}

type CurrentRevisionDocxInput = {
  deliveryPackageTitle?: string;
  episodeNo: number;
  projectName: string;
  revision: NonNullable<ReturnType<typeof selectEpisodeScriptTimeline>["currentRevision"]>;
};

async function downloadCurrentRevisionDocx(input: CurrentRevisionDocxInput) {
  const blob = await createEpisodeScriptDocxBlob({
    projectName: input.projectName,
    episodeNumber: input.episodeNo,
    scriptTitle: input.revision.title,
    body: input.revision.content,
    revisionSource: {
      deliveryPackageName: input.deliveryPackageTitle ?? "已发布交稿包",
      deliveryPackageId: input.revision.deliveryPackageId,
      version: `v${input.revision.revisionNo}`,
      note: "当前集生效剧本"
    }
  });

  triggerBrowserDownload(
    blob,
    buildCurrentRevisionDocxFileName(input.projectName, input.episodeNo, input.revision.revisionNo)
  );
}

function buildCurrentRevisionDocxFileName(projectName: string, episodeNo: number, revisionNo: number) {
  const safeProjectName = sanitizeDownloadFileName(projectName) || "项目";
  return `${safeProjectName}-第${episodeNo}集-当前剧本-v${revisionNo}.docx`;
}

function sanitizeDownloadFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatNotificationBody(notification: WorkspaceState["notifications"][number]) {
  if (notification.type !== "key_change") {
    return notification.body;
  }

  return `剧本已更新。请打开这一集查看最新正文和关键改动；没有分配给你的集不需要处理。来源：${notification.body}`;
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

function deliveryStatusLabel(status: keyof typeof deliveryStatusLabels) {
  return deliveryStatusLabels[status];
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
