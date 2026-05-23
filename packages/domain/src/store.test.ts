import { describe, expect, it } from "vitest";
import { seedWorkspace } from "./seed";
import {
  archiveProject,
  assignEpisodes,
  confirmAssetLockRecordByProduction,
  confirmAssetLockRecordByWriter,
  createAssetAttachmentMetadata,
  createDeliveryPackageDraft,
  createAssetLockRecord,
  createProject,
  finalLockAssetRecord,
  listAssetAttachmentsForRecord,
  loginAsUser,
  markAssetLockRecordNeedsInfo,
  markNotificationRead,
  publishDeliveryPackage,
  registerUser,
  rejectDeliveryPackage,
  saveProjectMemberRoles,
  selectDeliveryPackageDetail,
  selectEpisodeScriptTimeline,
  selectMyEpisodes,
  selectMyProjects,
  selectPermissions,
  selectPrimaryRole,
  selectProjectMembers,
  selectProjectOverview,
  selectUnreadNotifications,
  softDeleteAssetAttachment,
  submitDeliveryPackageForReview,
  updateDeliveryPackageConfirmation,
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

  it("keeps project roles separate from episode work assignments", () => {
    const withNewProject = createProject(seedWorkspace, {
      name: "裂隙边境",
      code: "LX",
      episodeCount: 12
    });
    const projectId = withNewProject.projects.at(-1)?.id ?? "";
    const withMember = saveProjectMemberRoles(withNewProject, {
      projectId,
      userId: "user-writer",
      roles: ["writer"]
    });
    const assigned = assignEpisodes(withMember, {
      projectId,
      userId: "user-writer",
      episodeFrom: 3,
      episodeTo: 5,
      responsibility: "reviewer"
    });

    const projectMember = selectProjectMembers(assigned, projectId).find((member) => member.userId === "user-writer");
    const myProject = selectMyProjects(assigned, "user-writer").find((project) => project.id === projectId);
    const myEpisodes = selectMyEpisodes(assigned, "user-writer").filter((episode) => episode.projectId === projectId);

    expect(projectMember?.roles).toEqual(["writer"]);
    expect(myProject?.assignedEpisodeNos).toEqual([3, 4, 5]);
    expect(myEpisodes.map((episode) => episode.responsibility)).toEqual(["reviewer", "reviewer", "reviewer"]);
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

describe("M2 delivery package workflow", () => {
  it("creates a draft package and updates confirmed changed episodes before review", () => {
    const draft = createDeliveryPackageDraft(seedWorkspace, {
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      type: "range",
      declaredEpisodeFrom: 1,
      declaredEpisodeTo: 3,
      sourceFileName: "jc-1-3.docx",
      episodes: [
        { episodeNo: 1, content: "第 1 集\n矿山入口。" },
        { episodeNo: 2, content: "第 2 集\n主角发现线索。" },
        { episodeNo: 3, content: "第 3 集\n旧伤复发。" }
      ],
      confirmedEpisodeNos: [1, 3]
    });
    const deliveryPackage = draft.deliveryPackages.at(-1);

    expect(deliveryPackage?.status).toBe("draft");
    expect(deliveryPackage?.declaredEpisodeFrom).toBe(1);
    expect(selectDeliveryPackageDetail(draft, deliveryPackage?.id ?? "").confirmedEpisodeNos).toEqual([1, 3]);

    const updated = updateDeliveryPackageConfirmation(draft, {
      deliveryPackageId: deliveryPackage?.id ?? "",
      confirmedEpisodeNos: [2]
    });

    expect(selectDeliveryPackageDetail(updated, deliveryPackage?.id ?? "").confirmedEpisodeNos).toEqual([2]);
  });

  it("blocks delivery draft creation by non-members and unsupported project roles", () => {
    expect(() =>
      createDeliveryPackageDraft(seedWorkspace, {
        projectId: "project-tide",
        uploadedByUserId: "user-head-writer",
        type: "range",
        declaredEpisodeFrom: 1,
        declaredEpisodeTo: 1,
        episodes: [{ episodeNo: 1, content: "第 1 集\n非本项目成员上传。" }],
        confirmedEpisodeNos: [1]
      })
    ).toThrow("创建交稿包需要先成为项目成员");

    expect(() =>
      createDeliveryPackageDraft(seedWorkspace, {
        projectId: "project-jincheng",
        uploadedByUserId: "user-creator-a",
        type: "range",
        declaredEpisodeFrom: 1,
        declaredEpisodeTo: 1,
        episodes: [{ episodeNo: 1, content: "第 1 集\n创作者无权创建交稿包。" }],
        confirmedEpisodeNos: [1]
      })
    ).toThrow("创建交稿包权限不足");
  });

  it("requires project roles for delivery submit, reject, and publish transitions", () => {
    const draft = createDeliveryPackageDraft(seedWorkspace, {
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      type: "range",
      declaredEpisodeFrom: 1,
      declaredEpisodeTo: 1,
      episodes: [{ episodeNo: 1, content: "第 1 集\n权限校验版本。" }],
      confirmedEpisodeNos: [1]
    });
    const deliveryPackageId = draft.deliveryPackages.at(-1)?.id ?? "";

    expect(() => submitDeliveryPackageForReview(draft, deliveryPackageId, "user-creator-a")).toThrow("提交交稿包权限不足");

    const pending = submitDeliveryPackageForReview(draft, deliveryPackageId, "user-head-writer");

    expect(() => rejectDeliveryPackage(pending, deliveryPackageId, "user-head-writer", "需要统筹驳回")).toThrow(
      "驳回交稿包权限不足"
    );
    expect(() => publishDeliveryPackage(pending, deliveryPackageId, "user-creator-a")).toThrow("发布交稿包权限不足");
  });

  it("rejects a pending delivery package without creating episode revisions", () => {
    const draft = createDeliveryPackageDraft(seedWorkspace, {
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      type: "range",
      declaredEpisodeFrom: 1,
      declaredEpisodeTo: 1,
      episodes: [{ episodeNo: 1, content: "第 1 集\n被驳回的版本。" }],
      confirmedEpisodeNos: [1]
    });
    const deliveryPackageId = draft.deliveryPackages.at(-1)?.id ?? "";
    const pending = submitDeliveryPackageForReview(draft, deliveryPackageId, "user-head-writer");
    const rejected = rejectDeliveryPackage(pending, deliveryPackageId, "user-owner", "范围声明不清晰");

    expect(rejected.deliveryPackages.find((item) => item.id === deliveryPackageId)?.status).toBe("rejected");
    expect(rejected.episodeRevisions).toHaveLength(0);
    expect(rejected.episodeCurrents).toHaveLength(0);
  });

  it("publishes only confirmed retroactive changes and updates EpisodeCurrent", () => {
    const firstDraft = createDeliveryPackageDraft(seedWorkspace, {
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      type: "range",
      declaredEpisodeFrom: 1,
      declaredEpisodeTo: 10,
      episodes: Array.from({ length: 10 }, (_, index) => ({
        episodeNo: index + 1,
        content: `第 ${index + 1} 集\n初版内容。`
      })),
      confirmedEpisodeNos: [1, 2]
    });
    const firstPackageId = firstDraft.deliveryPackages.at(-1)?.id ?? "";
    const firstPublished = publishDeliveryPackage(
      submitDeliveryPackageForReview(firstDraft, firstPackageId, "user-head-writer"),
      firstPackageId,
      "user-owner"
    );

    expect(firstPublished.episodeRevisions.map((revision) => revision.episodeNo).sort((a, b) => a - b)).toEqual([1, 2]);

    const secondDraft = createDeliveryPackageDraft(firstPublished, {
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      type: "range",
      declaredEpisodeFrom: 1,
      declaredEpisodeTo: 20,
      episodes: Array.from({ length: 20 }, (_, index) => ({
        episodeNo: index + 1,
        content: index + 1 === 2 ? "第 2 集\n二次交稿改了旧集。" : `第 ${index + 1} 集\n二次交稿内容。`
      })),
      confirmedEpisodeNos: [2, 11, 12]
    });
    const secondPackageId = secondDraft.deliveryPackages.at(-1)?.id ?? "";
    const secondPublished = publishDeliveryPackage(
      submitDeliveryPackageForReview(secondDraft, secondPackageId, "user-head-writer"),
      secondPackageId,
      "user-owner"
    );
    const episodeTwo = secondPublished.episodes.find(
      (episode) => episode.projectId === "project-jincheng" && episode.episodeNo === 2
    );
    const episodeTwoTimeline = selectEpisodeScriptTimeline(secondPublished, episodeTwo?.id ?? "");

    expect(secondPublished.episodeRevisions.map((revision) => revision.episodeNo).sort((a, b) => a - b)).toEqual([
      1,
      2,
      2,
      11,
      12
    ]);
    expect(episodeTwoTimeline.currentRevision?.revisionNo).toBe(2);
    expect(episodeTwoTimeline.currentRevision?.deliveryPackageId).toBe(secondPackageId);
    expect(episodeTwoTimeline.currentRevision?.changeSummary).toContain("本集有新改动");
  });

  it("supports single episode replacement and notifies assigned creators", () => {
    const draft = createDeliveryPackageDraft(seedWorkspace, {
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      type: "single_replace",
      declaredEpisodeFrom: 5,
      declaredEpisodeTo: 5,
      episodes: [{ episodeNo: 5, content: "第 5 集\n整集替换后的版本。" }],
      confirmedEpisodeNos: [5]
    });
    const deliveryPackageId = draft.deliveryPackages.at(-1)?.id ?? "";
    const published = publishDeliveryPackage(
      submitDeliveryPackageForReview(draft, deliveryPackageId, "user-head-writer"),
      deliveryPackageId,
      "user-owner"
    );
    const episodeFive = published.episodes.find(
      (episode) => episode.projectId === "project-jincheng" && episode.episodeNo === 5
    );
    const timeline = selectEpisodeScriptTimeline(published, episodeFive?.id ?? "");
    const creatorNotifications = selectUnreadNotifications(published, "user-creator-a");

    expect(timeline.currentRevision?.content).toContain("整集替换后的版本");
    expect(episodeFive?.hasUnreadKeyChange).toBe(true);
    expect(creatorNotifications.some((notification) => notification.title === "第 5 集剧本已更新")).toBe(true);
  });
});

describe("asset lock workflow", () => {
  function createPublishedDeliveryForAssetLock() {
    const draft = createDeliveryPackageDraft(seedWorkspace, {
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      type: "range",
      declaredEpisodeFrom: 3,
      declaredEpisodeTo: 5,
      episodes: [
        { episodeNo: 3, content: "第 3 集\n升降笼第一次出现。" },
        { episodeNo: 4, content: "第 4 集\n红色安全灯规则建立。" },
        { episodeNo: 5, content: "第 5 集\n李砚旧伤露出。" }
      ],
      confirmedEpisodeNos: [3, 4, 5]
    });
    const deliveryPackageId = draft.deliveryPackages.at(-1)?.id ?? "";

    return {
      deliveryPackageId,
      state: publishDeliveryPackage(
        submitDeliveryPackageForReview(draft, deliveryPackageId, "user-head-writer"),
        deliveryPackageId,
        "user-owner"
      )
    };
  }

  function createAssetRecord() {
    const { deliveryPackageId, state } = createPublishedDeliveryForAssetLock();
    const next = createAssetLockRecord(state, {
      projectId: "project-jincheng",
      deliveryPackageId,
      episodeNos: [3, 5],
      assetName: "北井升降笼",
      assetType: "scene",
      changeType: "new",
      createdByUserId: "user-head-writer",
      risk: "attention",
      writerNote: "第 5 集会复用困局空间。"
    });

    return {
      deliveryPackageId,
      record: next.assetLockRecords?.at(-1),
      state: next
    };
  }

  it("creates an asset lock record tied to project, delivery package, and episodes", () => {
    const { deliveryPackageId, record } = createAssetRecord();

    expect(record).toMatchObject({
      projectId: "project-jincheng",
      deliveryPackageId,
      episodeNos: [3, 5],
      assetName: "北井升降笼",
      assetType: "scene",
      changeType: "new",
      writerConfirmation: "pending",
      productionConfirmation: "pending",
      risk: "attention",
      status: "draft"
    });
  });

  it("rejects asset lock records before the delivery package is published", () => {
    const draft = createDeliveryPackageDraft(seedWorkspace, {
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      type: "range",
      declaredEpisodeFrom: 3,
      declaredEpisodeTo: 5,
      episodes: [
        { episodeNo: 3, content: "第 3 集\n升降笼第一次出现。" },
        { episodeNo: 4, content: "第 4 集\n红色安全灯规则建立。" },
        { episodeNo: 5, content: "第 5 集\n李砚旧伤露出。" }
      ],
      confirmedEpisodeNos: [3, 4, 5]
    });
    const deliveryPackageId = draft.deliveryPackages.at(-1)?.id ?? "";

    expect(() =>
      createAssetLockRecord(draft, {
        projectId: "project-jincheng",
        deliveryPackageId,
        episodeNos: [3, 5],
        assetName: "北井升降笼",
        assetType: "scene",
        changeType: "new",
        createdByUserId: "user-head-writer"
      })
    ).toThrow("published");
  });

  it("records writer and production confirmations before becoming ready to lock", () => {
    const { record, state } = createAssetRecord();
    const writerConfirmed = confirmAssetLockRecordByWriter(state, {
      assetLockRecordId: record?.id ?? "",
      confirmedByUserId: "user-head-writer",
      note: "编剧确认升降笼为新增主场景资产。"
    });
    const afterWriter = writerConfirmed.assetLockRecords?.find((item) => item.id === record?.id);

    expect(afterWriter?.writerConfirmation).toBe("confirmed");
    expect(afterWriter?.status).toBe("draft");

    const productionConfirmed = confirmAssetLockRecordByProduction(writerConfirmed, {
      assetLockRecordId: record?.id ?? "",
      confirmedByUserId: "user-creator-a",
      note: "制作确认结构和材质可以进入制作。"
    });
    const afterProduction = productionConfirmed.assetLockRecords?.find((item) => item.id === record?.id);

    expect(afterProduction?.productionConfirmation).toBe("confirmed");
    expect(afterProduction?.status).toBe("ready_to_lock");
  });

  it("marks an asset lock record as needing missing information", () => {
    const { record, state } = createAssetRecord();
    const next = markAssetLockRecordNeedsInfo(state, {
      assetLockRecordId: record?.id ?? "",
      markedByUserId: "user-creator-a",
      missingInfo: "缺少升降笼正面结构参考。"
    });
    const updated = next.assetLockRecords?.find((item) => item.id === record?.id);

    expect(updated?.status).toBe("needs_info");
    expect(updated?.missingInfo).toBe("缺少升降笼正面结构参考。");
  });

  it("blocks final lock before all confirmations are completed", () => {
    const { record, state } = createAssetRecord();

    expect(() =>
      finalLockAssetRecord(state, {
        assetLockRecordId: record?.id ?? "",
        lockedByUserId: "user-owner"
      })
    ).toThrow("编剧和制作确认完成后才能定版");
  });

  it("allows coordinator to final lock after writer and production confirmations", () => {
    const { record, state } = createAssetRecord();
    const writerConfirmed = confirmAssetLockRecordByWriter(state, {
      assetLockRecordId: record?.id ?? "",
      confirmedByUserId: "user-head-writer"
    });
    const productionConfirmed = confirmAssetLockRecordByProduction(writerConfirmed, {
      assetLockRecordId: record?.id ?? "",
      confirmedByUserId: "user-creator-a"
    });
    const locked = finalLockAssetRecord(productionConfirmed, {
      assetLockRecordId: record?.id ?? "",
      lockedByUserId: "user-owner"
    });
    const updated = locked.assetLockRecords?.find((item) => item.id === record?.id);

    expect(updated?.status).toBe("locked");
    expect(updated?.finalLockedByUserId).toBe("user-owner");
    expect(updated?.finalLockedAt).toBeTruthy();
  });

  it("creates asset attachment metadata from an existing asset lock record", () => {
    const { record, deliveryPackageId, state } = createAssetRecord();
    const next = createAssetAttachmentMetadata(state, {
      assetLockRecordId: record?.id ?? "",
      fileId: "file-lift-reference",
      fileName: "lift-reference.png",
      mime: "image/png",
      size: 2048,
      attachmentType: "reference",
      uploadedByUserId: "user-head-writer",
      note: "reference board"
    });
    const attachment = next.assetAttachments?.at(-1);

    expect(attachment).toMatchObject({
      projectId: "project-jincheng",
      assetLockRecordId: record?.id,
      deliveryPackageId,
      fileId: "file-lift-reference",
      fileName: "lift-reference.png",
      mime: "image/png",
      size: 2048,
      version: 1,
      attachmentType: "reference",
      uploadedByUserId: "user-head-writer",
      note: "reference board",
      status: "active"
    });
    expect(listAssetAttachmentsForRecord(next, record?.id ?? "")).toHaveLength(1);
  });

  it("increments asset attachment versions within the same asset lock record", () => {
    const { record, state } = createAssetRecord();
    const first = createAssetAttachmentMetadata(state, {
      assetLockRecordId: record?.id ?? "",
      fileId: "file-v1",
      fileName: "lift-v1.png",
      mime: "image/png",
      size: 1024,
      attachmentType: "production",
      uploadedByUserId: "user-creator-a"
    });
    const second = createAssetAttachmentMetadata(first, {
      assetLockRecordId: record?.id ?? "",
      fileId: "file-v2",
      fileName: "lift-v2.png",
      mime: "image/png",
      size: 2048,
      attachmentType: "production",
      uploadedByUserId: "user-creator-a"
    });

    expect(listAssetAttachmentsForRecord(second, record?.id ?? "").map((attachment) => attachment.version)).toEqual([
      1,
      2
    ]);
  });

  it("blocks uploading asset attachments after the asset lock record is locked", () => {
    const { record, state } = createAssetRecord();
    const writerConfirmed = confirmAssetLockRecordByWriter(state, {
      assetLockRecordId: record?.id ?? "",
      confirmedByUserId: "user-head-writer"
    });
    const productionConfirmed = confirmAssetLockRecordByProduction(writerConfirmed, {
      assetLockRecordId: record?.id ?? "",
      confirmedByUserId: "user-creator-a"
    });
    const locked = finalLockAssetRecord(productionConfirmed, {
      assetLockRecordId: record?.id ?? "",
      lockedByUserId: "user-owner"
    });

    expect(() =>
      createAssetAttachmentMetadata(locked, {
        assetLockRecordId: record?.id ?? "",
        fileId: "file-final",
        fileName: "final.png",
        mime: "image/png",
        size: 4096,
        attachmentType: "final",
        uploadedByUserId: "user-owner"
      })
    ).toThrow("资产已定版，不能新增附件");
  });

  it("rejects asset attachment uploads from non-project members", () => {
    const { record, state } = createAssetRecord();
    const withOutsider = registerUser(state, {
      name: "asset attachment outsider",
      role: "creator"
    });

    expect(() =>
      createAssetAttachmentMetadata(withOutsider, {
        assetLockRecordId: record?.id ?? "",
        fileId: "file-not-member",
        fileName: "not-member.png",
        mime: "image/png",
        size: 1024,
        attachmentType: "reference",
        uploadedByUserId: withOutsider.currentUserId ?? ""
      })
    ).toThrow("上传资产附件需要先成为项目成员");

    expect(() =>
      createAssetAttachmentMetadata(state, {
        assetLockRecordId: record?.id ?? "",
        fileId: "file-missing-user",
        fileName: "missing-user.png",
        mime: "image/png",
        size: 1024,
        attachmentType: "reference",
        uploadedByUserId: "missing-user"
      })
    ).toThrow("用户不存在");
  });

  it("allows only uploader or owner/coordinator to soft delete asset attachments", () => {
    const { record, state } = createAssetRecord();
    const withAttachment = createAssetAttachmentMetadata(state, {
      assetLockRecordId: record?.id ?? "",
      fileId: "file-delete",
      fileName: "delete-me.png",
      mime: "image/png",
      size: 1024,
      attachmentType: "reference",
      uploadedByUserId: "user-head-writer"
    });
    const attachmentId = withAttachment.assetAttachments?.at(-1)?.id ?? "";

    expect(() =>
      softDeleteAssetAttachment(withAttachment, {
        assetAttachmentId: attachmentId,
        deletedByUserId: "user-creator-a"
      })
    ).toThrow("删除资产附件权限不足");

    const deletedByUploader = softDeleteAssetAttachment(withAttachment, {
      assetAttachmentId: attachmentId,
      deletedByUserId: "user-head-writer"
    });
    const deleted = deletedByUploader.assetAttachments?.find((attachment) => attachment.id === attachmentId);

    expect(deleted?.status).toBe("deleted");
    expect(deleted?.deletedByUserId).toBe("user-head-writer");
    expect(listAssetAttachmentsForRecord(deletedByUploader, record?.id ?? "")).toHaveLength(0);

    const withSecondAttachment = createAssetAttachmentMetadata(state, {
      assetLockRecordId: record?.id ?? "",
      fileId: "file-delete-by-owner",
      fileName: "delete-by-owner.png",
      mime: "image/png",
      size: 1024,
      attachmentType: "reference",
      uploadedByUserId: "user-head-writer"
    });
    const secondAttachmentId = withSecondAttachment.assetAttachments?.at(-1)?.id ?? "";
    const deletedByCoordinator = softDeleteAssetAttachment(withSecondAttachment, {
      assetAttachmentId: secondAttachmentId,
      deletedByUserId: "user-owner"
    });

    expect(deletedByCoordinator.assetAttachments?.find((attachment) => attachment.id === secondAttachmentId)?.status).toBe(
      "deleted"
    );
  });
});
