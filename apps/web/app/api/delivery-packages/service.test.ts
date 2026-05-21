import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeliveryImportJob, getDeliveryImportWorkspace } from "../delivery-import-jobs/service";
import { mutateDeliveryPackage } from "./service";

describe("delivery package service", () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-delivery-packages-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storeDir, { recursive: true });
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
  });

  afterEach(async () => {
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    await rm(storeDir, { recursive: true, force: true });
  });

  it("persists confirmation changes and returns the workspace snapshot", async () => {
    const deliveryPackageId = await createDraftWithIssues();

    const snapshot = await mutateDeliveryPackage({
      action: "update_confirmation",
      deliveryPackageId,
      confirmedEpisodeNos: [2]
    });
    const packageEpisodes = snapshot.state.deliveryPackageEpisodes.filter((item) => item.deliveryPackageId === deliveryPackageId);
    const persisted = await getDeliveryImportWorkspace();

    expect(packageEpisodes.map((item) => [item.episodeNo, item.isConfirmedChange])).toEqual([
      [1, false],
      [2, true]
    ]);
    expect(persisted.state.deliveryPackageEpisodes.filter((item) => item.deliveryPackageId === deliveryPackageId)).toEqual(
      packageEpisodes
    );
    expect(snapshot.deliveryParseIssuesByPackageId[deliveryPackageId]).toContainEqual(
      expect.objectContaining({
        code: "missing_episode_in_declared_range"
      })
    );
  });

  it("sets a submitted package to pending_review", async () => {
    const deliveryPackageId = await createDraft();

    const snapshot = await mutateDeliveryPackage({
      action: "submit",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });
    const deliveryPackage = snapshot.state.deliveryPackages.find((item) => item.id === deliveryPackageId);

    expect(deliveryPackage).toMatchObject({
      status: "pending_review",
      submittedByUserId: "user-head-writer"
    });
    expect(deliveryPackage?.submittedAt).toBeTruthy();
  });

  it("publishes a reviewed package with revision, current, and notification records", async () => {
    const deliveryPackageId = await createDraft();
    await mutateDeliveryPackage({
      action: "submit",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });

    const snapshot = await mutateDeliveryPackage({
      action: "publish",
      deliveryPackageId,
      actorUserId: "user-owner"
    });
    const deliveryPackage = snapshot.state.deliveryPackages.find((item) => item.id === deliveryPackageId);
    const revisions = snapshot.state.episodeRevisions.filter((item) => item.deliveryPackageId === deliveryPackageId);
    const currentRevisionIds = new Set(snapshot.state.episodeCurrents.map((item) => item.currentRevisionId));
    const notifications = snapshot.state.notifications.filter(
      (item) => item.type === "key_change" && item.projectId === "project-jincheng" && item.createdAt === deliveryPackage?.publishedAt
    );

    expect(deliveryPackage).toMatchObject({
      status: "published",
      reviewedByUserId: "user-owner"
    });
    expect(revisions).toHaveLength(2);
    expect(revisions.every((revision) => currentRevisionIds.has(revision.id))).toBe(true);
    expect(notifications.length).toBeGreaterThan(0);
    expect(snapshot.state.episodes.find((item) => item.id === "episode-jc-1")).toMatchObject({
      productionStatus: "key_update",
      hasUnreadKeyChange: true
    });
  });

  it("rejects a reviewed package with the rejection reason", async () => {
    const deliveryPackageId = await createDraft();
    await mutateDeliveryPackage({
      action: "submit",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });

    const snapshot = await mutateDeliveryPackage({
      action: "reject",
      deliveryPackageId,
      actorUserId: "user-owner",
      rejectionReason: "\u8303\u56f4\u58f0\u660e\u4e0d\u6e05\u6670"
    });
    const deliveryPackage = snapshot.state.deliveryPackages.find((item) => item.id === deliveryPackageId);

    expect(deliveryPackage).toMatchObject({
      status: "rejected",
      reviewedByUserId: "user-owner",
      rejectionReason: "\u8303\u56f4\u58f0\u660e\u4e0d\u6e05\u6670"
    });
    expect(deliveryPackage?.rejectedAt).toBeTruthy();
  });

  it("does not corrupt the workspace when permission or status validation fails", async () => {
    const deliveryPackageId = await createDraft();
    const beforePermissionFailure = await getDeliveryImportWorkspace();

    await expect(
      mutateDeliveryPackage({
        action: "submit",
        deliveryPackageId,
        actorUserId: "user-creator-a"
      })
    ).rejects.toThrow("\u6743\u9650\u4e0d\u8db3");
    await expect(getDeliveryImportWorkspace()).resolves.toEqual(beforePermissionFailure);

    await mutateDeliveryPackage({
      action: "submit",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });
    const beforeStatusFailure = await getDeliveryImportWorkspace();

    await expect(
      mutateDeliveryPackage({
        action: "update_confirmation",
        deliveryPackageId,
        confirmedEpisodeNos: [1]
      })
    ).rejects.toThrow("draft");
    await expect(getDeliveryImportWorkspace()).resolves.toEqual(beforeStatusFailure);
  });
});

async function createDraft() {
  return createDraftFromText({
    declaredRangeText: "1-2",
    rawText: "\u7b2c 1 \u96c6 \u5f00\u573a\n\u6b63\u6587\u4e00\n\u7b2c 2 \u96c6 \u8ffd\u8e2a\n\u6b63\u6587\u4e8c"
  });
}

async function createDraftWithIssues() {
  return createDraftFromText({
    declaredRangeText: "1-3",
    rawText: "\u7b2c 1 \u96c6 \u5f00\u573a\n\u6b63\u6587\u4e00\n\u7b2c 2 \u96c6 \u8ffd\u8e2a\n\u6b63\u6587\u4e8c"
  });
}

async function createDraftFromText(input: { declaredRangeText: string; rawText: string }) {
  const result = await createDeliveryImportJob({
    source: "text",
    projectId: "project-jincheng",
    uploadedByUserId: "user-head-writer",
    declaredRangeText: input.declaredRangeText,
    rawText: input.rawText
  });

  expect(result.ok).toBe(true);
  if (!result.ok || !result.job.deliveryPackageId) {
    throw new Error("delivery package draft was not created");
  }

  return result.job.deliveryPackageId;
}
