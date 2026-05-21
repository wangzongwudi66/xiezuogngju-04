import { describe, expect, it } from "vitest";
import { registerUser, seedWorkspace, selectMyEpisodes } from "@aigc/domain";
import { buildTodayTasks } from "./dashboard-tasks";
import {
  canAccessDeliveryRole,
  canCreateDeliveryRole,
  canReviewDeliveryRole,
  canSubmitDeliveryRole,
  filterProjectItems,
  selectDefaultDeliveryPackageId
} from "./delivery-role-view";

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
});
