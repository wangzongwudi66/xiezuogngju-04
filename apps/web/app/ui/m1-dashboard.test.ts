import { describe, expect, it } from "vitest";
import { registerUser, seedWorkspace, selectMyEpisodes } from "@aigc/domain";
import { buildTodayTasks } from "./dashboard-tasks";

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
});
