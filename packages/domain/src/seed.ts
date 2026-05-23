import type { WorkspaceState } from "./types";

const now = "2026-05-18T12:00:00.000Z";

export const seedWorkspace: WorkspaceState = {
  currentUserId: null,
  users: [
    { id: "user-owner", name: "陈统筹", defaultRole: "coordinator", avatarTone: "ink" },
    { id: "user-head-writer", name: "林主编", defaultRole: "head_writer", avatarTone: "violet" },
    { id: "user-writer", name: "周编剧", defaultRole: "writer", avatarTone: "amber" },
    { id: "user-creator-a", name: "沈制作 A", defaultRole: "creator", avatarTone: "teal" },
    { id: "user-creator-b", name: "王制作 B", defaultRole: "creator", avatarTone: "rose" }
  ],
  projects: [
    {
      id: "project-jincheng",
      name: "金城矿山",
      code: "JC",
      episodeCount: 60,
      status: "active",
      createdAt: now
    },
    {
      id: "project-tide",
      name: "潮汐档案",
      code: "TX",
      episodeCount: 60,
      status: "active",
      createdAt: now
    }
  ],
  members: [
    { id: "member-owner-jc", projectId: "project-jincheng", userId: "user-owner", role: "coordinator", createdAt: now },
    { id: "member-head-jc", projectId: "project-jincheng", userId: "user-head-writer", role: "head_writer", createdAt: now },
    { id: "member-writer-jc", projectId: "project-jincheng", userId: "user-writer", role: "writer", createdAt: now },
    { id: "member-creator-a-jc", projectId: "project-jincheng", userId: "user-creator-a", role: "creator", createdAt: now },
    { id: "member-creator-b-jc", projectId: "project-jincheng", userId: "user-creator-b", role: "creator", createdAt: now },
    { id: "member-creator-a-tx", projectId: "project-tide", userId: "user-creator-a", role: "creator", createdAt: now }
  ],
  memberPermissions: [],
  assetLockRecords: [],
  assetAttachments: [],
  deliveryPackages: [],
  deliveryPackageEpisodes: [],
  episodeRevisions: [],
  episodeCurrents: [],
  episodes: [
    ...Array.from({ length: 60 }, (_, index) => {
      const episodeNo = index + 1;
      return {
        id: `episode-jc-${episodeNo}`,
        projectId: "project-jincheng",
        episodeNo,
        title: `第 ${episodeNo} 集`,
        productionStatus:
          episodeNo === 3 ? "key_update" : episodeNo === 12 ? "blocked" : episodeNo < 3 ? "in_progress" : "not_started",
        hasUnreadKeyChange: episodeNo === 3,
        openIssueCount: episodeNo === 12 ? 2 : episodeNo === 3 ? 1 : 0,
        assetTodoCount: episodeNo === 5 ? 3 : 0
      } as const;
    }),
    ...Array.from({ length: 60 }, (_, index) => {
      const episodeNo = index + 1;
      return {
        id: `episode-tx-${episodeNo}`,
        projectId: "project-tide",
        episodeNo,
        title: `第 ${episodeNo} 集`,
        productionStatus: episodeNo < 5 ? "in_progress" : "not_started",
        hasUnreadKeyChange: false,
        openIssueCount: 0,
        assetTodoCount: episodeNo === 4 ? 1 : 0
      } as const;
    })
  ],
  assignments: [
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `assign-jc-writer-${index + 1}`,
      episodeId: `episode-jc-${index + 1}`,
      userId: "user-writer",
      responsibility: "writer" as const,
      createdAt: now
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `assign-jc-a-${index + 1}`,
      episodeId: `episode-jc-${index + 1}`,
      userId: "user-creator-a",
      responsibility: index === 0 ? ("lead_creator" as const) : ("creator" as const),
      createdAt: now
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `assign-jc-b-${index + 9}`,
      episodeId: `episode-jc-${index + 9}`,
      userId: "user-creator-b",
      responsibility: "creator" as const,
      createdAt: now
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `assign-tx-a-${index + 3}`,
      episodeId: `episode-tx-${index + 3}`,
      userId: "user-creator-a",
      responsibility: "creator" as const,
      createdAt: now
    }))
  ],
  notifications: [
    {
      id: "notification-key-episode-3",
      projectId: "project-jincheng",
      episodeId: "episode-jc-3",
      recipientId: "user-creator-a",
      type: "key_change",
      title: "第 3 集创作重点已标记关键变更",
      body: "林主编调整了矿山入口段落的情绪重点，请制作侧优先查看。",
      createdAt: "2026-05-18T12:30:00.000Z"
    },
    {
      id: "notification-mention-episode-5",
      projectId: "project-jincheng",
      episodeId: "episode-jc-5",
      recipientId: "user-creator-a",
      type: "mention",
      title: "陈统筹 @ 你查看第 5 集资产准备",
      body: "角色旧伤造型需要先出两个候选，M3 会进入资产位审核。",
      createdAt: "2026-05-18T12:45:00.000Z"
    }
  ]
};
