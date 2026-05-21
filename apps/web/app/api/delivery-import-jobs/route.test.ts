import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";

describe("delivery import job route", () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-delivery-import-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storeDir, { recursive: true });
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
    process.env.AIGC_DELIVERY_IMPORT_FILE_DIR = join(storeDir, "files");
  });

  afterEach(async () => {
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    delete process.env.AIGC_DELIVERY_IMPORT_FILE_DIR;
    await rm(storeDir, { recursive: true, force: true });
  });

  it("creates a text import job and exposes it by id", async () => {
    const createResponse = await POST(new Request("http://localhost/api/delivery-import-jobs", { method: "POST", body: buildTextForm() }));
    const created = await createResponse.json();

    expect(createResponse.status).toBe(200);
    expect(created).toMatchObject({
      ok: true,
      job: {
        projectId: "project-jincheng",
        source: "text",
        status: "success"
      }
    });
    expect(created.job.deliveryPackageId).toBeTruthy();

    const readResponse = await GET(new Request(`http://localhost/api/delivery-import-jobs?id=${created.job.id}`));
    await expect(readResponse.json()).resolves.toEqual(created);
  });

  it("lists jobs by project and returns the server workspace snapshot", async () => {
    const createResponse = await POST(new Request("http://localhost/api/delivery-import-jobs", { method: "POST", body: buildTextForm() }));
    const created = await createResponse.json();

    const listResponse = await GET(new Request("http://localhost/api/delivery-import-jobs?projectId=project-jincheng"));
    const listed = await listResponse.json();

    expect(listed.jobs).toContainEqual(
      expect.objectContaining({
        id: created.job.id,
        deliveryPackageId: created.job.deliveryPackageId
      })
    );

    const workspaceResponse = await GET(new Request("http://localhost/api/delivery-import-jobs?scope=workspace"));
    const workspace = await workspaceResponse.json();

    expect(workspace.state.deliveryPackages).toContainEqual(
      expect.objectContaining({
        id: created.job.deliveryPackageId,
        projectId: "project-jincheng"
      })
    );
    expect(
      workspace.state.deliveryPackageEpisodes.filter((item: { deliveryPackageId: string }) => item.deliveryPackageId === created.job.deliveryPackageId)
    ).toHaveLength(2);
  });

  it("returns validation errors for invalid requests and missing jobs", async () => {
    const invalidResponse = await POST(
      new Request("http://localhost/api/delivery-import-jobs", { method: "POST", body: new FormData() })
    );
    const missingResponse = await GET(new Request("http://localhost/api/delivery-import-jobs?id=missing-job"));

    await expect(invalidResponse.json()).resolves.toEqual({ error: "invalid_delivery_import_request" });
    expect(invalidResponse.status).toBe(400);
    await expect(missingResponse.json()).resolves.toEqual({ error: "delivery_import_job_not_found" });
    expect(missingResponse.status).toBe(404);
  });

  it("rejects docx imports without a file and does not save anything", async () => {
    const response = await POST(
      new Request("http://localhost/api/delivery-import-jobs", { method: "POST", body: buildDocxForm() })
    );

    await expect(response.json()).resolves.toEqual({ error: "docx_file_required" });
    expect(response.status).toBe(400);
    await expect(readSavedFileNames(storeDir)).resolves.toEqual([]);
  });

  it("rejects non-docx uploads and does not save anything", async () => {
    const form = buildDocxForm();
    form.set("file", new File(["not a docx"], "delivery.pdf", { type: "application/pdf" }));
    const response = await POST(new Request("http://localhost/api/delivery-import-jobs", { method: "POST", body: form }));

    await expect(response.json()).resolves.toEqual({ error: "docx_file_type_invalid" });
    expect(response.status).toBe(400);
    await expect(readSavedFileNames(storeDir)).resolves.toEqual([]);
  });

  it("returns docx import jobs with file id but without the server file path", async () => {
    const form = buildDocxForm();
    form.set("file", new File(["not a zip"], "broken.docx"));
    const response = await POST(new Request("http://localhost/api/delivery-import-jobs", { method: "POST", body: form }));
    const created = await response.json();

    expect(response.status).toBe(200);
    expect(created).toMatchObject({
      ok: false,
      job: {
        source: "docx",
        status: "failed",
        fileId: expect.stringMatching(/^file-/)
      }
    });
    expect(created.job).not.toHaveProperty("filePath");
    await expect(readSavedFileNames(storeDir)).resolves.toHaveLength(1);
  });

  it("retries a docx import job from its saved file", async () => {
    const form = buildDocxForm();
    form.set("file", new File(["not a zip"], "broken.docx"));
    const createResponse = await POST(new Request("http://localhost/api/delivery-import-jobs", { method: "POST", body: form }));
    const failed = await createResponse.json();
    const retryResponse = await POST(
      new Request("http://localhost/api/delivery-import-jobs", { method: "POST", body: buildRetryForm(failed.job.id) })
    );
    const retried = await retryResponse.json();

    expect(retryResponse.status).toBe(200);
    expect(retried).toMatchObject({
      ok: false,
      job: {
        source: "docx",
        status: "failed",
        fileId: failed.job.fileId,
        retryOfJobId: failed.job.id
      }
    });
    expect(retried.job.id).not.toBe(failed.job.id);
    expect(retried.job).not.toHaveProperty("filePath");
  });

  it("returns clear retry errors for missing source jobs", async () => {
    const response = await POST(
      new Request("http://localhost/api/delivery-import-jobs", { method: "POST", body: buildRetryForm("missing-job") })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "delivery_import_job_not_found"
    });
  });
});

function buildDocxForm() {
  const form = new FormData();
  form.set("source", "docx");
  form.set("projectId", "project-jincheng");
  form.set("uploadedByUserId", "user-head-writer");
  form.set("declaredRangeText", "1-2");
  return form;
}

function buildRetryForm(jobId: string) {
  const form = new FormData();
  form.set("action", "retry");
  form.set("jobId", jobId);
  return form;
}

function buildTextForm() {
  const form = new FormData();
  form.set("source", "text");
  form.set("projectId", "project-jincheng");
  form.set("uploadedByUserId", "user-head-writer");
  form.set("declaredRangeText", "1-2");
  form.set("rawText", "第 1 集 开场\n正文一\n第 2 集 追踪\n正文二");
  return form;
}

async function readSavedFileNames(storeDir: string) {
  try {
    return await readdir(join(storeDir, "files"));
  } catch {
    return [];
  }
}
