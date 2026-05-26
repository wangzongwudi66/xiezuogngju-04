import type { AssetAttachment, AssetAttachmentType } from "@aigc/domain";

export type AssetLockAttachmentListResponse = {
  attachments: AssetAttachment[];
};

export type AssetLockAttachmentUploadResponse = {
  attachment: AssetAttachment;
};

export type AssetLockAttachmentDeleteResponse = {
  attachment: AssetAttachment;
};

export type AssetLockAttachmentDownloadResponse = {
  blob: Blob;
  fileName: string;
  mime: string;
  size: number;
};

export type AssetLockAttachmentUploadInput = {
  assetLockRecordId: string;
  attachmentType: AssetAttachmentType;
  file: File;
  note?: string;
  uploadedByUserId: string;
};

export async function fetchAssetLockAttachments(assetLockRecordId: string): Promise<AssetLockAttachmentListResponse> {
  const response = await fetch(`/api/asset-lock-attachments?recordId=${encodeURIComponent(assetLockRecordId)}`);

  if (!response.ok) {
    throw new Error(await readAssetAttachmentApiError(response, "asset_attachment_list_failed"));
  }

  return (await response.json()) as AssetLockAttachmentListResponse;
}

export async function uploadAssetLockAttachment(input: AssetLockAttachmentUploadInput): Promise<AssetLockAttachmentUploadResponse> {
  const form = new FormData();
  form.set("assetLockRecordId", input.assetLockRecordId);
  form.set("uploadedByUserId", input.uploadedByUserId);
  form.set("attachmentType", input.attachmentType);
  form.set("file", input.file);

  if (input.note?.trim()) {
    form.set("note", input.note.trim());
  }

  const response = await fetch("/api/asset-lock-attachments", {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    throw new Error(await readAssetAttachmentApiError(response, "asset_attachment_upload_failed"));
  }

  return (await response.json()) as AssetLockAttachmentUploadResponse;
}

export async function downloadAssetLockAttachment(attachmentId: string): Promise<AssetLockAttachmentDownloadResponse> {
  const response = await fetch(`/api/asset-lock-attachments/${encodeURIComponent(attachmentId)}`);

  if (!response.ok) {
    throw new Error(await readAssetAttachmentApiError(response, "asset_attachment_download_failed"));
  }

  const blob = await response.blob();
  const mime = response.headers.get("content-type") || blob.type;

  return {
    blob,
    fileName: fileNameFromContentDisposition(response.headers.get("content-disposition")) || "attachment",
    mime,
    size: readContentLength(response.headers.get("content-length")) ?? blob.size
  };
}

export async function deleteAssetLockAttachment(attachmentId: string): Promise<AssetLockAttachmentDeleteResponse> {
  const response = await fetch(`/api/asset-lock-attachments/${encodeURIComponent(attachmentId)}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await readAssetAttachmentApiError(response, "asset_attachment_delete_failed"));
  }

  return (await response.json()) as AssetLockAttachmentDeleteResponse;
}

export function formatAssetAttachmentError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (/failed to fetch|fetch failed|networkerror/i.test(message)) {
    return "资产附件操作失败，请稍后重试。";
  }

  if (message.includes("asset_attachment_id_required")) {
    return "缺少附件 ID，无法完成操作。请刷新页面后重试。";
  }

  if (message.includes("asset_attachment_record_id_required")) {
    return "缺少资产记录 ID，无法读取附件。请刷新页面后重试。";
  }

  if (
    message.includes("asset_attachment_unauthenticated") ||
    message.includes("asset_attachment_project_member_required") ||
    message.includes("asset_attachment_forbidden")
  ) {
    return "当前账号无权访问该资产附件。";
  }

  if (message.includes("asset_attachment_delete_forbidden")) {
    return "当前账号无权删除该资产附件。";
  }

  if (message.includes("asset_attachment_locked_record_delete_forbidden")) {
    return "资产已定版，附件不能删除。";
  }

  if (
    message.includes("asset_attachment_not_found") ||
    message.includes("asset_attachment_record_not_found") ||
    message.includes("asset_attachment_file_not_found")
  ) {
    return "资产附件不存在或已失效。";
  }

  if (message.includes("asset_attachment_record_mismatch")) {
    return "资产附件关联记录异常，请刷新页面后重试。";
  }

  if (message.includes("asset_attachment_list_failed")) {
    return "资产附件列表加载失败，请稍后重试。";
  }

  if (message.includes("invalid_asset_attachment_request")) {
    return "附件上传信息不完整，请选择文件并确认附件类型。";
  }

  if (message.includes("asset_attachment_file_required")) {
    return "请选择要上传的附件文件。";
  }

  if (message.includes("asset_attachment_file_empty")) {
    return "附件文件为空，请重新选择。";
  }

  if (message.includes("asset_attachment_file_too_large")) {
    return "附件超过 20MB，请压缩后再上传。";
  }

  if (message.includes("asset_attachment_file_type_invalid")) {
    return "附件格式不支持。请上传 JPG、PNG、WEBP 或 PDF。";
  }

  if (message.includes("asset_attachment_upload_failed")) {
    return "资产附件上传失败，请检查记录状态和当前用户权限后重试。";
  }

  if (message.includes("asset_attachment_download_failed")) {
    return "资产附件下载失败，请稍后重试。";
  }

  if (message.includes("asset_attachment_delete_failed")) {
    return "资产附件删除失败，请检查记录状态和当前用户权限后重试。";
  }

  return message || "资产附件操作失败，请稍后重试。";
}

async function readAssetAttachmentApiError(response: Response, fallback: string) {
  const payload = await readJsonSafely(response);

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = record.message;
    const error = record.error;

    if (typeof message === "string" && message.trim()) {
      return message;
    }

    if (typeof error === "string" && error.trim()) {
      return error;
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

function readContentLength(value: string | null) {
  if (!value) {
    return null;
  }

  const size = Number.parseInt(value, 10);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function fileNameFromContentDisposition(value: string | null) {
  if (!value) {
    return "";
  }

  const utf8Name = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];

  if (utf8Name) {
    try {
      return decodeURIComponent(utf8Name);
    } catch {
      return utf8Name;
    }
  }

  return value.match(/filename="([^"]+)"/i)?.[1] ?? "";
}
