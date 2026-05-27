import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginAsUser } from "@aigc/domain";
import { mutateAssetLockRecord } from "../asset-lock-records/service";
import { createDeliveryImportJob } from "../delivery-import-jobs/service";
import { mutateDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { mutateDeliveryPackage } from "../delivery-packages/service";
import { GET } from "./route";

describe("asset decision timeline route", () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-asset-decision-timeline-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storeDir, { recursive: true });
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
  });

  afterEach(async () => {
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    await rm(storeDir, { recursive: true, force: true });
  });

  it("requires projectId and deliveryPackageId query params", async () => {
    const response = await GET(new Request("http://localhost/api/asset-decision-timeline?projectId=project-jincheng"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "invalid_asset_decision_timeline_request"
    });
  });

  it("returns a read-only projection for the current project member", async () => {
    const deliveryPackageId = await createPublishedPackage();
    await mutateDeliveryImportWorkspace((state) => loginAsUser(state, "user-head-writer"));
    await mutateAssetLockRecord(buildCreateBody(deliveryPackageId, "Mine Lift", [1]), { userId: "user-head-writer" });
    await mutateDeliveryImportWorkspace((state) => loginAsUser(state, "user-owner"));

    const response = await GET(
      new Request(
        `http://localhost/api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=${deliveryPackageId}`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      projection: {
        viewerUserId: "user-owner",
        viewerRole: "coordinator",
        decisionQueue: [expect.objectContaining({ title: expect.stringContaining("Mine Lift") })],
        sourceExcerpts: [expect.objectContaining({ relatedAssetNames: ["Mine Lift"] })]
      }
    });
    expect(JSON.stringify(body)).not.toContain(storeDir);
  });

  it("does not accept client-controlled viewer identity or assignment scope", async () => {
    const deliveryPackageId = await createPublishedPackage();
    await mutateDeliveryImportWorkspace((state) => loginAsUser(state, "user-head-writer"));
    await mutateAssetLockRecord(buildCreateBody(deliveryPackageId, "Mine Lift", [1]), { userId: "user-head-writer" });
    await mutateAssetLockRecord(buildCreateBody(deliveryPackageId, "Far Signal", [9]), { userId: "user-head-writer" });
    await mutateDeliveryImportWorkspace((state) => loginAsUser(state, "user-creator-a"));

    const response = await GET(
      new Request(
        `http://localhost/api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=${deliveryPackageId}&viewerUserId=user-owner&viewerRole=coordinator&assignedEpisodeNos=9`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.projection).toMatchObject({
      viewerUserId: "user-creator-a",
      viewerRole: "creator"
    });
    expect(body.projection.decisionQueue.map((decision: { title: string }) => decision.title)).toEqual([
      expect.stringContaining("Mine Lift")
    ]);
    expect(
      body.projection.tracks.flatMap((track: { clips: Array<{ assetName: string }> }) => track.clips).map((clip: { assetName: string }) => clip.assetName)
    ).toEqual(["Mine Lift"]);
  });

  it("returns only session-visible explicit source bindings", async () => {
    const deliveryPackageId = await createPublishedPackage();
    await mutateDeliveryImportWorkspace((state) => loginAsUser(state, "user-head-writer"));
    const visible = await mutateAssetLockRecord(buildCreateBody(deliveryPackageId, "Mine Lift", [1]), { userId: "user-head-writer" });
    const hidden = await mutateAssetLockRecord(buildCreateBody(deliveryPackageId, "Far Signal", [9]), { userId: "user-head-writer" });
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      scriptSourceBindings: [
        {
          id: "binding-visible",
          projectId: "project-jincheng",
          deliveryPackageId,
          assetLockRecordId: visible.record.id,
          episodeNo: 1,
          startLine: 2,
          endLine: 2,
          excerptSnapshot: "Visible bound source",
          createdByUserId: "user-head-writer",
          createdAt: "2026-05-24T00:00:00.000Z"
        },
        {
          id: "binding-hidden",
          projectId: "project-jincheng",
          deliveryPackageId,
          assetLockRecordId: hidden.record.id,
          episodeNo: 9,
          startLine: 4,
          endLine: 4,
          excerptSnapshot: "Hidden bound source",
          createdByUserId: "user-head-writer",
          createdAt: "2026-05-24T00:00:00.000Z"
        }
      ]
    }));
    await mutateDeliveryImportWorkspace((state) => loginAsUser(state, "user-creator-a"));

    const response = await GET(
      new Request(
        `http://localhost/api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=${deliveryPackageId}&viewerRole=coordinator&assignedEpisodeNos=9`
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.projection.sourceExcerpts).toEqual([
      expect.objectContaining({
        id: "source-binding-binding-visible",
        excerpt: "Visible bound source"
      })
    ]);
    expect(JSON.stringify(body)).not.toContain("Hidden bound source");
  });

  it("maps service errors to stable HTTP statuses", async () => {
    const deliveryPackageId = await createPublishedPackage();
    const unauthenticated = await GET(
      new Request(
        `http://localhost/api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=${deliveryPackageId}`
      )
    );
    await mutateDeliveryImportWorkspace((state) => loginAsUser(state, "user-owner"));
    const missingPackage = await GET(
      new Request("http://localhost/api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=missing-package")
    );

    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ ok: false, error: "unauthenticated" });
    expect(missingPackage.status).toBe(404);
    await expect(missingPackage.json()).resolves.toEqual({ ok: false, error: "delivery_package_not_found" });
  });

  it("maps member and package-boundary errors to stable HTTP statuses", async () => {
    const draftPackageId = await createPackage({ publish: false });
    const publishedPackageId = await createPublishedPackage();
    const mismatchedPreviousPackageId = await createPublishedPackage();
    await mutateDeliveryImportWorkspace((state) => ({
      ...loginAsUser(state, "user-owner"),
      deliveryPackages: state.deliveryPackages.map((item) =>
        item.id === mismatchedPreviousPackageId ? { ...item, projectId: "project-tide" } : item
      ),
      currentUserId: "user-outsider",
      users: [
        ...state.users,
        {
          id: "user-outsider",
          name: "Outsider",
          defaultRole: "creator",
          avatarTone: "gray"
        }
      ]
    }));
    const nonMember = await GET(
      new Request(
        `http://localhost/api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=${publishedPackageId}`
      )
    );
    await mutateDeliveryImportWorkspace((state) => loginAsUser(state, "user-owner"));
    const missingProject = await GET(
      new Request(
        `http://localhost/api/asset-decision-timeline?projectId=missing-project&deliveryPackageId=${publishedPackageId}`
      )
    );
    const unpublishedPackage = await GET(
      new Request(`http://localhost/api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=${draftPackageId}`)
    );
    const missingPreviousPackage = await GET(
      new Request(
        `http://localhost/api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=${publishedPackageId}&previousDeliveryPackageId=missing-previous`
      )
    );
    const draftPreviousPackage = await GET(
      new Request(
        `http://localhost/api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=${publishedPackageId}&previousDeliveryPackageId=${draftPackageId}`
      )
    );
    const mismatchedPreviousPackage = await GET(
      new Request(
        `http://localhost/api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=${publishedPackageId}&previousDeliveryPackageId=${mismatchedPreviousPackageId}`
      )
    );
    const samePreviousPackage = await GET(
      new Request(
        `http://localhost/api/asset-decision-timeline?projectId=project-jincheng&deliveryPackageId=${publishedPackageId}&previousDeliveryPackageId=${publishedPackageId}`
      )
    );

    expect(nonMember.status).toBe(403);
    await expect(nonMember.json()).resolves.toEqual({ ok: false, error: "project_member_required" });
    expect(missingProject.status).toBe(404);
    await expect(missingProject.json()).resolves.toEqual({ ok: false, error: "project_not_found" });
    expect(unpublishedPackage.status).toBe(409);
    await expect(unpublishedPackage.json()).resolves.toEqual({ ok: false, error: "delivery_package_not_published" });
    expect(missingPreviousPackage.status).toBe(404);
    await expect(missingPreviousPackage.json()).resolves.toEqual({ ok: false, error: "previous_delivery_package_not_found" });
    expect(draftPreviousPackage.status).toBe(409);
    await expect(draftPreviousPackage.json()).resolves.toEqual({ ok: false, error: "previous_delivery_package_not_published" });
    expect(mismatchedPreviousPackage.status).toBe(400);
    await expect(mismatchedPreviousPackage.json()).resolves.toEqual({
      ok: false,
      error: "previous_delivery_package_project_mismatch"
    });
    expect(samePreviousPackage.status).toBe(409);
    await expect(samePreviousPackage.json()).resolves.toEqual({ ok: false, error: "previous_delivery_package_not_before_current" });
  });
});

