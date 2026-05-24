import { describe, expect, it } from "vitest";
import type {
  AssetLockRecord,
  DeliveryPackage,
  DeliveryPackageEpisode,
  Episode,
  EpisodeAssignment,
  Project,
  ProjectMember,
  ScriptSourceBinding,
  User,
  WorkspaceState
} from "@aigc/domain";
import { buildAssetDecisionTimelineProjectionFromWorkspace } from "./service";

const now = "2026-05-24T00:00:00.000Z";

describe("asset decision timeline service", () => {
  it("builds a read-only projection from workspace state for the current member", () => {
    const state = buildWorkspace({
      currentUserId: "user-coordinator",
      members: [buildMember("user-coordinator", "coordinator")],
      deliveryPackages: [buildPackage("delivery-current", "project-jincheng", "published")],
      deliveryPackageEpisodes: [buildPackageEpisode(1, "Mine Lift appears.")],
      assetLockRecords: [buildRecord({ id: "asset-lift", assetName: "Mine Lift", episodeNos: [1] })]
    });

    const result = buildAssetDecisionTimelineProjectionFromWorkspace(state, {
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current"
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        viewerUserId: "user-coordinator",
        viewerRole: "coordinator",
        decisionQueue: [expect.objectContaining({ assetLockRecordId: "asset-lift" })],
        sourceExcerpts: [expect.objectContaining({ relatedAssetNames: ["Mine Lift"] })]
      }
    });
  });

  it("passes explicit source bindings into the projection before fallback matching", () => {
    const state = buildWorkspace({
      currentUserId: "user-coordinator",
      members: [buildMember("user-coordinator", "coordinator")],
      deliveryPackages: [buildPackage("delivery-current", "project-jincheng", "published")],
      deliveryPackageEpisodes: [buildPackageEpisode(2, "Mine Map fallback line.\nMine Map second fallback.")],
      assetLockRecords: [buildRecord({ id: "asset-map", assetName: "Mine Map", assetType: "prop", episodeNos: [2] })],
      scriptSourceBindings: [
        buildSourceBinding({
          id: "binding-map",
          assetLockRecordId: "asset-map",
          episodeNo: 2,
          startLine: 2,
          endLine: 2,
          excerptSnapshot: "  Bound source line  "
        })
      ]
    });

    const result = buildAssetDecisionTimelineProjectionFromWorkspace(state, {
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current"
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        sourceExcerpts: [
          expect.objectContaining({
            id: "source-binding-binding-map",
            excerpt: "  Bound source line  ",
            relatedAssetNames: ["Mine Map"]
          })
        ],
        decisionQueue: [expect.objectContaining({ sourceExcerptIds: ["source-binding-binding-map"] })]
      }
    });
  });

  it("rejects unauthenticated users, non-members, and wrong-project packages", () => {
    const publishedPackage = buildPackage("delivery-current", "project-jincheng", "published");
    const baseState = buildWorkspace({
      currentUserId: null,
      members: [buildMember("user-coordinator", "coordinator")],
      deliveryPackages: [publishedPackage]
    });

    expect(
      buildAssetDecisionTimelineProjectionFromWorkspace(baseState, {
        projectId: "project-jincheng",
        deliveryPackageId: "delivery-current"
      })
    ).toEqual({ ok: false, error: "unauthenticated" });
    expect(
      buildAssetDecisionTimelineProjectionFromWorkspace(
        {
          ...baseState,
          currentUserId: "user-outsider"
        },
        {
          projectId: "project-jincheng",
          deliveryPackageId: "delivery-current"
        }
      )
    ).toEqual({ ok: false, error: "project_member_required" });
    expect(
      buildAssetDecisionTimelineProjectionFromWorkspace(
        {
          ...baseState,
          currentUserId: "user-coordinator",
          deliveryPackages: [buildPackage("delivery-current", "project-tide", "published")]
        },
        {
          projectId: "project-jincheng",
          deliveryPackageId: "delivery-current"
        }
      )
    ).toEqual({ ok: false, error: "delivery_package_project_mismatch" });
  });

  it("requires published current and previous packages", () => {
    const state = buildWorkspace({
      currentUserId: "user-coordinator",
      members: [buildMember("user-coordinator", "coordinator")],
      deliveryPackages: [
        buildPackage("delivery-current", "project-jincheng", "draft"),
        buildPackage("delivery-previous", "project-jincheng", "draft")
      ]
    });

    expect(
      buildAssetDecisionTimelineProjectionFromWorkspace(state, {
        projectId: "project-jincheng",
        deliveryPackageId: "delivery-current"
      })
    ).toEqual({ ok: false, error: "delivery_package_not_published" });
    expect(
      buildAssetDecisionTimelineProjectionFromWorkspace(
        {
          ...state,
          deliveryPackages: [
            buildPackage("delivery-current", "project-jincheng", "published"),
            buildPackage("delivery-previous", "project-jincheng", "draft")
          ]
        },
        {
          projectId: "project-jincheng",
          deliveryPackageId: "delivery-current",
          previousDeliveryPackageId: "delivery-previous"
        }
      )
    ).toEqual({ ok: false, error: "previous_delivery_package_not_published" });
  });

  it("uses the primary project role when a user has multiple roles", () => {
    const state = buildWorkspace({
      currentUserId: "user-multi",
      members: [buildMember("user-multi", "creator"), buildMember("user-multi", "head_writer")],
      deliveryPackages: [buildPackage("delivery-current", "project-jincheng", "published")],
      deliveryPackageEpisodes: [buildPackageEpisode(1, "Mine Lift appears."), buildPackageEpisode(2, "Mine Map appears.")],
      assetLockRecords: [
        buildRecord({ id: "asset-lift", assetName: "Mine Lift", episodeNos: [1] }),
        buildRecord({ id: "asset-map", assetName: "Mine Map", assetType: "prop", episodeNos: [2] })
      ]
    });

    const result = buildAssetDecisionTimelineProjectionFromWorkspace(state, {
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current"
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        viewerRole: "head_writer",
        decisionQueue: [
          expect.objectContaining({ assetLockRecordId: "asset-lift" }),
          expect.objectContaining({ assetLockRecordId: "asset-map" })
        ]
      }
    });
  });

  it("does not generate previous ghosts unless an explicit earlier previous package is provided", () => {
    const state = buildWorkspace({
      currentUserId: "user-coordinator",
      members: [buildMember("user-coordinator", "coordinator")],
      deliveryPackages: [
        buildPackage("delivery-current", "project-jincheng", "published", "2026-05-24T12:00:00.000Z"),
        buildPackage("delivery-previous", "project-jincheng", "published", "2026-05-23T12:00:00.000Z"),
        buildPackage("delivery-later", "project-jincheng", "published", "2026-05-25T12:00:00.000Z")
      ],
      deliveryPackageEpisodes: [buildPackageEpisode(2, "Mine Map is unfolded.")],
      assetLockRecords: [
        buildRecord({ id: "asset-map", assetName: "Mine Map", assetType: "prop", episodeNos: [2] }),
        buildRecord({
          id: "asset-map-prev",
          assetName: "Mine Map",
          assetType: "prop",
          deliveryPackageId: "delivery-previous",
          episodeNos: [1]
        }),
        buildRecord({
          id: "asset-map-later",
          assetName: "Mine Map",
          assetType: "prop",
          deliveryPackageId: "delivery-later",
          episodeNos: [9]
        })
      ]
    });
    const withoutPrevious = buildAssetDecisionTimelineProjectionFromWorkspace(state, {
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current"
    });
    const withPrevious = buildAssetDecisionTimelineProjectionFromWorkspace(state, {
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current",
      previousDeliveryPackageId: "delivery-previous"
    });
    const withLaterPrevious = buildAssetDecisionTimelineProjectionFromWorkspace(state, {
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current",
      previousDeliveryPackageId: "delivery-later"
    });

    expect(withoutPrevious).toMatchObject({ ok: true });
    if (withoutPrevious.ok) {
      expect(withoutPrevious.projection.tracks.flatMap((track) => track.clips)[0]?.ghost).toBeUndefined();
    }
    expect(withPrevious).toMatchObject({ ok: true });
    if (withPrevious.ok) {
      expect(withPrevious.projection.tracks.flatMap((track) => track.clips)[0]?.ghost).toEqual(
        expect.objectContaining({
          previousDeliveryPackageId: "delivery-previous",
          previousEpisodeFrom: 1
        })
      );
    }
    expect(withLaterPrevious).toEqual({ ok: false, error: "previous_delivery_package_not_before_current" });
  });

  it("keeps creator projection limited to assigned episodes", () => {
    const state = buildWorkspace({
      currentUserId: "user-creator",
      members: [buildMember("user-creator", "creator")],
      deliveryPackages: [buildPackage("delivery-current", "project-jincheng", "published")],
      deliveryPackageEpisodes: [buildPackageEpisode(1, "Mine Lift appears."), buildPackageEpisode(2, "Mine Map appears.")],
      episodes: [buildEpisode(1), buildEpisode(2)],
      assignments: [buildAssignment("assignment-2", "episode-project-jincheng-2", "user-creator", "creator")],
      assetLockRecords: [
        buildRecord({ id: "asset-lift", assetName: "Mine Lift", episodeNos: [1] }),
        buildRecord({ id: "asset-map", assetName: "Mine Map", assetType: "prop", episodeNos: [2] })
      ]
    });

    const result = buildAssetDecisionTimelineProjectionFromWorkspace(state, {
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current"
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        decisionQueue: [expect.objectContaining({ assetLockRecordId: "asset-map" })],
        sourceExcerpts: [expect.objectContaining({ episodeNo: 2 })]
      }
    });

    if (!result.ok) {
      return;
    }

    expect(result.projection.tracks.flatMap((track) => track.clips).map((clip) => clip.assetLockRecordId)).toEqual(["asset-map"]);
  });

  it("keeps creator explicit source bindings limited to assigned episodes", () => {
    const state = buildWorkspace({
      currentUserId: "user-creator",
      members: [buildMember("user-creator", "creator")],
      deliveryPackages: [buildPackage("delivery-current", "project-jincheng", "published")],
      deliveryPackageEpisodes: [buildPackageEpisode(1, "Mine Map hidden line."), buildPackageEpisode(2, "Mine Map visible line.")],
      episodes: [buildEpisode(1), buildEpisode(2)],
      assignments: [buildAssignment("assignment-2", "episode-project-jincheng-2", "user-creator", "lead_creator")],
      assetLockRecords: [buildRecord({ id: "asset-map", assetName: "Mine Map", assetType: "prop", episodeNos: [1, 2] })],
      scriptSourceBindings: [
        buildSourceBinding({ id: "binding-hidden", assetLockRecordId: "asset-map", episodeNo: 1, excerptSnapshot: "Hidden source" }),
        buildSourceBinding({ id: "binding-visible", assetLockRecordId: "asset-map", episodeNo: 2, excerptSnapshot: "Visible source" })
      ]
    });

    const result = buildAssetDecisionTimelineProjectionFromWorkspace(state, {
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current"
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        sourceExcerpts: [expect.objectContaining({ id: "source-binding-binding-visible", excerpt: "Visible source" })],
        decisionQueue: [expect.objectContaining({ sourceExcerptIds: ["source-binding-binding-visible"] })]
      }
    });
  });

  it("keeps writer explicit source bindings limited to writer assignments", () => {
    const state = buildWorkspace({
      currentUserId: "user-writer",
      members: [buildMember("user-writer", "writer")],
      deliveryPackages: [buildPackage("delivery-current", "project-jincheng", "published")],
      deliveryPackageEpisodes: [
        buildPackageEpisode(2, "Support Asset source should stay hidden."),
        buildPackageEpisode(3, "Writer Asset source is visible.")
      ],
      episodes: [buildEpisode(2), buildEpisode(3)],
      assignments: [
        buildAssignment("assignment-support-2", "episode-project-jincheng-2", "user-writer", "support"),
        buildAssignment("assignment-writer-3", "episode-project-jincheng-3", "user-writer", "writer")
      ],
      assetLockRecords: [
        buildRecord({ id: "asset-support", assetName: "Support Asset", assetType: "prop", episodeNos: [2] }),
        buildRecord({ id: "asset-writer", assetName: "Writer Asset", assetType: "scene", episodeNos: [3] })
      ],
      scriptSourceBindings: [
        buildSourceBinding({
          id: "binding-support",
          assetLockRecordId: "asset-support",
          episodeNo: 2,
          excerptSnapshot: "Support source"
        }),
        buildSourceBinding({
          id: "binding-writer",
          assetLockRecordId: "asset-writer",
          episodeNo: 3,
          excerptSnapshot: "Writer source"
        })
      ]
    });

    const result = buildAssetDecisionTimelineProjectionFromWorkspace(state, {
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current"
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        decisionQueue: [expect.objectContaining({ assetLockRecordId: "asset-writer", sourceExcerptIds: ["source-binding-binding-writer"] })],
        sourceExcerpts: [expect.objectContaining({ id: "source-binding-binding-writer", excerpt: "Writer source" })]
      }
    });
  });

  it("ignores dirty persisted source bindings before returning projection excerpts", () => {
    const state = buildWorkspace({
      currentUserId: "user-coordinator",
      members: [buildMember("user-coordinator", "coordinator")],
      deliveryPackages: [buildPackage("delivery-current", "project-jincheng", "published")],
      deliveryPackageEpisodes: [
        buildPackageEpisode(2, "Mine Map valid fallback line."),
        buildPackageEpisode(3, "Dirty outside-record source."),
        buildPackageEpisode(4, "Dirty unconfirmed source.", "delivery-current", false)
      ],
      assetLockRecords: [buildRecord({ id: "asset-map", assetName: "Mine Map", assetType: "prop", episodeNos: [2] })],
      scriptSourceBindings: [
        buildSourceBinding({ id: "binding-cross-project", projectId: "project-tide", assetLockRecordId: "asset-map", episodeNo: 2 }),
        buildSourceBinding({ id: "binding-cross-package", deliveryPackageId: "delivery-other", assetLockRecordId: "asset-map", episodeNo: 2 }),
        buildSourceBinding({ id: "binding-wrong-record", assetLockRecordId: "asset-missing", episodeNo: 2 }),
        buildSourceBinding({ id: "binding-unconfirmed", assetLockRecordId: "asset-map", episodeNo: 4 }),
        buildSourceBinding({ id: "binding-outside-record", assetLockRecordId: "asset-map", episodeNo: 3 })
      ]
    });

    const result = buildAssetDecisionTimelineProjectionFromWorkspace(state, {
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-current"
    });

    expect(result).toMatchObject({
      ok: true,
      projection: {
        sourceExcerpts: [expect.objectContaining({ id: "delivery-current-ep2-line1", excerpt: "Mine Map valid fallback line." })],
        decisionQueue: [expect.objectContaining({ sourceExcerptIds: ["delivery-current-ep2-line1"] })]
      }
    });
  });
});

