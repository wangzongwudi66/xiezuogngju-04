import { describe, expect, it } from "vitest";
import { seedWorkspace } from "@aigc/domain";
import { composeDbWorkspaceSnapshotOverlay, type DbWorkspaceSnapshotOverlay } from "./workspace-snapshot";

describe("DB workspace snapshot overlay", () => {
  it("replaces publish read-model arrays from DB mode overlay", () => {
    const localState = {
      ...seedWorkspace,
      episodeRevisions: [
        {
          id: "local-revision",
          projectId: "local-project",
          episodeId: "local-episode",
          episodeNo: 1,
          deliveryPackageId: "local-package",
          revisionNo: 1,
          title: "Local revision",
          content: "Local content",
          changeSummary: "Local summary",
          createdAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      episodeCurrents: [
        {
          id: "local-current",
          projectId: "local-project",
          episodeId: "local-episode",
          currentRevisionId: "local-revision",
          updatedAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      notifications: [
        {
          id: "local-notification",
          projectId: "local-project",
          recipientId: "local-user",
          type: "system" as const,
          title: "Local notification",
          body: "Local body",
          createdAt: "2026-05-29T00:00:00.000Z"
        }
      ]
    };
    const overlay = {
      users: [],
      projects: [],
      members: [],
      memberPermissions: [],
      episodes: [],
      assignments: [],
      assetLockRecords: [],
      scriptSourceBindings: [],
      deliveryPackages: [],
      deliveryPackageEpisodes: [],
      episodeRevisions: [
        {
          id: "db-revision",
          projectId: "project-jincheng",
          episodeId: "episode-jc-1",
          episodeNo: 1,
          deliveryPackageId: "delivery-published",
          revisionNo: 2,
          title: "DB revision",
          content: "DB content",
          previousRevisionId: "db-revision-previous",
          changeSummary: "DB summary",
          createdAt: "2026-05-29T02:00:00.000Z"
        }
      ],
      episodeCurrents: [
        {
          id: "db-current",
          projectId: "project-jincheng",
          episodeId: "episode-jc-1",
          currentRevisionId: "db-revision",
          updatedAt: "2026-05-29T02:00:00.000Z"
        }
      ],
      notifications: []
    } satisfies DbWorkspaceSnapshotOverlay;

    const state = composeDbWorkspaceSnapshotOverlay(localState, overlay);

    expect(state.episodeRevisions).toEqual(overlay.episodeRevisions);
    expect(state.episodeCurrents).toEqual(overlay.episodeCurrents);
    expect(state.notifications).toEqual([]);
  });
});