async function createPublishedPackage() {
  return createPackage({ publish: true });
}

async function createPackage({ publish }: { publish: boolean }) {
  const result = await createDeliveryImportJob({
    source: "text",
    projectId: "project-jincheng",
    uploadedByUserId: "user-head-writer",
    declaredRangeText: "1-9",
    rawText: "第 1 集\nMine Lift appears.\n第 9 集\nFar Signal appears."
  });

  expect(result.ok).toBe(true);
  if (!result.ok || !result.job.deliveryPackageId) {
    throw new Error("delivery package draft was not created");
  }

  const deliveryPackageId = result.job.deliveryPackageId;

  if (!publish) {
    return deliveryPackageId;
  }

  await mutateDeliveryPackage({
    action: "submit",
    deliveryPackageId,
    actorUserId: "user-head-writer"
  });
  await mutateDeliveryPackage({
    action: "publish",
    deliveryPackageId,
    actorUserId: "user-owner"
  });

  return deliveryPackageId;
}

function buildCreateBody(deliveryPackageId: string, assetName: string, episodeNos: number[]) {
  return {
    action: "create" as const,
    projectId: "project-jincheng",
    deliveryPackageId,
    episodeNos,
    assetName,
    assetType: "scene" as const,
    changeType: "new" as const,
    createdByUserId: "user-head-writer",
    risk: "attention" as const
  };
}
