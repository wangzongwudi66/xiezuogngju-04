import { describe, expect, it } from "vitest";
import type {
  AssetLockRecord,
  DeliveryPackageEpisode,
  Episode,
  EpisodeAssignment
} from "@aigc/domain";
import {
  buildAssetTimelineProjection,
  deriveCreatorAssignedEpisodeWindow,
  deriveDecisionItemFromAssetLockRecord,
  deriveSourceExcerptsFromPackageEpisodes
} from "./asset-decision-timeline-projection";

const now = "2026-05-24T00:00:00.000Z";

const episodes: Episode[] = [
  buildEpisode(1, "project-jincheng"),
  buildEpisode(2, "project-jincheng"),
  buildEpisode(3, "project-jincheng"),
  buildEpisode(1, "project-tide")
];

const assignments: EpisodeAssignment[] = [
  buildAssignment("assignment-a-1", "episode-project-jincheng-1", "user-creator-a"),
  buildAssignment("assignment-b-2", "episode-project-jincheng-2", "user-creator-b"),
  buildAssignment("assignment-a-tide-1", "episode-project-tide-1", "user-creator-a")
];

const packageEpisodes: DeliveryPackageEpisode[] = [
  buildPackageEpisode(1, "李砚旧伤妆在升降笼灯下显露。"),
  buildPackageEpisode(2, "红色安全灯闪烁，旧矿区手绘图被压在桌面。"),
  buildPackageEpisode(3, "井底粉尘爆闪触发争议。")
];

