"use client";

import { AlertTriangle, Clock3, Layers3, PanelRightOpen, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectRole } from "@aigc/domain";
import { fetchAssetDecisionTimelineProjection, formatAssetDecisionTimelineError } from "./asset-decision-timeline-api";
import {
  buildMockAssetDecisionTimelineViewModel,
  filterDecisionItemsByQueue,
  findClipDecisionItems,
  findDecisionGroupItems,
  findSourceExcerpts,
  getEpisodeWindowNos,
  mapClipToEpisodeGrid,
  summarizeDecisionGroups,
  timelineDecisionLabels,
  timelineQueueLabels,
  timelineRiskLabels
} from "./asset-decision-timeline-data";
import type {
  AssetDecisionGroupSummary,
  AssetDecisionItem,
  AssetTimelineClip,
  AssetTimelineQueueTag,
  RoleScopedAssetTimelineViewModel
} from "./asset-decision-timeline-data";
import { buildTimelineResetKey, getClipChangeMarkers, getDecisionClipClassName } from "./asset-decision-timeline-view";

const queueOrder: AssetTimelineQueueTag[] = ["due_today", "affects_my_episodes", "conflicts", "script_changes", "waiting_others"];
const changeMarkerLabels: Record<string, string> = {
  new: "新增",
  removed: "删除",
  range_changed: "范围变化",
  state_changed: "状态变化",
  source_changed: "来源变化"
};
const decisionStatusLabels: Record<AssetDecisionItem["status"], string> = {
  todo: "待处理",
  acknowledged: "已了解",
  executable: "可执行",
  needs_writer_decision: "待编剧定口径",
  conflict: "冲突",
  returned: "已退回",
  resolved: "已解决"
};
const decisionRoleLabels: Partial<Record<ProjectRole, string>> = {
  owner: "项目所有者",
  coordinator: "统筹",
  head_writer: "主编剧",
  writer: "编剧",
  creator: "创作者"
};

