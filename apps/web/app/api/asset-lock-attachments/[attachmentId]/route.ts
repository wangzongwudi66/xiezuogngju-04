import { NextResponse } from "next/server";
import type { AssetAttachment } from "@aigc/domain";
import { requireWorkspaceRequestActor } from "../../workspace-actor";
import { deleteAssetAttachment, downloadAssetAttachment } from "../service";

type AttachmentRouteContext = {
  params: Promise<{ attachmentId?: string }> | { attachmentId?: string };
};

export async function GET(_request: Request, context: AttachmentRouteContext) {
  const attachmentId = await readAttachmentId(context);

  if (!attachmentId) {
    return attachmentErrorResponse("asset_attachment_id_required");
  }

  try {
    const actor = await requireWorkspaceRequestActor("asset_attachment_unauthenticated");
    const download = await downloadAssetAttachment(attachmentId, actor);

    return new Response(toArrayBuffer(download.bytes), {
      headers: {
        "Content-Disposition": contentDisposition(download.fileName),
        "Content-Length": String(download.size),
        "Content-Type": download.mime,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return attachmentErrorResponse(errorCodeFromUnknown(error, "asset_attachment_download_failed"));
  }
}

export async function DELETE(_request: Request, context: AttachmentRouteContext) {
  const attachmentId = await readAttachmentId(context);

  if (!attachmentId) {
    return attachmentErrorResponse("asset_attachment_id_required");
  }

  try {
    const actor = await requireWorkspaceRequestActor("asset_attachment_unauthenticated");
    const attachment = await deleteAssetAttachment(attachmentId, actor);
    return NextResponse.json({ attachment });
  } catch (error) {
    return attachmentErrorResponse(errorCodeFromUnknown(error, "asset_attachment_delete_failed"));
  }
}

async function readAttachmentId(context: AttachmentRouteContext) {
  const params = await context.params;
  return params.attachmentId?.trim() || "";
}

function attachmentErrorResponse(error: string) {
  return NextResponse.json({ error }, { status: statusForAttachmentError(error) });
}

function errorCodeFromUnknown(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith("asset_attachment_") ? message : fallback;
}

function statusForAttachmentError(error: string) {
  switch (error) {
    case "asset_attachment_id_required":
      return 400;
    case "asset_attachment_unauthenticated":
      return 401;
    case "asset_attachment_project_member_required":
    case "asset_attachment_forbidden":
    case "asset_attachment_delete_forbidden":
      return 403;
    case "asset_attachment_not_found":
    case "asset_attachment_record_not_found":
    case "asset_attachment_file_not_found":
      return 404;
    case "asset_attachment_locked_record_delete_forbidden":
    case "asset_attachment_record_mismatch":
      return 409;
    default:
      return 400;
  }
}

function contentDisposition(fileName: string) {
  const fallbackName = fileName.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_") || "attachment";
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeRfc5987ValueChars(fileName)}`;
}

function toArrayBuffer(bytes: Uint8Array) {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}

function encodeRfc5987ValueChars(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export type AssetAttachmentDeleteResponse = {
  attachment: AssetAttachment;
};
