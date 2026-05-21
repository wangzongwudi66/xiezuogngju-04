import { randomUUID } from "node:crypto";
import { parseWordDelivery, parseWordDeliveryText } from "@aigc/domain";
import type { DeliveryPackageDraftInput, WordDeliveryIssue } from "@aigc/domain";
import { buildDeliveryPackageDraftFromParsed } from "../../ui/delivery-text-parser";
import type { DeliveryImportJob } from "../../ui/workspace-persistence";
import {
  readDeliveryImportJobResult,
  readDeliveryImportJobs,
  readDeliveryImportJobFile,
  readDeliveryImportWorkspace,
  saveDeliveryImportJobFile,
  saveDeliveryImportJobResultWithDraft
} from "./persistence";

export type DeliveryImportSource = "docx" | "text";

export interface DeliveryImportJobRequest {
  declaredRangeText: string;
  projectId: string;
  source: DeliveryImportSource;
  uploadedByUserId: string;
  fileName?: string;
  rawText?: string;
  fileBuffer?: ArrayBuffer | Uint8Array;
}

interface DeliveryImportJobRunOptions {
  createdAt?: string;
  fileId?: string;
  retryOfJobId?: string;
}

export type DeliveryImportJobRetryResponse =
  | DeliveryImportJobResponse
  | {
      ok: false;
      error: "delivery_import_job_not_found" | "delivery_import_job_file_id_missing" | "delivery_import_job_file_missing";
    };

export type DeliveryImportJobResponse =
  | {
      ok: true;
      draft: DeliveryPackageDraftInput;
      issues: WordDeliveryIssue[];
      job: DeliveryImportJob;
    }
  | {
      ok: false;
      issues: WordDeliveryIssue[];
      remedies: string[];
      job: DeliveryImportJob;
    };

export async function createDeliveryImportJob(input: DeliveryImportJobRequest) {
  const createdAt = new Date().toISOString();
  let fileId: string | undefined;

  if (input.source === "docx") {
    fileId = createImportFileId(createdAt);
    await saveDeliveryImportJobFile({
      fileId,
      fileBuffer: input.fileBuffer ?? new ArrayBuffer(0)
    });
  }

  const result = await runDeliveryImportJob(input, { createdAt, fileId });
  return saveDeliveryImportJobResultWithDraft(result);
}

export async function getDeliveryImportJobResult(jobId: string) {
  return readDeliveryImportJobResult(jobId);
}

export async function retryDeliveryImportJob(jobId: string): Promise<DeliveryImportJobRetryResponse> {
  const sourceResult = await readDeliveryImportJobResult(jobId);

  if (!sourceResult) {
    return { ok: false, error: "delivery_import_job_not_found" };
  }

  const sourceJob = sourceResult.job;

  if (!sourceJob.fileId) {
    return { ok: false, error: "delivery_import_job_file_id_missing" };
  }

  const fileBuffer = await readDeliveryImportJobFile(sourceJob.fileId);

  if (!fileBuffer) {
    return { ok: false, error: "delivery_import_job_file_missing" };
  }

  const result = await runDeliveryImportJob(
    {
      source: "docx",
      projectId: sourceJob.projectId,
      uploadedByUserId: sourceJob.uploadedByUserId ?? "",
      declaredRangeText: sourceJob.declaredRangeText,
      fileName: sourceJob.fileName,
      fileBuffer
    },
    {
      fileId: sourceJob.fileId,
      retryOfJobId: sourceJob.id
    }
  );

  return saveDeliveryImportJobResultWithDraft(result);
}

export async function listDeliveryImportJobs(projectId?: string) {
  return readDeliveryImportJobs(projectId);
}

export async function getDeliveryImportWorkspace() {
  return readDeliveryImportWorkspace();
}

export async function runDeliveryImportJob(
  input: DeliveryImportJobRequest,
  options: DeliveryImportJobRunOptions = {}
): Promise<DeliveryImportJobResponse> {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const jobBase: DeliveryImportJob = {
    id: createImportJobId(input.source, createdAt),
    projectId: input.projectId,
    source: input.source,
    status: "processing",
    fileName: input.fileName ?? (input.source === "docx" ? "uploaded.docx" : "pasted-word-text.txt"),
    fileId: options.fileId,
    uploadedByUserId: input.uploadedByUserId,
    retryOfJobId: options.retryOfJobId,
    declaredRangeText: input.declaredRangeText,
    createdAt
  };

  const parsed =
    input.source === "docx"
      ? await parseWordDelivery(input.fileBuffer ?? new ArrayBuffer(0), {
          declaredRange: input.declaredRangeText.trim() || undefined,
          fileName: jobBase.fileName
        })
      : parseWordDeliveryText(input.rawText ?? "", {
          declaredRange: input.declaredRangeText.trim() || undefined,
          fileName: jobBase.fileName
        });

  if (!parsed.ok) {
    const issues = [...parsed.warnings, ...parsed.errors];
    return {
      ok: false,
      issues,
      remedies: parsed.remedies,
      job: {
        ...jobBase,
        status: "failed",
        completedAt: new Date().toISOString(),
        issueCount: issues.length,
        errorText: issues[0]?.message ?? "解析失败"
      }
    };
  }

  const built = buildDeliveryPackageDraftFromParsed({
    projectId: input.projectId,
    uploadedByUserId: input.uploadedByUserId,
    sourceFileName: jobBase.fileName,
    parsed
  });

  return {
    ok: true,
    draft: built.draft,
    issues: built.issues,
    job: {
      ...jobBase,
      status: "success",
      completedAt: new Date().toISOString(),
      issueCount: built.issues.length
    }
  };
}

function createImportJobId(source: DeliveryImportSource, createdAt: string) {
  return `import-${source}-${Date.parse(createdAt).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createImportFileId(createdAt: string) {
  return `file-${Date.parse(createdAt).toString(36)}-${randomUUID()}`;
}
