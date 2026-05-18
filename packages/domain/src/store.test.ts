import { describe, expect, it } from "vitest";
import { seedWorkspace } from "./seed";
import {
  archiveProject,
  assignEpisodes,
  createProject,
  loginAsUser,
  markNotificationRead,
  registerUser,
  saveProjectMemberRoles,
  selectMyEpisodes,
  selectPermissions,
  selectPrimaryRole,
  selectProjectMembers,
  selectProjectOverview,
  selectUnreadNotifications,
  updateProject,
  updateProjectMemberPermissions,
  upsertProjectMember
} from "./store";

describe("M1 workspace store", () => {
  it("registers and logs in users with a selected role", () => {
    const registered = registerUser(seedWorkspace, {
      name: "linyu",
      role: "creator"
    });
    const user = registered.users.find((item) => item.name === "linyu");

    expect(user?.defaultRole).toBe("creator");
    expect(registered.currentUserId).toBe(user?.id);

    const loggedIn = loginAsUser(registered, "user-owner");
    expect(loggedIn.currentUserId).toBe("user-owner");
  });

  it("creates a project with the requested episode skeleton", () => {
    const state = createProject(seedWorkspace, {
      name: "星港试播",
      code: "XG",
      episodeCount: 12
    });

    const project = state.projects.find((item) => item.code === "XG");
    expect(project).toBeDefined();
    expect(state.episodes.filter((episode) => episode.projectId === project?.id)).toHaveLength(12);
  });

  it("updates and archives a project without deleting its episodes", () => {
    const updated = updateProject(seedWorkspace, "project-jincheng", { name: "金城矿山 第二版" });
    const archived = archiveProject(updated, "project-jincheng");

    expect(archived.projects.find((item) => item.id === "project-jincheng")?.name).toBe("金城矿山 第二版");
    expect(archived.projects.find((item) => item.id === "project-jincheng")?.status).toBe("archived");
    expect(archived.episodes.filter((episode) => episode.projectId === "project-jincheng")).toHaveLength(60);
  });

  it("upserts a member role without mixing in episode ranges", () => {
    const state = upsertProjectMember(seedWorkspace, {
      projectId: "project-jincheng",
      userId: "user-writer",
      role: "creator"
    });

    const member = state.members.find(
      (item) => item.projectId === "project-jincheng" && item.userId === "user-writer" && item.role === "creator"
    );

    expect(member).toBeDefined();
    expect(selectProjectMembers(state, "project-jincheng").some((item) => item.userName === "周编剧")).toBe(true);
  });

  it("saves multiple roles for one member and applies custom permissions", () => {
    const withRoles = saveProjectMemberRoles(seedWorkspace, {
      projectId: "project-jincheng",
      userId: "user-creator-a",
      roles: ["creator", "writer"]
    });
    const withPermissions = updateProjectMemberPermissions(withRoles, {
      projectId: "project-jincheng",
      userId: "user-creator-a",
      permissions: ["canViewAssignedEpisodes", "canAssignEpisodes"]
    });
    const member = selectProjectMembers(withPermissions, "project-jincheng").find((item) => item.userId === "user-creator-a");
    const permissions = selectPermissions(withPermissions, "user-creator-a", "project-jincheng");

    expect(member?.roles).toEqual(["writer", "creator"]);
    expect(member?.hasCustomPermissions).toBe(true);
    expect(permissions.canAssignEpisodes).toBe(true);
    expect(permissions.canSubmitWriting).toBe(false);
  });

  it("assigns an episode range and returns it in My Episodes", () => {
    const state = assignEpisodes(seedWorkspace, {
      projectId: "project-jincheng",
      userId: "user-creator-a",
      episodeFrom: 17,
      episodeTo: 18,
      responsibility: "creator"
    });

    const myEpisodes = selectMyEpisodes(state, "user-creator-a");
    expect(myEpisodes.some((episode) => episode.projectCode === "JC" && episode.episodeNo === 17)).toBe(true);
    expect(myEpisodes.some((episode) => episode.projectCode === "JC" && episode.episodeNo === 18)).toBe(true);
  });

  it("requires project membership before assigning episode work", () => {
    const state = registerUser(seedWorkspace, {
      name: "newcomer",
      role: "creator"
    });

    expect(() =>
      assignEpisodes(state, {
        projectId: "project-jincheng",
        userId: state.currentUserId ?? "",
        episodeFrom: 1,
        episodeTo: 2,
        responsibility: "creator"
      })
    ).toThrow("请先把该用户添加为项目成员");
  });

  it("builds project overview status lights with assignees", () => {
    const overview = selectProjectOverview(seedWorkspace, "project-jincheng");
    const episodeThree = overview.episodes.find((episode) => episode.episodeNo === 3);

    expect(overview.memberCount).toBeGreaterThanOrEqual(5);
    expect(episodeThree?.productionStatus).toBe("key_update");
    expect(episodeThree?.assignments.some((assignment) => assignment.userName === "周编剧")).toBe(true);
    expect(episodeThree?.assignments.some((assignment) => assignment.userName === "沈制作 A")).toBe(true);
  });

  it("tracks unread notifications and marks a notification as read", () => {
    const unread = selectUnreadNotifications(seedWorkspace, "user-creator-a");
    const next = markNotificationRead(seedWorkspace, unread[0].id);

    expect(unread).toHaveLength(2);
    expect(selectUnreadNotifications(next, "user-creator-a")).toHaveLength(1);
  });

  it("separates coordinator and creator permissions", () => {
    expect(selectPrimaryRole(seedWorkspace, "user-owner", "project-jincheng")).toBe("coordinator");
    expect(selectPermissions(seedWorkspace, "user-owner", "project-jincheng").canManageProjects).toBe(true);

    const creatorPermissions = selectPermissions(seedWorkspace, "user-creator-a", "project-jincheng");
    expect(creatorPermissions.homeView).toBe("creator");
    expect(creatorPermissions.canManageProjects).toBe(false);
    expect(creatorPermissions.canAssignEpisodes).toBe(false);
  });
});
