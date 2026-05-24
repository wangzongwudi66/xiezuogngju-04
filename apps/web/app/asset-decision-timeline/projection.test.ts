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
} from "./projection";

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
        assignments: [...assignments, buildAssignment("assignment-a-support-2", "episode-project-jincheng-2", "user-creator-a", "support")],
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
    expect(projection.tracks.flatMap((track) => track.clips).map((clip) => clip.assetLockRecordId)).toEqual(["asset-map"]);
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
    expect(projection.tracks.flatMap((track) => track.clips)).toEqual([]);
    expect(projection.selectedClipId).toBeUndefined();
  });

  it("scopes ordinary writers to writer assignments while head writers can inspect the full projection", () => {
    const projectionInput = {
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current",
      assetLockRecords: [
        buildRecord({ id: "asset-support", assetName: "Support Asset", assetType: "prop", episodeNos: [2] }),
        buildRecord({ id: "asset-writer", assetName: "Writer Asset", assetType: "scene", episodeNos: [3] })
      ],
      deliveryPackageEpisodes: [
        buildPackageEpisode(2, "Support Asset remains out of writer scope."),
        buildPackageEpisode(3, "Writer Asset needs a scene decision.")
      ],
      episodes,
      assignments: [
        ...assignments,
        buildAssignment("assignment-writer-3", "episode-project-jincheng-3", "user-writer-a", "writer"),
        buildAssignment("assignment-support-2", "episode-project-jincheng-2", "user-writer-a", "support")
      ]
    };

    const writerProjection = buildAssetTimelineProjection({
      ...projectionInput,
      viewerRole: "writer",
      viewerUserId: "user-writer-a"
    });
    const headWriterProjection = buildAssetTimelineProjection({
      ...projectionInput,
      viewerRole: "head_writer",
      viewerUserId: "user-head-writer"
    });

    expect(writerProjection.permissions.canViewFullSeries).toBe(false);
    expect(writerProjection.decisionQueue.map((decision) => decision.assetLockRecordId)).toEqual(["asset-writer"]);
    expect(writerProjection.sourceExcerpts.map((excerpt) => excerpt.episodeNo)).toEqual([3]);
    expect(writerProjection.tracks.flatMap((track) => track.clips).map((clip) => clip.assetLockRecordId)).toEqual(["asset-writer"]);
    expect(headWriterProjection.permissions.canViewFullSeries).toBe(true);
    expect(headWriterProjection.decisionQueue.map((decision) => decision.assetLockRecordId)).toEqual(["asset-support", "asset-writer"]);
  });

  it("keeps writer work windows centered on scoped real records instead of the full assignment range", () => {
    const broadEpisodes = Array.from({ length: 20 }, (_, index) => buildEpisode(index + 1, "project-jincheng"));
    const writerProjection = buildAssetTimelineProjection({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current",
      viewerRole: "writer",
      viewerUserId: "user-writer-a",
      assetLockRecords: [
        buildRecord({ id: "asset-ep3", assetName: "Episode Three Asset", episodeNos: [3] }),
        buildRecord({ id: "asset-ep4", assetName: "Episode Four Asset", episodeNos: [4] })
      ],
      deliveryPackageEpisodes: [
        buildPackageEpisode(3, "Episode Three Asset needs a decision."),
        buildPackageEpisode(4, "Episode Four Asset needs a decision.")
      ],
      episodes: broadEpisodes,
      assignments: broadEpisodes.map((episode) =>
        buildAssignment(`assignment-writer-${episode.episodeNo}`, episode.id, "user-writer-a", "writer")
      )
    });

    expect(writerProjection.episodeWindow).toEqual({ from: 2, to: 11 });
    expect(writerProjection.tracks.flatMap((track) => track.clips).map((clip) => clip.assetLockRecordId)).toEqual([
      "asset-ep3",
      "asset-ep4"
    ]);
  });

  it("filters current asset records by project and delivery package", () => {
    const projection = buildAssetTimelineProjection({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current",
      viewerRole: "coordinator",
      viewerUserId: "user-coordinator",
      assetLockRecords: [
        buildRecord({ id: "asset-current", assetName: "Current Asset", episodeNos: [1] }),
        buildRecord({ id: "asset-other-project", assetName: "Other Project Asset", projectId: "project-tide", episodeNos: [2] }),
        buildRecord({ id: "asset-other-package", assetName: "Other Package Asset", deliveryPackageId: "delivery-other", episodeNos: [3] })
      ],
      deliveryPackageEpisodes: [
        buildPackageEpisode(1, "Current Asset appears."),
        buildPackageEpisode(2, "Other Project Asset should be ignored."),
        buildPackageEpisode(3, "Other Package Asset should be ignored.", "delivery-other")
      ],
      episodes,
      assignments
    });

    expect(projection.decisionQueue.map((decision) => decision.assetLockRecordId)).toEqual(["asset-current"]);
    expect(projection.sourceExcerpts.map((excerpt) => excerpt.relatedAssetNames)).toEqual([["Current Asset"]]);
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

  it("uses only confirmed package episode content for source excerpts", () => {
    const projection = buildAssetTimelineProjection({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current",
      viewerRole: "coordinator",
      viewerUserId: "user-coordinator",
      assetLockRecords: [
        buildRecord({ id: "asset-confirmed", assetName: "Confirmed Asset", episodeNos: [1] }),
        buildRecord({ id: "asset-unconfirmed", assetName: "Unconfirmed Asset", episodeNos: [2] })
      ],
      deliveryPackageEpisodes: [
        buildPackageEpisode(1, "Confirmed Asset appears."),
        buildPackageEpisode(2, "Unconfirmed Asset appears.", "delivery-current", false)
      ],
      episodes,
      assignments
    });

    expect(projection.sourceExcerpts.map((excerpt) => excerpt.relatedAssetNames)).toEqual([["Confirmed Asset"]]);
    expect(
      projection.decisionQueue.find((decision) => decision.assetLockRecordId === "asset-unconfirmed")?.sourceExcerptIds
    ).toEqual([]);
  });

  it("projects previous-version ghost markers from matching previous asset locks", () => {
    const projection = buildAssetTimelineProjection({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current",
      previousDeliveryPackageId: "delivery-previous",
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
          projectId: "project-tide",
          deliveryPackageId: "delivery-previous",
          episodeNos: [9]
        }),
        buildRecord({
          id: "asset-map-current-scope",
          assetName: "Mine Map",
          assetType: "prop",
          deliveryPackageId: "delivery-current",
          episodeNos: [8]
        }),
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

  it("does not match previous ghosts across projects or the current package", () => {
    const projection = buildAssetTimelineProjection({
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current",
      viewerRole: "coordinator",
      viewerUserId: "user-coordinator",
      assetLockRecords: [buildRecord({ id: "asset-map", assetName: "Mine Map", assetType: "prop", episodeNos: [2] })],
      previousAssetLockRecords: [
        buildRecord({
          id: "asset-map-wrong-project",
          assetName: "Mine Map",
          assetType: "prop",
          projectId: "project-tide",
          deliveryPackageId: "delivery-previous",
          episodeNos: [1]
        }),
        buildRecord({
          id: "asset-map-current-package",
          assetName: "Mine Map",
          assetType: "prop",
          deliveryPackageId: "delivery-current",
          episodeNos: [1]
        })
      ],
      deliveryPackageEpisodes: [buildPackageEpisode(2, "Mine Map is unfolded.")],
      episodes,
      assignments
    });

    expect(projection.tracks.flatMap((track) => track.clips)[0]?.ghost).toBeUndefined();
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

function buildAssignment(
  id: string,
  episodeId: string,
  userId: string,
  responsibility: EpisodeAssignment["responsibility"] = "creator"
): EpisodeAssignment {
  return {
    id,
    episodeId,
    userId,
    responsibility,
    createdAt: now
  };
}

function buildPackageEpisode(
  episodeNo: number,
  content: string,
  deliveryPackageId = "delivery-current",
  isConfirmedChange = true
): DeliveryPackageEpisode {
  return {
    id: `package-episode-${deliveryPackageId}-${episodeNo}`,
    deliveryPackageId,
    episodeNo,
    title: `第 ${episodeNo} 集`,
    content,
    isConfirmedChange
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