function buildWorkspace(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    currentUserId: "user-coordinator",
    users: [
      buildUser("user-coordinator", "coordinator"),
      buildUser("user-creator", "creator"),
      buildUser("user-writer", "writer"),
      buildUser("user-multi", "creator")
    ],
    projects: [buildProject("project-jincheng"), buildProject("project-tide")],
    members: [buildMember("user-coordinator", "coordinator")],
    memberPermissions: [],
    episodes: [buildEpisode(1), buildEpisode(2)],
    assignments: [],
    assetLockRecords: [],
    assetAttachments: [],
    deliveryPackages: [],
    deliveryPackageEpisodes: [],
    episodeRevisions: [],
    episodeCurrents: [],
    notifications: [],
    ...overrides
  };
}

function buildUser(id: string, defaultRole: User["defaultRole"]): User {
  return {
    id,
    name: id,
    defaultRole,
    avatarTone: "blue"
  };
}

function buildProject(id: string): Project {
  return {
    id,
    name: id,
    code: id,
    episodeCount: 24,
    status: "active",
    createdAt: now
  };
}

function buildMember(userId: string, role: ProjectMember["role"], projectId = "project-jincheng"): ProjectMember {
  return {
    id: `member-${projectId}-${userId}`,
    projectId,
    userId,
    role,
    createdAt: now
  };
}

