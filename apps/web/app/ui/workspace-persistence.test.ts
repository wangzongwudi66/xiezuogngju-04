import { describe, expect, it } from "vitest";
import { seedWorkspace } from "@aigc/domain";
import type { M2WorkspacePersistenceSnapshot } from "./workspace-persistence";
import { decodeM2WorkspacePersistence, encodeM2WorkspacePersistence } from "./workspace-persistence";

describe("M2 workspace persistence", () => {
  it("round-trips workspace state and parse issues", () => {
    const snapshot: M2WorkspacePersistenceSnapshot = {
      state: seedWorkspace,
      deliveryImportJobs: [
        {
          id: "job-001",
          projectId: "project-jincheng",
          source: "docx",
          status: "success",
          fileName: "delivery-1-2.docx",
          declaredRangeText: "1-2",
          createdAt: "2026-05-20T12:00:00.000Z",
          completedAt: "2026-05-20T12:00:01.000Z",
          deliveryPackageId: "delivery-001",
          issueCount: 1
        }
      ],
      selectedProjectId: "project-tide",
      deliveryParseIssuesByPackageId: {
        "delivery-001": [
          {
            code: "scene_heading_format",
            severity: "warning",
            episodeNo: 1,
            message: "Scene heading may need review."
          }
        ]
      }
    };

    expect(decodeM2WorkspacePersistence(encodeM2WorkspacePersistence(snapshot))).toEqual(snapshot);
  });

  it("defaults missing import jobs from older snapshots", () => {
    const decoded = decodeM2WorkspacePersistence(
      JSON.stringify({
        version: 1,
        state: seedWorkspace,
        deliveryParseIssuesByPackageId: {}
      })
    );

    expect(decoded?.deliveryImportJobs).toEqual([]);
    expect(decoded?.selectedProjectId).toBeUndefined();
  });

  it("ignores stale or invalid stored snapshots", () => {
    expect(decodeM2WorkspacePersistence(null)).toBeNull();
    expect(decodeM2WorkspacePersistence("not-json")).toBeNull();
    expect(decodeM2WorkspacePersistence(JSON.stringify({ version: 0, state: seedWorkspace }))).toBeNull();
  });
});
