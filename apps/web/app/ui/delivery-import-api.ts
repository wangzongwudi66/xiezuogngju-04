import type { DeliveryImportJobResponse } from "../api/delivery-import-jobs/service";
import type { DeliveryImportJob } from "./workspace-persistence";

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

  return postDeliveryImport(form);
}

export async function submitDocxDeliveryImport(input: SubmitDocxDeliveryImportInput) {
  const form = new FormData();
  form.set("source", "docx");
  form.set("projectId", input.projectId);
  form.set("uploadedByUserId", input.uploadedByUserId);
  form.set("declaredRangeText", input.declaredRangeText);
  form.set("file", input.file);

  return postDeliveryImport(form);
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

async function postDeliveryImport(form: FormData): Promise<DeliveryImportJobResponse> {
  const response = await fetch("/api/delivery-import-jobs", {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    throw new Error("delivery_import_request_failed");
  }

  return (await response.json()) as DeliveryImportJobResponse;
}
