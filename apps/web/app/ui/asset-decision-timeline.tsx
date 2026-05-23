"use client";

import { AlertTriangle, ChevronRight, Clock3, Layers3, PanelRightOpen, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import type { ProjectRole } from "@aigc/domain";
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
  AssetTimelineQueueTag
} from "./asset-decision-timeline-data";

const queueOrder: AssetTimelineQueueTag[] = ["due_today", "affects_my_episodes", "conflicts", "script_changes", "waiting_others"];

export function AssetDecisionTimelinePrototype({
  actorRole,
  actorUserId,
  projectId,
  projectName
}: {
  actorRole: ProjectRole;
  actorUserId: string;
  projectId: string;
  projectName: string;
}) {
  const viewModel = useMemo(
    () =>
      buildMockAssetDecisionTimelineViewModel({
        projectId,
        viewerRole: actorRole,
        viewerUserId: actorUserId
      }),
    [actorRole, actorUserId, projectId]
  );
  const defaultQueueTag: AssetTimelineQueueTag = viewModel.creatorAssignedWindow ? "affects_my_episodes" : "due_today";
  const [activeQueueTag, setActiveQueueTag] = useState<AssetTimelineQueueTag>(defaultQueueTag);
  const [selectedClipId, setSelectedClipId] = useState(viewModel.selectedClipId ?? "");
  const [selectedGroupKind, setSelectedGroupKind] = useState<AssetDecisionGroupSummary["kind"] | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const episodeNos = getEpisodeWindowNos(viewModel.episodeWindow);
  const filteredQueue = filterDecisionItemsByQueue(viewModel.decisionQueue, activeQueueTag);
  const decisionGroups = summarizeDecisionGroups(viewModel.decisionQueue);
  const selectedGroup = decisionGroups.find((group) => group.kind === selectedGroupKind);
  const selectedClip = selectedGroup ? undefined : viewModel.tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId);
  const selectedDecisions = selectedGroup
    ? findDecisionGroupItems(viewModel, selectedGroup.decisionItemIds)
    : selectedClip
      ? findClipDecisionItems(viewModel, selectedClip.id)
      : filteredQueue.slice(0, 1);
  const focusedClipIds = new Set(
    (selectedGroup ? selectedDecisions : filteredQueue).map((item) => item.clipId).filter(Boolean)
  );
  const selectedSourceExcerpts = findSourceExcerpts(
    viewModel,
    selectedGroup || !selectedClip
      ? selectedDecisions.flatMap((item) => item.sourceExcerptIds)
      : selectedClip.currentSegment.sourceExcerptIds
  );

  function selectClip(clip: AssetTimelineClip) {
    setSelectedClipId(clip.id);
    setSelectedGroupKind(null);
    setDrawerOpen(true);
  }

  function selectGroup(group: AssetDecisionGroupSummary) {
    const groupItems = findDecisionGroupItems(viewModel, group.decisionItemIds);
    setSelectedGroupKind(group.kind);

    if (groupItems[0]?.clipId) {
      setSelectedClipId(groupItems[0].clipId);
    }

    setDrawerOpen(true);
  }

  function selectQueue(tag: AssetTimelineQueueTag) {
    const nextQueue = filterDecisionItemsByQueue(viewModel.decisionQueue, tag);
    setActiveQueueTag(tag);
    setSelectedGroupKind(null);

    if (nextQueue[0]?.clipId) {
      setSelectedClipId(nextQueue[0].clipId);
    }

    setDrawerOpen(true);
  }

  return (
    <section className="decision-timeline-shell">
      <div className="decision-timeline-topbar">
        <div>
          <span>{projectName} · 静态原型</span>
          <h2>资产决策剪辑轨道</h2>
        </div>
        <div className="decision-timeline-controls" aria-label="资产轨道视图控制">
          <button className="active" type="button">第 {viewModel.episodeWindow.from}-{viewModel.episodeWindow.to} 集工作视窗</button>
          <button type="button">当前版 vs 上一版</button>
          <button type="button">{viewModel.permissions.canViewFullSeries ? "全剧视角" : "只看影响我的集"}</button>
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
                className={tag === activeQueueTag ? "active" : ""}
                key={tag}
                onClick={() => selectQueue(tag)}
                type="button"
              >
                <span>{timelineQueueLabels[tag]}</span>
                <strong>{count}</strong>
              </button>
            );
          })}
          <p>{viewModel.creatorAssignedWindow ? `当前默认聚焦第 ${viewModel.creatorAssignedWindow.episodeFrom}-${viewModel.creatorAssignedWindow.episodeTo} 集。` : "统筹/编剧可查看当前工作窗口内的全部决策压力。"}</p>
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
                <strong>{group.count}</strong>
              </button>
            ))}
          </div>

          <div className="decision-episode-ruler" style={{ "--episode-count": episodeNos.length } as CSSProperties}>
            {episodeNos.map((episodeNo) => (
              <span className={viewModel.creatorAssignedWindow?.episodeNos.includes(episodeNo) ? "assigned" : ""} key={episodeNo}>
                第 {episodeNo} 集
              </span>
            ))}
          </div>

          <div className="decision-track-board">
            {viewModel.tracks.map((track) => (
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
                        className={`decision-clip ${clip.assetType} ${clip.currentSegment.risk} ${clip.id === selectedClipId ? "selected" : ""} ${
                          focusedClipIds.size > 0 && !focusedClipIds.has(clip.id) ? "muted" : ""
                        }`}
                        key={clip.id}
                        onClick={() => selectClip(clip)}
                        style={{ gridColumn: position.gridColumn }}
                        type="button"
                      >
                        {clip.ghost?.changeMarkers.includes("new") ? <em className="decision-change-chip">新增</em> : null}
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
        </main>

        {drawerOpen ? (
          <AssetTimelineDetailDrawer
            clip={selectedClip}
            group={selectedGroup}
            decisions={selectedDecisions}
            onClose={() => setDrawerOpen(false)}
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

      <div className="decision-detail-actions">
        <button className="secondary-button" type="button">我已了解</button>
        <button className="primary-button" type="button">
          确认可执行
          <ChevronRight size={15} />
        </button>
      </div>
    </aside>
  );
}
