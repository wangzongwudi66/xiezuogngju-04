import type { EpisodeProductionStatus, selectMyEpisodes } from "@aigc/domain";

const taskStatusLabels: Record<EpisodeProductionStatus, string> = {
  not_started: "未开始",
  in_progress: "进行中",
  key_update: "待处理",
  blocked: "阻塞",
  done: "已完成"
};

export function buildTodayTasks(episodes: ReturnType<typeof selectMyEpisodes>) {
  return episodes.slice(0, 3).map((episode) => ({
    title: `第 ${episode.episodeNo} 集 · ${episode.projectName}`,
    meta: episode.openIssueCount ? `问题 ${episode.openIssueCount}` : episode.assetTodoCount ? `资产 ${episode.assetTodoCount}` : "优先级 · 中",
    badge: taskStatusLabels[episode.productionStatus],
    status: episode.productionStatus
  }));
}
