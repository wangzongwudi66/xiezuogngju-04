import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace, type WorkspaceState } from "@aigc/domain";
import {
  createDeliveryImportJob,
  getDeliveryImportJobResult,
  getDeliveryImportWorkspace,
  listDeliveryImportJobs,
  retryDeliveryImportJob,
  runDeliveryImportJob
} from "./service";
import {
  mutateDeliveryImportWorkspace,
  readDeliveryImportJobFile,
  saveDeliveryImportJobFile,
  saveDeliveryImportJobResult
} from "./persistence";
import * as assetLockRecordDbParts from "../asset-lock-records/db-parts";
import * as authScopeDbRepository from "../auth-scope/db-repository";
import * as deliveryPackageDbRepository from "../delivery-packages/db-repository";

describe("delivery import job service", () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-delivery-import-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storeDir, { recursive: true });
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
    process.env.AIGC_DELIVERY_IMPORT_FILE_DIR = join(storeDir, "files");
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
    delete process.env.AIGC_DELIVERY_IMPORT_FILE_DIR;
    delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
    delete process.env.DATABASE_URL;
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

  it("saves a successful docx import before parsing and records its file id", async () => {
    const fileBuffer = createStoredDocx(
      "word/document.xml",
      [
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
        paragraph("第 1 集 开场"),
        paragraph("正文"),
        "</w:body></w:document>"
      ].join("")
    );
    const result = await createDeliveryImportJob({
      source: "docx",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      fileName: "delivery.docx",
      fileBuffer
    });

    expect(result.ok).toBe(true);
    expect(result.job.fileId).toMatch(/^file-/);
    expect(result.job).not.toHaveProperty("filePath");

    const saved = await readDeliveryImportJobFile(result.job.fileId ?? "");

    expect(saved).toBeTruthy();
    expect(saved ? [...saved] : []).toEqual([...fileBuffer]);
    await expect(getDeliveryImportJobResult(result.job.id)).resolves.toMatchObject({
      job: {
        fileId: result.job.fileId
      }
    });
  });

  it("keeps the original docx file when parsing fails", async () => {
    const fileBuffer = new TextEncoder().encode("not a zip");
    const result = await createDeliveryImportJob({
      source: "docx",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      fileName: "broken.docx",
      fileBuffer
    });

    expect(result.ok).toBe(false);
    expect(result.job.status).toBe("failed");
    expect(result.job.fileId).toMatch(/^file-/);
    expect(result.job).not.toHaveProperty("filePath");

    const saved = await readDeliveryImportJobFile(result.job.fileId ?? "");

    expect(saved).toBeTruthy();
    expect(saved ? [...saved] : []).toEqual([...fileBuffer]);
  });

  it("retries a failed docx import from the saved original file as a new job", async () => {
    const fileId = "file-retry-success";
    const fileBuffer = createStoredDocx(
      "word/document.xml",
      [
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
        paragraph("\u7b2c 1 \u96c6 \u5f00\u573a"),
        paragraph("\u6b63\u6587"),
        "</w:body></w:document>"
      ].join("")
    );
    const failedJob = {
      id: "import-docx-retry-source",
      projectId: "project-jincheng",
      source: "docx" as const,
      status: "failed" as const,
      fileName: "retryable.docx",
      fileId,
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      issueCount: 1,
      errorText: "previous parse failure"
    };

    await saveDeliveryImportJobFile({ fileId, fileBuffer });
    await saveDeliveryImportJobResult({
      ok: false,
      issues: [],
      remedies: [],
      job: failedJob
    });

    const retried = await retryDeliveryImportJob(failedJob.id);

    expect(retried.ok).toBe(true);
    if (!retried.ok || !("job" in retried)) {
      return;
    }

    expect(retried.job).toMatchObject({
      source: "docx",
      status: "success",
      projectId: failedJob.projectId,
      fileName: failedJob.fileName,
      fileId: failedJob.fileId,
      retryOfJobId: failedJob.id,
      uploadedByUserId: "user-head-writer"
    });
    expect(retried.job.id).not.toBe(failedJob.id);
    expect(retried.job.deliveryPackageId).toBeTruthy();
    expect(retried.job).not.toHaveProperty("filePath");
    await expect(getDeliveryImportJobResult(failedJob.id)).resolves.toMatchObject({ job: failedJob });
    await expect(getDeliveryImportJobResult(retried.job.id)).resolves.toEqual(retried);
  });

  it("keeps a retried docx failure with its source job relationship", async () => {
    const failed = await createDeliveryImportJob({
      source: "docx",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      fileName: "still-broken.docx",
      fileBuffer: new TextEncoder().encode("not a zip")
    });
    const retried = await retryDeliveryImportJob(failed.job.id);

    expect(retried.ok).toBe(false);
    expect(retried).toMatchObject({
      job: {
        status: "failed",
        fileId: failed.job.fileId,
        retryOfJobId: failed.job.id
      }
    });
    expect("job" in retried ? retried.job.id : "").not.toBe(failed.job.id);
  });

  it("returns clear retry errors for missing source job, file id, or original file", async () => {
    await expect(retryDeliveryImportJob("missing-job")).resolves.toEqual({
      ok: false,
      error: "delivery_import_job_not_found"
    });

    await saveDeliveryImportJobResult({
      ok: false,
      issues: [],
      remedies: [],
      job: {
        id: "import-docx-without-file-id",
        projectId: "project-jincheng",
        source: "docx",
        status: "failed",
        fileName: "missing-file-id.docx",
        declaredRangeText: "1-1",
        createdAt: new Date().toISOString()
      }
    });
    await expect(retryDeliveryImportJob("import-docx-without-file-id")).resolves.toEqual({
      ok: false,
      error: "delivery_import_job_file_id_missing"
    });

    await saveDeliveryImportJobResult({
      ok: false,
      issues: [],
      remedies: [],
      job: {
        id: "import-docx-lost-file",
        projectId: "project-jincheng",
        source: "docx",
        status: "failed",
        fileName: "lost.docx",
        fileId: "file-lost-file",
        declaredRangeText: "1-1",
        createdAt: new Date().toISOString()
      }
    });
    await expect(retryDeliveryImportJob("import-docx-lost-file")).resolves.toEqual({
      ok: false,
      error: "delivery_import_job_file_missing"
    });
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

  it("writes successful text imports to DB in DB mode without writing local workspace package arrays", async () => {
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      users: [],
      projects: [],
      members: [],
      memberPermissions: [],
      episodes: [],
      assignments: []
    }));
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    process.env.DATABASE_URL = "postgres://example.invalid/aigc";
    let dbSnapshot: deliveryPackageDbRepository.DeliveryPackageDbSnapshot = {
      deliveryPackages: [],
      deliveryPackageEpisodes: []
    };
    const createDbPackage = vi
      .spyOn(deliveryPackageDbRepository, "createDbDeliveryPackageWithEpisodes")
      .mockImplementation(async (deliveryPackage, episodes) => {
        dbSnapshot = {
          deliveryPackages: [...dbSnapshot.deliveryPackages, deliveryPackage],
          deliveryPackageEpisodes: [...dbSnapshot.deliveryPackageEpisodes, ...episodes]
        };

        return dbSnapshot;
      });
    vi.spyOn(deliveryPackageDbRepository, "readDbDeliveryPackageSnapshot").mockImplementation(async () => dbSnapshot);

    const result = await createDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-2",
      rawText: "\u7b2c 1 \u96c6 \u5f00\u573a\n\u6b63\u6587\u4e00\n\u7b2c 2 \u96c6 \u8ffd\u8e2a\n\u6b63\u6587\u4e8c"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.job.deliveryPackageId).toBeTruthy();
    expect(createDbPackage).toHaveBeenCalledTimes(1);
    expect(createDbPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.job.deliveryPackageId,
        projectId: "project-jincheng",
        status: "draft"
      }),
      expect.arrayContaining([
        expect.objectContaining({ deliveryPackageId: result.job.deliveryPackageId, episodeNo: 1 }),
        expect.objectContaining({ deliveryPackageId: result.job.deliveryPackageId, episodeNo: 2 })
      ])
    );

    const dbWorkspace = await getDeliveryImportWorkspace();
    expect(dbWorkspace.state.deliveryPackages.map((item) => item.id)).toEqual([result.job.deliveryPackageId]);
    expect(dbWorkspace.state.deliveryPackageEpisodes).toHaveLength(2);

    delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
    delete process.env.DATABASE_URL;
    const localWorkspace = await getDeliveryImportWorkspace();
    expect(localWorkspace.state.deliveryPackages).toEqual([]);
    expect(localWorkspace.state.deliveryPackageEpisodes).toEqual([]);
    expect(localWorkspace.deliveryParseIssuesByPackageId[result.job.deliveryPackageId ?? ""]).toEqual(result.issues);
  });

  it("does not write DB packages for failed imports in DB mode", async () => {
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    process.env.DATABASE_URL = "postgres://example.invalid/aigc";
    const createDbPackage = vi.spyOn(deliveryPackageDbRepository, "createDbDeliveryPackageWithEpisodes");
    vi.spyOn(deliveryPackageDbRepository, "readDbDeliveryPackageSnapshot").mockResolvedValue({
      deliveryPackages: [],
      deliveryPackageEpisodes: []
    });

    const result = await createDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      rawText: "\u573a 1-1 \u91d1\u57ce\u77ff\u5c71 \u65e5 \u5916\n\u6ca1\u6709\u96c6\u6807\u9898"
    });

    expect(result.ok).toBe(false);
    expect(createDbPackage).not.toHaveBeenCalled();

    const workspace = await getDeliveryImportWorkspace();
    expect(workspace.state.deliveryPackages).toEqual([]);
    expect(workspace.state.deliveryPackageEpisodes).toEqual([]);
  });

  it("uses the full DB workspace overlay for workspace reads and ignores stale local DB-owned arrays", async () => {
    const localResult = await createDeliveryImportJob({
      source: "text",
      projectId: "project-jincheng",
      uploadedByUserId: "user-head-writer",
      declaredRangeText: "1-1",
      rawText: "\u7b2c 1 \u96c6 \u5f00\u573a\nLOCAL stale source"
    });

    expect(localResult.ok).toBe(true);
    if (!localResult.ok) {
      return;
    }

    const overlay = buildWorkspaceOverlayFixture(localResult.job.deliveryPackageId ?? "delivery-local-stale");
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      ...overlay.local
    }));
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    process.env.DATABASE_URL = "postgres://example.invalid/aigc";
    vi.mocked(authScopeDbRepository.readDbAuthScopeSnapshot).mockResolvedValue(overlay.auth);
    vi.mocked(assetLockRecordDbParts.readDbAssetLockRecordParts).mockResolvedValue(overlay.assetLock);
    vi.spyOn(deliveryPackageDbRepository, "readDbDeliveryPackageSnapshot").mockResolvedValue({
      deliveryPackages: overlay.delivery.deliveryPackages,
      deliveryPackageEpisodes: overlay.delivery.deliveryPackageEpisodes
    });

    const workspace = await getDeliveryImportWorkspace();

    expect(workspace.state.deliveryPackages.map((item) => item.id)).toEqual(["delivery-db-overlay"]);
    expect(workspace.state.deliveryPackageEpisodes.map((item) => item.content)).toEqual(["DB overlay source"]);
    expect(workspace.state.users).toEqual(overlay.auth.users);
    expect(workspace.state.projects).toEqual(overlay.auth.projects);
    expect(workspace.state.members).toEqual(overlay.auth.members);
    expect(workspace.state.memberPermissions).toEqual(overlay.auth.memberPermissions);
    expect(workspace.state.episodes).toEqual(overlay.auth.episodes);
    expect(workspace.state.assignments).toEqual(overlay.auth.assignments);
    expect(workspace.state.assetLockRecords).toEqual(overlay.assetLock.assetLockRecords);
    expect(workspace.state.scriptSourceBindings).toEqual(overlay.assetLock.scriptSourceBindings);
    expect(workspace.state.currentUserId).toBe("user-db-overlay");
    expect(workspace.state.users).not.toContainEqual(overlay.local.users[0]);
    expect(workspace.state.projects).not.toContainEqual(overlay.local.projects[0]);
    expect(workspace.state.assetLockRecords).not.toContainEqual(overlay.local.assetLockRecords[0]);
    expect(workspace.state.scriptSourceBindings).not.toContainEqual(overlay.local.scriptSourceBindings[0]);
    expect(workspace.state.deliveryPackages).not.toContainEqual(expect.objectContaining({ id: localResult.job.deliveryPackageId }));
  });

  it("fails closed in DB mode without DATABASE_URL instead of falling back to local package writes", async () => {
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    delete process.env.DATABASE_URL;

    await expect(
      createDeliveryImportJob({
        source: "text",
        projectId: "project-jincheng",
        uploadedByUserId: "user-head-writer",
        declaredRangeText: "1-1",
        rawText: "\u7b2c 1 \u96c6 \u5f00\u573a\n\u6b63\u6587"
      })
    ).rejects.toThrow("asset_lock_record_database_url_required");

    delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
    const workspace = await getDeliveryImportWorkspace();
    expect(workspace.state.deliveryPackages).toEqual([]);
    expect(workspace.state.deliveryPackageEpisodes).toEqual([]);
    await expect(listDeliveryImportJobs("project-jincheng")).resolves.toEqual([]);
  });
});

