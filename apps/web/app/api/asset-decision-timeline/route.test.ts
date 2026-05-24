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
    await mutateAssetLockRecord(buildCreateBody(deliveryPackageId, "Mine Lift", [1]));
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
    await mutateAssetLockRecord(buildCreateBody(deliveryPackageId, "Mine Lift", [1]));
    await mutateAssetLockRecord(buildCreateBody(deliveryPackageId, "Far Signal", [9]));
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
});

async function createPublishedPackage() {
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
