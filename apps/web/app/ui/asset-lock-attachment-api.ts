import type { AssetAttachment, AssetAttachmentType } from "@aigc/domain";

export type AssetLockAttachmentListResponse = {
  attachments: AssetAttachment[];
};

export type AssetLockAttachmentUploadResponse = {
  attachment: AssetAttachment;
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

export function formatAssetAttachmentError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (message.includes("asset_attachment_record_id_required")) {
    return "缺少资产记录 ID，无法读取附件。请刷新页面后重试。";
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