function paragraph(text: string) {
  return `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
}

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createStoredDocx(filePath: string, content: string) {
  const encoder = new TextEncoder();
  const fileName = encoder.encode(filePath);
  const payload = encoder.encode(content);
  const localHeader = bytes(
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(payload.length),
    u32(payload.length),
    u16(fileName.length),
    u16(0),
    fileName,
    payload
  );
  const centralDirectory = bytes(
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(payload.length),
    u32(payload.length),
    u16(fileName.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    fileName
  );
  const endOfCentralDirectory = bytes(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(centralDirectory.length),
    u32(localHeader.length),
    u16(0)
  );

  return bytes(localHeader, centralDirectory, endOfCentralDirectory);
}

function buildWorkspaceOverlayFixture(localDeliveryPackageId: string): {
  local: Pick<
    WorkspaceState,
    | "currentUserId"
    | "users"
    | "projects"
    | "members"
    | "memberPermissions"
    | "episodes"
    | "assignments"
    | "deliveryPackages"
    | "deliveryPackageEpisodes"
  > & {
    assetLockRecords: NonNullable<WorkspaceState["assetLockRecords"]>;
    scriptSourceBindings: NonNullable<WorkspaceState["scriptSourceBindings"]>;
  };
  auth: Awaited<ReturnType<typeof authScopeDbRepository.readDbAuthScopeSnapshot>>;
  assetLock: Awaited<ReturnType<typeof assetLockRecordDbParts.readDbAssetLockRecordParts>>;
  delivery: deliveryPackageDbRepository.DeliveryPackageDbSnapshot;
} {
  const localUser: WorkspaceState["users"][number] = {
    id: "user-local-stale",
    name: "Local Stale User",
    defaultRole: "writer",
    avatarTone: "gray"
  };
  const dbUser: WorkspaceState["users"][number] = {
    id: "user-db-overlay",
    name: "DB Overlay User",
    defaultRole: "head_writer",
    avatarTone: "violet"
  };
  const localProject: WorkspaceState["projects"][number] = {
    id: "project-local-stale",
    name: "Local Stale",
    code: "LS",
    episodeCount: 1,
    status: "active",
    createdAt: "2026-05-29T00:00:00.000Z"
  };
  const dbProject: WorkspaceState["projects"][number] = {
    id: "project-db-overlay",
    name: "DB Overlay",
    code: "DB",
    episodeCount: 2,
    status: "active",
    createdAt: "2026-05-30T00:00:00.000Z"
  };
  const localEpisode: WorkspaceState["episodes"][number] = {
    id: "episode-local-stale-1",
    projectId: localProject.id,
    episodeNo: 1,
    title: "Local stale episode",
    productionStatus: "not_started",
    hasUnreadKeyChange: false,
    openIssueCount: 0,
    assetTodoCount: 0
  };
  const dbEpisode: WorkspaceState["episodes"][number] = {
    id: "episode-db-overlay-1",
    projectId: dbProject.id,
    episodeNo: 1,
    title: "DB overlay episode",
    productionStatus: "key_update",
    hasUnreadKeyChange: true,
    openIssueCount: 1,
    assetTodoCount: 1
  };
  const localMember: WorkspaceState["members"][number] = {
    id: "member-local-stale",
    projectId: localProject.id,
    userId: localUser.id,
    role: "writer",
    createdAt: "2026-05-29T00:00:00.000Z"
  };
  const dbMember: WorkspaceState["members"][number] = {
    id: "member-db-overlay",
    projectId: dbProject.id,
    userId: dbUser.id,
    role: "head_writer",
    createdAt: "2026-05-30T00:00:00.000Z"
  };
  const localPermission: WorkspaceState["memberPermissions"][number] = {
    id: "permission-local-stale",
    projectId: localProject.id,
    userId: localUser.id,
    permission: "canViewAssignedEpisodes",
    grantedAt: "2026-05-29T00:00:00.000Z"
  };
  const dbPermission: WorkspaceState["memberPermissions"][number] = {
    id: "permission-db-overlay",
    projectId: dbProject.id,
    userId: dbUser.id,
    permission: "canReviewAssets",
    grantedAt: "2026-05-30T00:00:00.000Z"
  };
  const localAssignment: WorkspaceState["assignments"][number] = {
    id: "assignment-local-stale",
    episodeId: localEpisode.id,
    userId: localUser.id,
    responsibility: "writer",
    createdAt: "2026-05-29T00:00:00.000Z"
  };
  const dbAssignment: WorkspaceState["assignments"][number] = {
    id: "assignment-db-overlay",
    episodeId: dbEpisode.id,
    userId: dbUser.id,
    responsibility: "writer",
    createdAt: "2026-05-30T00:00:00.000Z"
  };
  const localRecord: NonNullable<WorkspaceState["assetLockRecords"]>[number] = {
    id: "asset-lock-local-stale",
    projectId: localProject.id,
    deliveryPackageId: localDeliveryPackageId,
    episodeNos: [1],
    assetName: "Local stale asset",
    assetType: "scene",
    changeType: "new",
    writerConfirmation: "pending",
    productionConfirmation: "pending",
    risk: "attention",
    status: "draft",
    createdByUserId: localUser.id,
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:00:00.000Z"
  };
  const dbRecord: NonNullable<WorkspaceState["assetLockRecords"]>[number] = {
    ...localRecord,
    id: "asset-lock-db-overlay",
    projectId: dbProject.id,
    deliveryPackageId: "delivery-db-overlay",
    assetName: "DB overlay asset",
    createdByUserId: dbUser.id,
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z"
  };
  const localBinding: NonNullable<WorkspaceState["scriptSourceBindings"]>[number] = {
    id: "source-binding-local-stale",
    projectId: localProject.id,
    deliveryPackageId: localDeliveryPackageId,
    assetLockRecordId: localRecord.id,
    episodeNo: 1,
    startLine: 1,
    endLine: 1,
    excerptSnapshot: "local stale source",
    createdByUserId: localUser.id,
    createdAt: "2026-05-29T00:00:00.000Z"
  };
  const dbBinding: NonNullable<WorkspaceState["scriptSourceBindings"]>[number] = {
    id: "source-binding-db-overlay",
    projectId: dbProject.id,
    deliveryPackageId: "delivery-db-overlay",
    assetLockRecordId: dbRecord.id,
    episodeNo: 1,
    startLine: 1,
    endLine: 1,
    excerptSnapshot: "db overlay source",
    createdByUserId: dbUser.id,
    createdAt: "2026-05-30T00:00:00.000Z"
  };

  return {
    local: {
      currentUserId: dbUser.id,
      users: [localUser],
      projects: [localProject],
      members: [localMember],
      memberPermissions: [localPermission],
      episodes: [localEpisode],
      assignments: [localAssignment],
      assetLockRecords: [localRecord],
      scriptSourceBindings: [localBinding],
      deliveryPackages: [
        {
          id: localDeliveryPackageId,
          projectId: localProject.id,
          type: "range",
          title: "Local stale package",
          declaredEpisodeFrom: 1,
          declaredEpisodeTo: 1,
          status: "draft",
          uploadedByUserId: localUser.id,
          createdAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      deliveryPackageEpisodes: [
        {
          id: "delivery-local-stale-episode-1",
          deliveryPackageId: localDeliveryPackageId,
          episodeNo: 1,
          title: "Local stale package episode",
          content: "local stale package source",
          isConfirmedChange: true
        }
      ]
    },
    auth: {
      users: [dbUser],
      projects: [dbProject],
      members: [dbMember],
      memberPermissions: [dbPermission],
      episodes: [dbEpisode],
      assignments: [dbAssignment]
    },
    assetLock: {
      assetLockRecords: [dbRecord],
      scriptSourceBindings: [dbBinding]
    },
    delivery: {
      deliveryPackages: [
        {
          id: "delivery-db-overlay",
          projectId: dbProject.id,
          type: "range",
          title: "DB overlay package",
          declaredEpisodeFrom: 1,
          declaredEpisodeTo: 1,
          status: "draft",
          uploadedByUserId: dbUser.id,
          createdAt: "2026-05-30T00:00:00.000Z"
        }
      ],
      deliveryPackageEpisodes: [
        {
          id: "delivery-episode-db-overlay-1",
          deliveryPackageId: "delivery-db-overlay",
          episodeNo: 1,
          title: "DB episode",
          content: "DB overlay source",
          isConfirmedChange: true
        }
      ]
    }
  };
}

function bytes(...chunks: Uint8Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });

  return output;
}

function u16(value: number) {
  const output = new Uint8Array(2);
  new DataView(output.buffer).setUint16(0, value, true);
  return output;
}

function u32(value: number) {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, true);
  return output;
}