function buildEpisode(episodeNo: number, projectId = "project-jincheng"): Episode {
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
  responsibility: EpisodeAssignment["responsibility"]
): EpisodeAssignment {
  return {
    id,
    episodeId,
    userId,
    responsibility,
    createdAt: now
  };
}

function buildPackage(
  id: string,
  projectId: string,
  status: DeliveryPackage["status"],
  publishedAt = status === "published" ? now : undefined
): DeliveryPackage {
  return {
    id,
    projectId,
    type: "range",
    title: id,
    declaredEpisodeFrom: 1,
    declaredEpisodeTo: 2,
    status,
    uploadedByUserId: "user-head-writer",
    createdAt: now,
    publishedAt
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

function buildSourceBinding(overrides: Partial<ScriptSourceBinding>): ScriptSourceBinding {
  return {
    id: "binding-source",
    projectId: "project-jincheng",
    deliveryPackageId: "delivery-current",
    assetLockRecordId: "asset-record",
    episodeNo: 1,
    startLine: 1,
    endLine: 1,
    excerptSnapshot: "Bound source line",
    createdByUserId: "user-writer",
    createdAt: now,
    ...overrides
  };
}

function buildRecord(overrides: Partial<AssetLockRecord>): AssetLockRecord {
  return {
    id: "asset-record",
    projectId: "project-jincheng",
    deliveryPackageId: "delivery-current",
    episodeNos: [1],
    assetName: "Mine Lift",
    assetType: "scene",
    changeType: "modified",
    writerConfirmation: "confirmed",
    productionConfirmation: "confirmed",
    risk: "normal",
    status: "draft",
    createdByUserId: "user-coordinator",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}
