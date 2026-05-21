import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDeliveryImportJob,
  getDeliveryImportJobResult,
  getDeliveryImportWorkspace,
  listDeliveryImportJobs,
  runDeliveryImportJob
} from "./service";

describe("delivery import job service", () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-delivery-import-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storeDir, { recursive: true });
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
  });

  afterEach(async () => {
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    await rm(storeDir, { recursive: true, force: true });
  });

  it("returns a draft and successful job for pasted text", async () => {
    const result = await runDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-2",
      rawText: "第 1 集 开场\n场 1-1 金城矿山 日 外\n正文一\n第 2 集 追踪\n正文二"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.job).toMatchObject({
      source: "text",
      status: "success",
      projectId: "project-jincheng",
      fileName: "pasted-word-text.txt"
    });
    expect(result.draft).toMatchObject({
      type: "range",
      declaredEpisodeFrom: 1,
      declaredEpisodeTo: 2,
      confirmedEpisodeNos: [1, 2]
    });
  });

  it("returns failed job details when text cannot be segmented", async () => {
    const result = await runDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      rawText: "场 1-1 金城矿山 日 外\n没有集标题"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.job.status).toBe("failed");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "episode_boundary_not_found"
      })
    );
  });

  it("stores created import jobs for later polling", async () => {
    const result = await createDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      rawText: "第 1 集 开场\n正文"
    });

    await expect(getDeliveryImportJobResult(result.job.id)).resolves.toEqual(result);
    await expect(listDeliveryImportJobs("project-jincheng")).resolves.toContainEqual(result.job);
  });

  it("persists a successful draft in the server workspace and links it to the job", async () => {
    const result = await createDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-2",
      rawText: "第 1 集 开场\n正文一\n第 2 集 追踪\n正文二"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.job.deliveryPackageId).toBeTruthy();

    const workspace = await getDeliveryImportWorkspace();
    const deliveryPackage = workspace.state.deliveryPackages.find((item) => item.id === result.job.deliveryPackageId);
    const packageEpisodes = workspace.state.deliveryPackageEpisodes.filter(
      (item) => item.deliveryPackageId === result.job.deliveryPackageId
    );

    expect(deliveryPackage).toMatchObject({
      projectId: "project-jincheng",
      status: "draft",
      declaredEpisodeFrom: 1,
      declaredEpisodeTo: 2
    });
    expect(packageEpisodes).toHaveLength(2);
    await expect(getDeliveryImportJobResult(result.job.id)).resolves.toMatchObject({
      job: {
        deliveryPackageId: result.job.deliveryPackageId
      }
    });
  });

  it("appends multiple successful drafts without overwriting earlier packages", async () => {
    const first = await createDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      rawText: "\u7b2c 1 \u96c6 \u5f00\u573a\n\u6b63\u6587\u4e00"
    });
    const second = await createDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "2-3",
      rawText: "\u7b2c 2 \u96c6 \u8ffd\u8e2a\n\u6b63\u6587\u4e8c\n\u7b2c 3 \u96c6 \u5bf9\u5cd9\n\u6b63\u6587\u4e09"
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }

    expect(first.job.deliveryPackageId).toBeTruthy();
    expect(second.job.deliveryPackageId).toBeTruthy();
    expect(second.job.deliveryPackageId).not.toBe(first.job.deliveryPackageId);

    const workspace = await getDeliveryImportWorkspace();
    const deliveryPackageIds = workspace.state.deliveryPackages.map((item) => item.id);

    expect(deliveryPackageIds).toEqual(expect.arrayContaining([first.job.deliveryPackageId, second.job.deliveryPackageId]));
    expect(
      workspace.state.deliveryPackageEpisodes.filter((item) => item.deliveryPackageId === first.job.deliveryPackageId)
    ).toHaveLength(1);
    expect(
      workspace.state.deliveryPackageEpisodes.filter((item) => item.deliveryPackageId === second.job.deliveryPackageId)
    ).toHaveLength(2);
  });

  it("persists parse issues by created delivery package id", async () => {
    const result = await createDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-2",
      rawText: "第 1 集 开场\n正文一"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const workspace = await getDeliveryImportWorkspace();

    expect(result.job.deliveryPackageId).toBeTruthy();
    expect(workspace.deliveryParseIssuesByPackageId[result.job.deliveryPackageId ?? ""]).toContainEqual(
      expect.objectContaining({
        code: "missing_episode_in_declared_range"
      })
    );
  });

  it("does not create a delivery package for failed imports", async () => {
    const result = await createDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      rawText: "场 1-1 金城矿山 日 外\n没有集标题"
    });

    expect(result.ok).toBe(false);

    const workspace = await getDeliveryImportWorkspace();

    expect(workspace.state.deliveryPackages).toHaveLength(0);
    expect(workspace.state.deliveryPackageEpisodes).toHaveLength(0);
    await expect(getDeliveryImportJobResult(result.job.id)).resolves.toEqual(result);
  });

  it("keeps delivery package links when listing jobs by project", async () => {
    const success = await createDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      rawText: "\u7b2c 1 \u96c6 \u5f00\u573a\n\u6b63\u6587"
    });
    const failed = await createDeliveryImportJob({
      source: "text",
      projectId: "project-tide",
      uploadedByUserId: "user-creator-a",
      declaredRangeText: "1-1",
      rawText: "\u573a 1-1 \u6d77\u5824 \u65e5 \u5916\n\u6ca1\u6709\u96c6\u6807\u9898"
    });

    expect(success.ok).toBe(true);
    expect(failed.ok).toBe(false);
    if (!success.ok) {
      return;
    }

    await expect(listDeliveryImportJobs("project-jincheng")).resolves.toContainEqual(
      expect.objectContaining({
        id: success.job.id,
        deliveryPackageId: success.job.deliveryPackageId
      })
    );
    const tideJobs = await listDeliveryImportJobs("project-tide");
    expect(tideJobs).toHaveLength(1);
    expect(tideJobs[0]).toMatchObject({
      id: failed.job.id,
      status: "failed"
    });
    expect(tideJobs[0]).not.toHaveProperty("deliveryPackageId");
  });
});