describe("asset decision timeline projection", () => {
  it("derives creator assigned windows from project assignments without cross-project leakage", () => {
    expect(
      deriveCreatorAssignedEpisodeWindow({
        assignments,
        episodes,
        projectId: "project-jincheng",
        userId: "user-creator-a"
      })
    ).toEqual({
      projectId: "project-jincheng",
      userId: "user-creator-a",
      episodeFrom: 1,
      episodeTo: 1,
      episodeNos: [1],
      sourceAssignmentIds: ["assignment-a-1"]
    });
    expect(
      deriveCreatorAssignedEpisodeWindow({
        assignments,
        episodes,
        projectId: "project-jincheng",
        userId: "user-empty"
      })
    ).toBeUndefined();
  });

  it("builds source excerpts from package episode lines and asset names", () => {
    const excerpts = deriveSourceExcerptsFromPackageEpisodes({
      assetNames: ["李砚旧伤妆", "旧矿区手绘图"],
      deliveryPackageEpisodes: packageEpisodes,
      deliveryPackageId: "delivery-current",
      projectId: "project-jincheng"
    });

    expect(excerpts.map((excerpt) => excerpt.id)).toEqual(["delivery-current-ep1-line1", "delivery-current-ep2-line1"]);
    expect(excerpts[0]).toEqual(
      expect.objectContaining({
        episodeNo: 1,
        relatedAssetNames: ["李砚旧伤妆"],
        startLine: 1,
        endLine: 1
      })
    );
  });

  it("maps asset lock statuses to decision kind and queue tags", () => {
    expect(deriveDecisionItemFromAssetLockRecord(buildRecord({ id: "asset-writer", writerConfirmation: "pending" }))).toEqual(
      expect.objectContaining({
        kind: "needs_writer_decision",
        status: "needs_writer_decision",
        queueTags: ["due_today", "script_changes"],
        assignedToRole: "head_writer"
      })
    );
    expect(deriveDecisionItemFromAssetLockRecord(buildRecord({ id: "asset-info", status: "needs_info" }))).toEqual(
      expect.objectContaining({
        kind: "needs_creator_confirm",
        status: "todo",
        queueTags: ["due_today", "affects_my_episodes"],
        assignedToRole: "creator"
      })
    );
    expect(deriveDecisionItemFromAssetLockRecord(buildRecord({ id: "asset-conflict", status: "disputed" }))).toEqual(
      expect.objectContaining({
        kind: "conflict",
        status: "conflict",
        queueTags: ["conflicts", "script_changes"],
        assignedToRole: "coordinator"
      })
    );
    expect(
      deriveDecisionItemFromAssetLockRecord(
        buildRecord({
          id: "asset-ready",
          writerConfirmation: "confirmed",
          productionConfirmation: "confirmed",
          status: "ready_to_lock"
        })
      )
    ).toEqual(
      expect.objectContaining({
        kind: "ready_to_execute",
        status: "executable",
        queueTags: ["affects_my_episodes"]
      })
    );
  });

  it("builds a creator-scoped projection from domain-like inputs", () => {
    const projection = buildAssetTimelineProjection({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current",
      viewerRole: "creator",
      viewerUserId: "user-creator-b",
      assetLockRecords: [
        buildRecord({ id: "asset-scar", assetName: "李砚旧伤妆", episodeNos: [1], productionConfirmation: "pending" }),
        buildRecord({ id: "asset-map", assetName: "旧矿区手绘图", episodeNos: [2], productionConfirmation: "pending" })
      ],
      deliveryPackageEpisodes: packageEpisodes,
      episodes,
      assignments
    });

    expect(projection.creatorAssignedWindow?.episodeNos).toEqual([2]);
    expect(projection.decisionQueue.map((decision) => decision.assetLockRecordId)).toEqual(["asset-map"]);
    expect(projection.sourceExcerpts.map((excerpt) => excerpt.episodeNo)).toEqual([2]);
    expect(projection.tracks.flatMap((track) => track.clips).find((clip) => clip.assetLockRecordId === "asset-scar")?.isDimmedByRoleScope).toBe(true);
  });

  it("does not invent creator work for empty assignments", () => {
    const projection = buildAssetTimelineProjection({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current",
      viewerRole: "creator",
      viewerUserId: "user-empty",
      assetLockRecords: [buildRecord({ id: "asset-map", assetName: "旧矿区手绘图", episodeNos: [2] })],
      deliveryPackageEpisodes: packageEpisodes,
      episodes,
      assignments
    });

    expect(projection.creatorAssignedWindow).toBeUndefined();
    expect(projection.decisionQueue).toEqual([]);
    expect(projection.sourceExcerpts).toEqual([]);
    expect(projection.tracks.flatMap((track) => track.clips).every((clip) => clip.isDimmedByRoleScope)).toBe(true);
  });

  it("does not let unrelated package episodes change the projected episode window", () => {
    const projection = buildAssetTimelineProjection({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current",
      viewerRole: "coordinator",
      viewerUserId: "user-coordinator",
      assetLockRecords: [],
      deliveryPackageEpisodes: [
        buildPackageEpisode(1, "Current package line."),
        buildPackageEpisode(24, "Unrelated package line.", "delivery-other")
      ],
      episodes,
      assignments
    });

    expect(projection.episodeWindow).toEqual({ from: 1, to: 10 });
    expect(projection.decisionQueue).toEqual([]);
  });

  it("projects previous-version ghost markers from matching previous asset locks", () => {
    const projection = buildAssetTimelineProjection({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current",
      viewerRole: "coordinator",
      viewerUserId: "user-coordinator",
      assetLockRecords: [
        buildRecord({
          id: "asset-map",
          assetName: "Mine Map",
          assetType: "prop",
          episodeNos: [2, 3]
        })
      ],
      previousAssetLockRecords: [
        buildRecord({
          id: "asset-map-prev",
          assetName: "Mine Map",
          assetType: "prop",
          deliveryPackageId: "delivery-previous",
          episodeNos: [1]
        })
      ],
      deliveryPackageEpisodes: [buildPackageEpisode(2, "Mine Map is unfolded."), buildPackageEpisode(3, "Mine Map is marked.")],
      episodes,
      assignments
    });

    const clip = projection.tracks.flatMap((track) => track.clips).find((item) => item.assetLockRecordId === "asset-map");

    expect(clip?.ghost).toEqual(
      expect.objectContaining({
        previousDeliveryPackageId: "delivery-previous",
        previousEpisodeFrom: 1,
        previousEpisodeTo: 1,
        changeMarkers: ["range_changed"]
      })
    );
  });
});

function buildEpisode(episodeNo: number, projectId: string): Episode {
  return {
    id: `episode-${projectId}-${episodeNo}`,
    projectId,
    episodeNo,
    title: `第 ${episodeNo} 集`,
    productionStatus: "not_started",
    hasUnreadKeyChange: false,
    openIssueCount: 0,
    assetTodoCount: 0
  };
}

function buildAssignment(id: string, episodeId: string, userId: string): EpisodeAssignment {
  return {
    id,
    episodeId,
    userId,
    responsibility: "creator",
    createdAt: now
  };
}

function buildPackageEpisode(episodeNo: number, content: string, deliveryPackageId = "delivery-current"): DeliveryPackageEpisode {
  return {
    id: `package-episode-${deliveryPackageId}-${episodeNo}`,
    deliveryPackageId,
    episodeNo,
    title: `第 ${episodeNo} 集`,
    content,
    isConfirmedChange: true
  };
}

function buildRecord(overrides: Partial<AssetLockRecord>): AssetLockRecord {
  return {
    id: "asset-record",
    projectId: "project-jincheng",
    deliveryPackageId: "delivery-current",
    episodeNos: [1],
    assetName: "李砚旧伤妆",
    assetType: "character",
    changeType: "modified",
    writerConfirmation: "confirmed",
    productionConfirmation: "confirmed",
    risk: "normal",
    status: "draft",
    createdByUserId: "user-owner",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}
