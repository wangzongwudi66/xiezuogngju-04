import type { DeliveryImportJobResponse, DeliveryImportJobRetryResponse } from "../api/delivery-import-jobs/service";
import type { DeliveryImportJob } from "./workspace-persistence";
import type { M2WorkspacePersistenceSnapshot } from "./workspace-persistence";

type DeliveryWorkspaceSnapshot = Pick<M2WorkspacePersistenceSnapshot, "state" | "deliveryParseIssuesByPackageId">;

export type DeliveryPackageMutationInput =
  | {
      action: "update_confirmation";
      confirmedEpisodeNos: number[];
      deliveryPackageId: string;
    }
  | {
      action: "submit";
      actorUserId: string;
      deliveryPackageId: string;
    }
  | {
      action: "publish";
      actorUserId: string;
      deliveryPackageId: string;
    }
  | {
      action: "reject";
      actorUserId: string;
      deliveryPackageId: string;
      rejectionReason: string;
    };

export interface SubmitTextDeliveryImportInput {
  declaredRangeText: string;
  projectId: string;
  rawText: string;
  uploadedByUserId: string;
}

export interface SubmitDocxDeliveryImportInput {
  declaredRangeText: string;
  file: File;
  projectId: string;
  uploadedByUserId: string;
}

export async function submitTextDeliveryImport(input: SubmitTextDeliveryImportInput) {
  const form = new FormData();
  form.set("source", "text");
  form.set("projectId", input.projectId);
  form.set("uploadedByUserId", input.uploadedByUserId);
  form.set("declaredRangeText", input.declaredRangeText);
  form.set("rawText", input.rawText);

  return postDeliveryImport(form) as Promise<DeliveryImportJobResponse>;
}

export async function submitDocxDeliveryImport(input: SubmitDocxDeliveryImportInput) {
  const form = new FormData();
  form.set("source", "docx");
  form.set("projectId", input.projectId);
  form.set("uploadedByUserId", input.uploadedByUserId);
  form.set("declaredRangeText", input.declaredRangeText);
  form.set("file", input.file);

  return postDeliveryImport(form) as Promise<DeliveryImportJobResponse>;
}

export async function retryDocxDeliveryImport(jobId: string): Promise<DeliveryImportJobRetryResponse> {
  const form = new FormData();
  form.set("action", "retry");
  form.set("jobId", jobId);

  return postDeliveryImport(form) as Promise<DeliveryImportJobRetryResponse>;
}

export async function fetchDeliveryImportJob(jobId: string): Promise<DeliveryImportJobResponse> {
  const response = await fetch(`/api/delivery-import-jobs?id=${encodeURIComponent(jobId)}`);

  if (!response.ok) {
    throw new Error("delivery_import_job_not_found");
  }

  return (await response.json()) as DeliveryImportJobResponse;
}

export async function fetchDeliveryImportJobs(projectId: string): Promise<{ jobs: DeliveryImportJob[] }> {
  const response = await fetch(`/api/delivery-import-jobs?projectId=${encodeURIComponent(projectId)}`);

  if (!response.ok) {
    throw new Error("delivery_import_jobs_request_failed");
  }

  return (await response.json()) as { jobs: DeliveryImportJob[] };
}

export async function fetchDeliveryImportWorkspace(): Promise<DeliveryWorkspaceSnapshot> {
  const response = await fetch("/api/delivery-import-jobs?scope=workspace");

  if (!response.ok) {
    throw new Error("delivery_import_workspace_request_failed");
  }

  return (await response.json()) as DeliveryWorkspaceSnapshot;
}

export async function mutateDeliveryPackageState(input: DeliveryPackageMutationInput): Promise<DeliveryWorkspaceSnapshot> {
  const response = await fetch("/api/delivery-packages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await readDeliveryApiError(response, "delivery_package_mutation_request_failed"));
  }

  return (await response.json()) as DeliveryWorkspaceSnapshot;
}

async function postDeliveryImport(form: FormData): Promise<DeliveryImportJobResponse | DeliveryImportJobRetryResponse> {
  const response = await fetch("/api/delivery-import-jobs", {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    throw new Error(await readDeliveryApiError(response, "delivery_import_request_failed"));
  }

  return (await response.json()) as DeliveryImportJobResponse | DeliveryImportJobRetryResponse;
}

async function readDeliveryApiError(response: Response, fallback: string) {
  const payload = await readJsonSafely(response);

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    const message = record.message;

    if (typeof error === "string" && error.trim()) {
      return error;
    }

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
