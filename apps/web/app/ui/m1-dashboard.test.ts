import { describe, expect, it } from "vitest";
import { registerUser, seedWorkspace, selectMyEpisodes } from "@aigc/domain";
import { buildTodayTasks } from "./dashboard-tasks";
import { canRetryDeliveryImportJob, formatDeliveryImportError } from "./delivery-import-feedback";
import {
  canAccessAssetWorkflowRole,
  canAccessDeliveryRole,
  canCreateDeliveryRole,
  canReviewDeliveryRole,
  canSubmitDeliveryRole,
  filterProjectItems,
  selectAssetTimelineDeliveryPackageId,
  selectDefaultDeliveryPackageId,
  selectRealAssetTimelineDeliveryPackageId
} from "./delivery-role-view";
import { filterAssetChanges, getMockAssetChanges, getNextAssetLockOwner, summarizeAssetLock } from "./asset-lock-workbench-data";

describe("M1 dashboard task list", () => {
  it("does not invent today tasks when a creator has no assigned episodes", () => {
    const state = registerUser(seedWorkspace, {
      name: "linyu-empty",
      role: "creator"
    });
    const userId = state.users.find((user) => user.name === "linyu-empty")?.id ?? "";
    const myEpisodes = selectMyEpisodes(state, userId);

    expect(myEpisodes).toHaveLength(0);
    expect(buildTodayTasks(myEpisodes)).toEqual([]);
  });

  it("builds today tasks only from assigned episodes", () => {
    const tasks = buildTodayTasks(selectMyEpisodes(seedWorkspace, "user-creator-a"));

    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((task) => task.title.includes("金城矿山") || task.title.includes("潮汐档案"))).toBe(true);
    expect(tasks.some((task) => task.title.includes("第 27 集"))).toBe(false);
  });

  it("filters assigned episodes to the current project before building role home tasks", () => {
    const allEpisodes = selectMyEpisodes(seedWorkspace, "user-creator-a");
    const jinchengEpisodes = filterProjectItems(allEpisodes, "project-jincheng");
    const tideEpisodes = filterProjectItems(allEpisodes, "project-tide");

    expect(jinchengEpisodes.every((episode) => episode.projectId === "project-jincheng")).toBe(true);
    expect(tideEpisodes.every((episode) => episode.projectId === "project-tide")).toBe(true);
    expect(buildTodayTasks(jinchengEpisodes).every((task) => task.title.includes("金城矿山"))).toBe(true);
    expect(buildTodayTasks(tideEpisodes).every((task) => task.title.includes("潮汐档案"))).toBe(true);
  });
});

describe("coordinator delivery role view", () => {
  it("keeps coordinator in review flow instead of submit flow", () => {
    expect(canReviewDeliveryRole("coordinator")).toBe(true);
    expect(canAccessDeliveryRole("coordinator")).toBe(true);
    expect(canCreateDeliveryRole("coordinator")).toBe(true);
    expect(canSubmitDeliveryRole("coordinator")).toBe(false);

    expect(canReviewDeliveryRole("head_writer")).toBe(false);
    expect(canAccessDeliveryRole("head_writer")).toBe(true);
    expect(canCreateDeliveryRole("head_writer")).toBe(true);
    expect(canSubmitDeliveryRole("head_writer")).toBe(true);

    expect(canAccessDeliveryRole("writer")).toBe(true);
    expect(canCreateDeliveryRole("writer")).toBe(false);
    expect(canSubmitDeliveryRole("writer")).toBe(false);

    expect(canAccessDeliveryRole("creator")).toBe(false);
    expect(canAccessAssetWorkflowRole("creator")).toBe(true);
    expect(canAccessAssetWorkflowRole("writer")).toBe(true);
  });

  it("allows reviewers to create import drafts even when they cannot submit as head writer", () => {
    expect(canCreateDeliveryRole("coordinator")).toBe(true);
    expect(canSubmitDeliveryRole("coordinator")).toBe(false);
    expect(canCreateDeliveryRole("owner")).toBe(true);
    expect(canSubmitDeliveryRole("owner")).toBe(false);
  });

  it("defaults coordinators to pending delivery packages first", () => {
    const packages = [
      { id: "draft-package", status: "draft" as const },
      { id: "pending-package", status: "pending_review" as const },
      { id: "published-package", status: "published" as const }
    ];

    expect(selectDefaultDeliveryPackageId(packages, "coordinator", null)).toBe("pending-package");
    expect(selectDefaultDeliveryPackageId(packages, "head_writer", null)).toBe("draft-package");
    expect(selectDefaultDeliveryPackageId(packages, "coordinator", "published-package")).toBe("published-package");
  });

  it("selects the latest published package for the asset timeline independently from the active delivery package", () => {
    const packages = [
      { id: "draft-package", status: "draft" as const, createdAt: "2026-05-24T00:00:00.000Z" },
      { id: "pending-package", status: "pending_review" as const, createdAt: "2026-05-25T00:00:00.000Z" },
      {
        id: "older-published-package",
        status: "published" as const,
        createdAt: "2026-05-20T00:00:00.000Z",
        publishedAt: "2026-05-21T00:00:00.000Z"
      },
      {
        id: "latest-published-package",
        status: "published" as const,
        createdAt: "2026-05-22T00:00:00.000Z",
        publishedAt: "2026-05-23T00:00:00.000Z"
      }
    ];

    expect(selectDefaultDeliveryPackageId(packages, "coordinator", null)).toBe("pending-package");
    expect(selectAssetTimelineDeliveryPackageId(packages)).toBe("latest-published-package");
  });

  it("selects only server-known published packages for the real asset timeline request", () => {
    const packages = [
      {
        id: "local-prototype-published",
        status: "published" as const,
        createdAt: "2026-05-24T10:00:00.000Z",
        publishedAt: "2026-05-24T10:00:00.000Z"
      },
      {
        id: "server-published",
        status: "published" as const,
        createdAt: "2026-05-23T10:00:00.000Z",
        publishedAt: "2026-05-23T10:00:00.000Z"
      }
    ];

    expect(selectAssetTimelineDeliveryPackageId(packages, ["server-published"])).toBe("server-published");
    expect(selectAssetTimelineDeliveryPackageId(packages, [])).toBeUndefined();
  });

  it("gates the real asset timeline package on workspace session sync", () => {
    const packages = [
      {
        id: "local-prototype-published",
        status: "published" as const,
        createdAt: "2026-05-24T10:00:00.000Z",
        publishedAt: "2026-05-24T10:00:00.000Z"
      },
      {
        id: "server-published",
        status: "published" as const,
        createdAt: "2026-05-23T10:00:00.000Z",
        publishedAt: "2026-05-23T10:00:00.000Z"
      }
    ];

    expect(
      selectRealAssetTimelineDeliveryPackageId({
        deliveryPackages: packages,
        serverDeliveryPackageIds: ["server-published"],
        sessionReady: false
      })
    ).toBeUndefined();
    expect(
      selectRealAssetTimelineDeliveryPackageId({
        deliveryPackages: packages,
        serverDeliveryPackageIds: ["server-published"],
        sessionReady: true
      })
    ).toBe("server-published");
  });
});