export function AssetDecisionTimelinePrototype({
  actorRole,
  actorUserId,
  assignedEpisodeNos,
  deliveryPackageId,
  projectId,
  projectName
}: {
  actorRole: ProjectRole;
  actorUserId: string;
  assignedEpisodeNos?: number[];
  deliveryPackageId?: string;
  projectId: string;
  projectName: string;
}) {
  const mockViewModel = useMemo(
    () =>
      buildMockAssetDecisionTimelineViewModel({
        projectId,
        assignedEpisodeNos,
        viewerRole: actorRole,
        viewerUserId: actorUserId
      }),
    [actorRole, actorUserId, assignedEpisodeNos, projectId]
  );
  const [remoteProjection, setRemoteProjection] = useState<{
    deliveryPackageId?: string;
    errorText?: string;
    status: "demo" | "fallback" | "loading" | "real";
    viewModel?: RoleScopedAssetTimelineViewModel;
  }>({ status: "demo" });

  useEffect(() => {
    if (!deliveryPackageId) {
      setRemoteProjection({ status: "demo" });
      return;
    }

    let cancelled = false;
    setRemoteProjection({ deliveryPackageId, status: "loading" });

    fetchAssetDecisionTimelineProjection({ deliveryPackageId, projectId })
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (result.ok) {
          setRemoteProjection({ deliveryPackageId, status: "real", viewModel: result.projection });
          return;
        }

        setRemoteProjection({
          deliveryPackageId,
          errorText: formatAssetDecisionTimelineError(result),
          status: "fallback"
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setRemoteProjection({
          deliveryPackageId,
          errorText: formatAssetDecisionTimelineError(error) || "真实资产决策轨道加载失败，已显示 Demo 数据。",
          status: "fallback"
        });
      });

    return () => {
      cancelled = true;
    };
  }, [deliveryPackageId, projectId]);

  const viewModel = remoteProjection.status === "real" && remoteProjection.viewModel ? remoteProjection.viewModel : mockViewModel;
  const viewModelSourceKey = `${remoteProjection.status}:${remoteProjection.deliveryPackageId ?? "demo"}`;
  const viewModelSourceLabel =
    remoteProjection.status === "real"
      ? "真实投影"
      : remoteProjection.status === "loading"
        ? "加载真实投影"
        : remoteProjection.status === "fallback"
          ? "Demo fallback"
          : "静态原型";
  const viewModelSourceText = remoteProjection.errorText || viewModelSourceLabel;
  const defaultQueueTag: AssetTimelineQueueTag = viewModel.creatorAssignedWindow ? "affects_my_episodes" : "due_today";
  const timelineResetKey = buildTimelineResetKey({
    actorRole: viewModel.viewerRole,
    actorUserId: viewModel.viewerUserId,
    assignedEpisodeNos: viewModel.creatorAssignedWindow?.episodeNos ?? assignedEpisodeNos,
    defaultQueueTag,
    projectId,
    selectedClipId: viewModel.selectedClipId,
    viewModelSourceKey
  });
  const [activeQueueTag, setActiveQueueTag] = useState<AssetTimelineQueueTag>(defaultQueueTag);
  const [selectedClipId, setSelectedClipId] = useState(viewModel.selectedClipId ?? "");
  const [selectedGroupKind, setSelectedGroupKind] = useState<AssetDecisionGroupSummary["kind"] | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [stateScopeKey, setStateScopeKey] = useState(timelineResetKey);

  useEffect(() => {
    setStateScopeKey(timelineResetKey);
    setActiveQueueTag(defaultQueueTag);
    setSelectedClipId(viewModel.selectedClipId ?? "");
    setSelectedGroupKind(null);
    setDrawerOpen(false);
  }, [defaultQueueTag, timelineResetKey, viewModel.selectedClipId]);

  const isStateCurrent = stateScopeKey === timelineResetKey;
  const effectiveActiveQueueTag = isStateCurrent ? activeQueueTag : defaultQueueTag;
  const effectiveSelectedClipId = isStateCurrent ? selectedClipId : viewModel.selectedClipId ?? "";
  const effectiveSelectedGroupKind = isStateCurrent ? selectedGroupKind : null;
  const effectiveDrawerOpen = isStateCurrent ? drawerOpen : false;
  const episodeNos = getEpisodeWindowNos(viewModel.episodeWindow);
  const filteredQueue = filterDecisionItemsByQueue(viewModel.decisionQueue, effectiveActiveQueueTag);
  const decisionGroups = summarizeDecisionGroups(viewModel.decisionQueue);
  const visibleTracks = viewModel.tracks.filter((track) => track.clips.length > 0);
  const selectedGroup = decisionGroups.find((group) => group.kind === effectiveSelectedGroupKind);
  const selectedClip = selectedGroup
    ? undefined
    : viewModel.tracks.flatMap((track) => track.clips).find((clip) => clip.id === effectiveSelectedClipId);
  const selectedDecisions = selectedGroup
    ? findDecisionGroupItems(viewModel, selectedGroup.decisionItemIds)
    : selectedClip
      ? findClipDecisionItems(viewModel, selectedClip.id)
      : filteredQueue.slice(0, 1);
  const focusedClipIds = new Set(
    (selectedGroup ? selectedDecisions : filteredQueue).map((item) => item.clipId).filter((clipId): clipId is string => Boolean(clipId))
  );
  const selectedSourceExcerpts = findSourceExcerpts(
    viewModel,
    selectedGroup || !selectedClip
      ? selectedDecisions.flatMap((item) => item.sourceExcerptIds)
      : selectedClip.currentSegment.sourceExcerptIds
  );

  function selectClip(clip: AssetTimelineClip) {
    setStateScopeKey(timelineResetKey);
    setSelectedClipId(clip.id);
    setSelectedGroupKind(null);
    setDrawerOpen(true);
  }

  function selectGroup(group: AssetDecisionGroupSummary) {
    const groupItems = findDecisionGroupItems(viewModel, group.decisionItemIds);
    setStateScopeKey(timelineResetKey);
    setSelectedGroupKind(group.kind);

    if (groupItems[0]?.clipId) {
      setSelectedClipId(groupItems[0].clipId);
    }

    setDrawerOpen(true);
  }

  function selectQueue(tag: AssetTimelineQueueTag) {
    const nextQueue = filterDecisionItemsByQueue(viewModel.decisionQueue, tag);
    setStateScopeKey(timelineResetKey);
    setActiveQueueTag(tag);
    setSelectedGroupKind(null);

    if (nextQueue[0]?.clipId) {
      setSelectedClipId(nextQueue[0].clipId);
      setDrawerOpen(true);
      return;
    }

    setSelectedClipId("");
    setDrawerOpen(false);
  }

  function selectDecision(decision: AssetDecisionItem) {
    setStateScopeKey(timelineResetKey);
    setSelectedGroupKind(null);

    if (decision.clipId) {
      setSelectedClipId(decision.clipId);
    }

    setDrawerOpen(true);
  }

  const queueScopeDescription = viewModel.creatorAssignedWindow
    ? `当前默认聚焦第 ${viewModel.creatorAssignedWindow.episodeFrom}-${viewModel.creatorAssignedWindow.episodeTo} 集。`
    : viewModel.viewerRole === "creator"
      ? "当前账号暂无分配集数，暂不显示创作者待处理决策。"
      : "统筹/编剧可查看当前工作窗口内的全部决策压力。";
  const scopeControlLabel = viewModel.permissions.canViewFullSeries
    ? "全剧视角"
    : viewModel.viewerRole === "creator"
      ? "只看影响我的集"
      : "当前工作窗口";

  return (
    <section className="decision-timeline-shell">
      <div className="decision-timeline-topbar">
        <div>
          <span>{projectName} · {viewModelSourceText}</span>
          <h2>资产决策剪辑轨道</h2>
        </div>
        <div className="decision-timeline-controls" aria-label="资产轨道视图控制">
          <button className="active" type="button">第 {viewModel.episodeWindow.from}-{viewModel.episodeWindow.to} 集工作视窗</button>
          <button type="button">当前版 vs 上一版</button>
          <button type="button">{scopeControlLabel}</button>
        </div>
      </div>

      <div className="decision-timeline-grid">
        <aside className="decision-queue-panel" aria-label="决策队列">
          <div className="decision-panel-title">
            <Clock3 size={16} />
            <strong>决策队列</strong>
          </div>
          {queueOrder.map((tag) => {
            const count = filterDecisionItemsByQueue(viewModel.decisionQueue, tag).length;
            return (
              <button
                className={tag === effectiveActiveQueueTag ? "active" : ""}
                disabled={count === 0}
                key={tag}
                onClick={() => selectQueue(tag)}
                type="button"
              >
                <span>{timelineQueueLabels[tag]}</span>
                <strong>{count}</strong>
              </button>
            );
          })}
          <div className="decision-queue-items">
            {filteredQueue.length > 0 ? (
              filteredQueue.slice(0, 4).map((decision) => (
                <button key={decision.id} onClick={() => selectDecision(decision)} type="button">
                  <span>{decision.title}</span>
                  <small>
                    第 {formatEpisodeRange(decision.episodeNos)} 集 · {timelineRiskLabels[decision.risk]}
                  </small>
                </button>
              ))
            ) : (
              <span className="decision-queue-empty">当前没有决策项</span>
            )}
          </div>
          <p>{queueScopeDescription}</p>
        </aside>

        <main className="decision-track-stage">
          <div className="decision-track-summary">
            {decisionGroups.map((group) => (
              <button
                className={`decision-aggregate ${group.kind} ${selectedGroup?.kind === group.kind ? "selected" : ""}`}
                key={group.kind}
                onClick={() => selectGroup(group)}
                type="button"
              >
                <span>{group.label}</span>
                <small>
                  第 {formatEpisodeRange(group.episodeNos)} 集 · {timelineRiskLabels[group.risk]}
                </small>
                <strong>{group.count}</strong>
              </button>
            ))}
          </div>
          <div className="decision-track-legend" aria-label="变化标记图例">
            {Object.entries(changeMarkerLabels).map(([value, label]) => (
              <span className={value} key={value}>{label}</span>
            ))}
          </div>

          <div className="decision-track-scroll">
            <div className="decision-ruler-row">
              <div className="decision-ruler-spacer" aria-hidden="true" />
              <div className="decision-episode-ruler" style={{ "--episode-count": episodeNos.length } as CSSProperties}>
                {episodeNos.map((episodeNo) => (
                  <span className={viewModel.creatorAssignedWindow?.episodeNos.includes(episodeNo) ? "assigned" : ""} key={episodeNo}>
                    第 {episodeNo} 集
                  </span>
                ))}
              </div>
            </div>

            <div className="decision-track-board">
              {visibleTracks.map((track) => (
                <section className="decision-track-row" key={track.id}>
                  <div className="decision-track-label">
                    <Layers3 size={15} />
                    <strong>{track.label}</strong>
                  </div>
                  <div className="decision-track-lane" style={{ "--episode-count": episodeNos.length } as CSSProperties}>
                    <div className="decision-ghost-layer" aria-hidden="true">
                      {track.clips.map((clip) => {
                        const currentPosition = mapClipToEpisodeGrid(clip, viewModel.episodeWindow);
                        return currentPosition && clip.ghost ? (
                          <GhostClip
                            clip={clip}
                            fallbackGridColumn={currentPosition.gridColumn}
                            key={`${clip.id}-ghost`}
                            window={viewModel.episodeWindow}
                          />
                        ) : null;
                      })}
                    </div>
                    {track.clips.map((clip) => {
                      const position = mapClipToEpisodeGrid(clip, viewModel.episodeWindow);

                      if (!position) {
                        return null;
                      }

                      return (
                        <button
                          className={getDecisionClipClassName({ clip, focusedClipIds, selectedClipId: effectiveSelectedClipId })}
                          key={clip.id}
                          onClick={() => selectClip(clip)}
                          style={{ gridColumn: position.gridColumn }}
                          type="button"
                        >
                          {clip.ghost?.changeMarkers.slice(0, 2).map((marker) => (
                            <em className={`decision-change-chip ${marker}`} key={marker}>{changeMarkerLabels[marker]}</em>
                          ))}
                          <span>{clip.assetName}</span>
                          <strong>{clip.currentSegment.stateLabel}</strong>
                          <small>
                            第 {clip.episodeFrom}-{clip.episodeTo} 集 · {timelineRiskLabels[clip.currentSegment.risk]}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </main>

        {effectiveDrawerOpen ? (
          <AssetTimelineDetailDrawer
            clip={selectedClip}
            group={selectedGroup}
            decisions={selectedDecisions}
            onClose={() => {
              setStateScopeKey(timelineResetKey);
              setDrawerOpen(false);
            }}
            sourceExcerpts={selectedSourceExcerpts}
          />
        ) : (
          <button className="decision-drawer-tab" onClick={() => setDrawerOpen(true)} type="button">
            <PanelRightOpen size={16} />
            详情
          </button>
        )}
      </div>
    </section>
  );
}

function formatEpisodeRange(episodeNos: number[]) {
  if (episodeNos.length === 0) {
    return "-";
  }

  return episodeNos[0] === episodeNos[episodeNos.length - 1]
    ? `${episodeNos[0]}`
    : `${episodeNos[0]}-${episodeNos[episodeNos.length - 1]}`;
}

function GhostClip({
  clip,
  fallbackGridColumn,
  window
}: {
  clip: AssetTimelineClip;
  fallbackGridColumn: string;
  window: { from: number; to: number };
}) {
  const markerClasses = clip.ghost?.changeMarkers.join(" ") ?? "";

  if (!clip.ghost?.previousEpisodeFrom || !clip.ghost.previousEpisodeTo) {
    return (
      <span className={`decision-ghost note new ${markerClasses}`} style={{ gridColumn: fallbackGridColumn }}>
        上一版无对应资产
      </span>
    );
  }

  const ghostPosition = mapClipToEpisodeGrid(
    {
      episodeFrom: clip.ghost.previousEpisodeFrom,
      episodeTo: clip.ghost.previousEpisodeTo
    },
    window
  );

  if (!ghostPosition) {
    return (
      <span className={`decision-ghost note out ${markerClasses}`} style={{ gridColumn: fallbackGridColumn }}>
        上一版在窗口外
      </span>
    );
  }

  return (
    <span
      className={`decision-ghost ${markerClasses}`}
      style={{ gridColumn: ghostPosition.gridColumn }}
      title={clip.ghost.summary}
    />
  );
}

function AssetTimelineDetailDrawer({
  clip,
  group,
  decisions,
  onClose,
  sourceExcerpts
}: {
  clip?: AssetTimelineClip;
  group?: AssetDecisionGroupSummary;
  decisions: AssetDecisionItem[];
  onClose: () => void;
  sourceExcerpts: ReturnType<typeof findSourceExcerpts>;
}) {
  const currentSummaries = group?.currentSummary ?? decisions.map((decision) => decision.currentSummary).join("；");
  const previousSummaries = group?.previousSummary ?? decisions.map((decision) => decision.previousSummary).filter(Boolean).join("；");

  return (
    <aside className="decision-detail-drawer">
      <div className="decision-detail-head">
        <div>
          <span>{group ? "决策聚合" : "决策说明"}</span>
          <h3>{group?.label ?? clip?.assetName ?? decisions[0]?.title ?? "未选择资产"}</h3>
        </div>
        <button className="text-link" onClick={onClose} type="button">
          收起
        </button>
      </div>

      {clip ? (
        <div className="decision-detail-card hero">
          <Sparkles size={16} />
          <div>
            <strong>{clip.currentSegment.stateLabel}</strong>
            <p>
              第 {clip.episodeFrom}-{clip.episodeTo} 集 · {timelineRiskLabels[clip.currentSegment.risk]}
            </p>
          </div>
        </div>
      ) : null}

      {clip ? (
        <div className="decision-detail-card">
          <strong>资产详情</strong>
          <dl className="decision-detail-facts">
            <div>
              <dt>资产类型</dt>
              <dd>{clip.assetType}</dd>
            </div>
            <div>
              <dt>涉及集数</dt>
              <dd>第 {clip.episodeFrom}-{clip.episodeTo} 集</dd>
            </div>
            <div>
              <dt>风险等级</dt>
              <dd>{timelineRiskLabels[clip.currentSegment.risk]}</dd>
            </div>
            <div>
              <dt>变化标记</dt>
              <dd>{clip.ghost?.changeMarkers.map((marker) => changeMarkerLabels[marker]).join("、") || "沿用"}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      {group ? (
        <div className="decision-detail-card hero">
          <Sparkles size={16} />
          <div>
            <strong>
              {group.count} 项 · 第 {group.episodeNos[0]}-{group.episodeNos[group.episodeNos.length - 1]} 集
            </strong>
            <p>{timelineRiskLabels[group.risk]}风险聚合，用于判断这组资产为什么需要处理。</p>
          </div>
        </div>
      ) : null}

      <div className="decision-detail-card">
        <strong>当前版摘要</strong>
        <p>{currentSummaries || "当前选择项暂无当前版摘要。"}</p>
        <strong>上一版摘要</strong>
        <p>{previousSummaries || "上一版没有对应摘要或不在当前原型样例内。"}</p>
      </div>

      <div className="decision-detail-card">
        <strong>需要处理的问题</strong>
        {decisions.length === 0 ? <p>当前资产在这个视窗内没有阻塞决策。</p> : null}
        {decisions.map((decision) => (
          <article className={`decision-item ${decision.kind}`} key={decision.id}>
            <span>{timelineDecisionLabels[decision.kind]}</span>
            <strong>{decision.title}</strong>
            <small>
              {decisionStatusLabels[decision.status]} · {decision.assignedToRole ? decisionRoleLabels[decision.assignedToRole] : "未指定"} · 第 {formatEpisodeRange(decision.episodeNos)} 集
            </small>
            <p>{decision.description}</p>
          </article>
        ))}
      </div>

      <div className="decision-detail-card">
        <strong>剧本来源段落</strong>
        {sourceExcerpts.map((excerpt) => (
          <article className="source-excerpt" key={excerpt.id}>
            <span>{excerpt.title ?? `第 ${excerpt.episodeNo} 集`}</span>
            <p>{excerpt.excerpt}</p>
          </article>
        ))}
      </div>

      {clip?.ghost ? (
        <div className="decision-detail-card warning">
          <AlertTriangle size={15} />
          <div>
            <strong>上一版对比</strong>
            <p>{clip.ghost.summary}</p>
          </div>
        </div>
      ) : null}

      <div className="decision-detail-card">
        <strong>沟通记录</strong>
        <article className="source-excerpt">
          <span>统筹口径</span>
          <p>先按当前版剧本范围判断资产影响；争议项由统筹协调，确认后再进入执行。</p>
        </article>
        <article className="source-excerpt">
          <span>制作侧反馈</span>
          <p>需要明确可见范围、状态延续和是否影响已分配集数，避免重复建资产。</p>
        </article>
      </div>

    </aside>
  );
}
