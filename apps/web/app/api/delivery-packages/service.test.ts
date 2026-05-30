import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedWorkspace } from "@aigc/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeliveryImportJob, getDeliveryImportWorkspace } from "../delivery-import-jobs/service";
import { mutateDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import * as assetLockRecordDbParts from "../asset-lock-records/db-parts";
import * as authScopeDbRepository from "../auth-scope/db-repository";
import * as deliveryPackageDbRepository from "./db-repository";
import { mutateDeliveryPackage } from "./service";

describe("delivery package service", () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-delivery-packages-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storeDir, { recursive: true });
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
    vi.spyOn(authScopeDbRepository, "readDbAuthScopeSnapshot").mockResolvedValue({
      users: seedWorkspace.users,
      projects: seedWorkspace.projects,
      members: seedWorkspace.members,
      memberPermissions: seedWorkspace.memberPermissions,
      episodes: seedWorkspace.episodes,
      assignments: seedWorkspace.assignments
    });
    vi.spyOn(assetLockRecordDbParts, "readDbAssetLockRecordParts").mockResolvedValue({
      assetLockRecords: [],
      scriptSourceBindings: []
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
    delete process.env.DATABASE_URL;
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

  it("updates DB episode confirmations in DB mode without writing local package arrays", async () => {
    const deliveryPackageId = await createDraft();
    const db = await prepareDbDeliveryPackageSnapshot(deliveryPackageId);
    const updateConfirmations = vi
      .spyOn(deliveryPackageDbRepository, "updateDbDeliveryPackageEpisodeConfirmations")
      .mockImplementation(async (targetPackageId, episodes) => {
        db.snapshot = {
          ...db.snapshot,
          deliveryPackageEpisodes: db.snapshot.deliveryPackageEpisodes.map((episode) => {
            const updated = episodes.find((item) => item.id === episode.id);

            return episode.deliveryPackageId === targetPackageId && updated
              ? { ...episode, isConfirmedChange: updated.isConfirmedChange }
              : episode;
          })
        };

        return db.snapshot;
      });

    const snapshot = await mutateDeliveryPackage({
      action: "update_confirmation",
      deliveryPackageId,
      confirmedEpisodeNos: [2]
    });

    expect(updateConfirmations).toHaveBeenCalledTimes(1);
    expect(updateConfirmations).toHaveBeenCalledWith(
      deliveryPackageId,
      expect.arrayContaining([
        expect.objectContaining({ episodeNo: 1, isConfirmedChange: false }),
        expect.objectContaining({ episodeNo: 2, isConfirmedChange: true })
      ])
    );
    expect(
      snapshot.state.deliveryPackageEpisodes
        .filter((item) => item.deliveryPackageId === deliveryPackageId)
        .map((item) => [item.episodeNo, item.isConfirmedChange])
    ).toEqual([
      [1, false],
      [2, true]
    ]);
    expect((await getLocalDeliveryImportWorkspace()).state.deliveryPackages).toEqual([]);
    expect((await getLocalDeliveryImportWorkspace()).state.deliveryPackageEpisodes).toEqual([]);
  });

  it("submits DB packages by updating status fields without writing local package arrays", async () => {
    const deliveryPackageId = await createDraft();
    const db = await prepareDbDeliveryPackageSnapshot(deliveryPackageId);
    const updatePackage = mockDbPackageUpdate(db);

    const snapshot = await mutateDeliveryPackage({
      action: "submit",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });
    const deliveryPackage = snapshot.state.deliveryPackages.find((item) => item.id === deliveryPackageId);

    expect(updatePackage).toHaveBeenCalledTimes(1);
    expect(updatePackage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: deliveryPackageId,
        status: "pending_review",
        submittedByUserId: "user-head-writer"
      })
    );
    expect(deliveryPackage).toMatchObject({
      status: "pending_review",
      submittedByUserId: "user-head-writer"
    });
    expect(deliveryPackage?.submittedAt).toBeTruthy();
    expect((await getLocalDeliveryImportWorkspace()).state.deliveryPackages).toEqual([]);
    expect((await getLocalDeliveryImportWorkspace()).state.deliveryPackageEpisodes).toEqual([]);
  });

  it("rejects DB packages by updating status and rejection reason without writing local package arrays", async () => {
    const deliveryPackageId = await createDraft();
    const db = await prepareDbDeliveryPackageSnapshot(deliveryPackageId);
    const updatePackage = mockDbPackageUpdate(db);

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

    expect(updatePackage).toHaveBeenCalledTimes(2);
    expect(updatePackage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: deliveryPackageId,
        status: "rejected",
        reviewedByUserId: "user-owner",
        rejectionReason: "\u8303\u56f4\u58f0\u660e\u4e0d\u6e05\u6670"
      })
    );
    expect(deliveryPackage).toMatchObject({
      status: "rejected",
      reviewedByUserId: "user-owner",
      rejectionReason: "\u8303\u56f4\u58f0\u660e\u4e0d\u6e05\u6670"
    });
    expect(deliveryPackage?.rejectedAt).toBeTruthy();
    expect((await getLocalDeliveryImportWorkspace()).state.deliveryPackages).toEqual([]);
    expect((await getLocalDeliveryImportWorkspace()).state.deliveryPackageEpisodes).toEqual([]);
  });

  it("keeps DB publish unsupported and does not write DB or local state", async () => {
    const deliveryPackageId = await createDraft();
    await prepareDbDeliveryPackageSnapshot(deliveryPackageId);
    const updatePackage = vi.spyOn(deliveryPackageDbRepository, "updateDbDeliveryPackage");
    const updateConfirmations = vi.spyOn(deliveryPackageDbRepository, "updateDbDeliveryPackageEpisodeConfirmations");
    const readDbPackages = vi.mocked(deliveryPackageDbRepository.readDbDeliveryPackageSnapshot);
    const beforeLocal = await getLocalDeliveryImportWorkspace();

    await expect(
      mutateDeliveryPackage({
        action: "publish",
        deliveryPackageId,
        actorUserId: "user-owner"
      })
    ).rejects.toThrow("delivery_package_db_mutation_not_supported:publish");

    expect(readDbPackages).not.toHaveBeenCalled();
    expect(updatePackage).not.toHaveBeenCalled();
    expect(updateConfirmations).not.toHaveBeenCalled();
    await expect(getLocalDeliveryImportWorkspace()).resolves.toEqual(beforeLocal);
  });

  it("does not write DB when DB mode permission or status validation fails", async () => {
    const deliveryPackageId = await createDraft();
    const db = await prepareDbDeliveryPackageSnapshot(deliveryPackageId);
    const updatePackage = mockDbPackageUpdate(db);
    const updateConfirmations = vi.spyOn(deliveryPackageDbRepository, "updateDbDeliveryPackageEpisodeConfirmations");

    await expect(
      mutateDeliveryPackage({
        action: "submit",
        deliveryPackageId,
        actorUserId: "user-creator-a"
      })
    ).rejects.toThrow("\u6743\u9650\u4e0d\u8db3");
    expect(updatePackage).not.toHaveBeenCalled();
    expect(updateConfirmations).not.toHaveBeenCalled();

    await mutateDeliveryPackage({
      action: "submit",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });
    const writesAfterSubmit = updatePackage.mock.calls.length;

    await expect(
      mutateDeliveryPackage({
        action: "update_confirmation",
        deliveryPackageId,
        confirmedEpisodeNos: [1]
      })
    ).rejects.toThrow("draft");

    expect(updatePackage).toHaveBeenCalledTimes(writesAfterSubmit);
    expect(updateConfirmations).not.toHaveBeenCalled();
    expect((await getLocalDeliveryImportWorkspace()).state.deliveryPackages).toEqual([]);
    expect((await getLocalDeliveryImportWorkspace()).state.deliveryPackageEpisodes).toEqual([]);
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

async function prepareDbDeliveryPackageSnapshot(deliveryPackageId: string) {
  const workspace = await getDeliveryImportWorkspace();
  const dbState = {
    snapshot: {
      deliveryPackages: workspace.state.deliveryPackages.filter((item) => item.id === deliveryPackageId),
      deliveryPackageEpisodes: workspace.state.deliveryPackageEpisodes.filter(
        (item) => item.deliveryPackageId === deliveryPackageId
      )
    }
  };

  await mutateDeliveryImportWorkspace((state) => ({
    ...state,
    deliveryPackages: [],
    deliveryPackageEpisodes: []
  }));
  process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
  process.env.DATABASE_URL = "postgres://example.invalid/aigc";
  vi.spyOn(deliveryPackageDbRepository, "readDbDeliveryPackageSnapshot").mockImplementation(async () => dbState.snapshot);

  return dbState;
}

function mockDbPackageUpdate(db: { snapshot: deliveryPackageDbRepository.DeliveryPackageDbSnapshot }) {
  return vi.spyOn(deliveryPackageDbRepository, "updateDbDeliveryPackage").mockImplementation(async (deliveryPackage) => {
    db.snapshot = {
      ...db.snapshot,
      deliveryPackages: db.snapshot.deliveryPackages.map((item) => (item.id === deliveryPackage.id ? deliveryPackage : item))
    };

    return deliveryPackage;
  });
}

async function getLocalDeliveryImportWorkspace() {
  const repositoryMode = process.env.ASSET_LOCK_RECORDS_REPOSITORY;
  const databaseUrl = process.env.DATABASE_URL;

  delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
  delete process.env.DATABASE_URL;

  try {
    return await getDeliveryImportWorkspace();
  } finally {
    if (repositoryMode === undefined) {
      delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
    } else {
      process.env.ASSET_LOCK_RECORDS_REPOSITORY = repositoryMode;
    }

    if (databaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = databaseUrl;
    }
  }
}