describe("delivery import retry affordance", () => {
  it("only allows retry for failed Word jobs with a saved file id", () => {
    expect(
      canRetryDeliveryImportJob({
        id: "job-docx-failed",
        projectId: "project-jincheng",
        source: "docx",
        status: "failed",
        fileName: "failed.docx",
        fileId: "file-1",
        declaredRangeText: "1-2",
        createdAt: "2026-05-21T00:00:00.000Z"
      })
    ).toBe(true);
    expect(
      canRetryDeliveryImportJob({
        id: "job-docx-success",
        projectId: "project-jincheng",
        source: "docx",
        status: "success",
        fileName: "success.docx",
        fileId: "file-2",
        declaredRangeText: "1-2",
        createdAt: "2026-05-21T00:00:00.000Z"
      })
    ).toBe(false);
    expect(
      canRetryDeliveryImportJob({
        id: "job-text-failed",
        projectId: "project-jincheng",
        source: "text",
        status: "failed",
        fileName: "pasted.txt",
        declaredRangeText: "1-2",
        createdAt: "2026-05-21T00:00:00.000Z"
      })
    ).toBe(false);
    expect(
      canRetryDeliveryImportJob({
        id: "job-docx-no-file",
        projectId: "project-jincheng",
        source: "docx",
        status: "failed",
        fileName: "missing.docx",
        declaredRangeText: "1-2",
        createdAt: "2026-05-21T00:00:00.000Z"
      })
    ).toBe(false);
  });

  it("maps retry backend errors to customer-facing Chinese copy", () => {
    expect(formatDeliveryImportError(new Error("delivery_import_job_not_found"))).toBe("原解析记录不存在，请刷新后重试。");
    expect(formatDeliveryImportError(new Error("delivery_import_job_file_id_missing"))).toBe("这条记录没有可重试文件，请重新上传 Word。");
    expect(formatDeliveryImportError(new Error("delivery_import_job_file_missing"))).toBe("原始 Word 文件已丢失，请重新上传。");
  });
});

describe("asset lock workbench model", () => {
  it("summarizes pending confirmations and blockers", () => {
    const summary = summarizeAssetLock(getMockAssetChanges());

    expect(summary.totalCount).toBeGreaterThan(0);
    expect(summary.writerPendingCount).toBeGreaterThan(0);
    expect(summary.productionPendingCount).toBeGreaterThan(0);
    expect(summary.disputeCount).toBeGreaterThan(0);
    expect(summary.canLock).toBe(false);
  });

  it("filters asset changes by episode, type, status, owner, and risk", () => {
    const items = getMockAssetChanges();
    const filtered = filterAssetChanges(items, {
      episode: "5",
      owner: "沈制作 A",
      risk: "high",
      status: "disputed",
      type: "effect"
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].assetName).toBe("井底粉尘爆闪");
  });

  it("prioritizes disputed items before final lock", () => {
    expect(getNextAssetLockOwner(getMockAssetChanges())).toBe("统筹协调争议项");
  });
});
