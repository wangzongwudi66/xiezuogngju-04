import type { DeliveryImportJob } from "./workspace-persistence";

export function canRetryDeliveryImportJob(job: DeliveryImportJob) {
  return job.source === "docx" && job.status === "failed" && Boolean(job.fileId);
}

export function formatDeliveryImportError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (message.includes("delivery_import_workspace_request_failed")) {
    return "交稿包数据刷新失败，页面已保留当前状态，请稍后再试。";
  }

  if (message.includes("delivery_import_job_not_found")) {
    return "原解析记录不存在，请刷新后重试。";
  }

  if (message.includes("delivery_import_job_file_id_missing")) {
    return "这条记录没有可重试文件，请重新上传 Word。";
  }

  if (message.includes("delivery_import_job_file_missing")) {
    return "原始 Word 文件已丢失，请重新上传。";
  }

  if (message.includes("delivery_import_request_failed")) {
    return "解析请求失败，请稍后重试。";
  }

  return "";
}
