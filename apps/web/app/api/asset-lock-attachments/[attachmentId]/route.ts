import { NextResponse } from "next/server";
import type { AssetAttachment } from "@aigc/domain";
import { requireWorkspaceRequestActor } from "../../workspace-actor";
import { assetAttachmentErrorCodeFromUnknown, attachmentErrorResponse } from "../errors";
import { deleteAssetAttachment, downloadAssetAttachment } from "../service";

type AttachmentRouteContext = {
  params: Promise<{ attachmentId?: string }> | { attachmentId?: string };
};

export async function GET(request: Request, context: AttachmentRouteContext) {
  const attachmentId = await readAttachmentId(context);

  if (!attachmentId) {
    return attachmentErrorResponse("asset_attachment_id_required");
  }

  try {
    const actor = await requireWorkspaceRequestActor(request, "asset_attachment_unauthenticated");
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
    return attachmentErrorResponse(assetAttachmentErrorCodeFromUnknown(error));
  }
}

export async function DELETE(request: Request, context: AttachmentRouteContext) {
  const attachmentId = await readAttachmentId(context);

  if (!attachmentId) {
    return attachmentErrorResponse("asset_attachment_id_required");
  }

  try {
    const actor = await requireWorkspaceRequestActor(request, "asset_attachment_unauthenticated");
    const attachment = await deleteAssetAttachment(attachmentId, actor);
    return NextResponse.json({ attachment });
  } catch (error) {
    return attachmentErrorResponse(assetAttachmentErrorCodeFromUnknown(error));
  }
}

async function readAttachmentId(context: AttachmentRouteContext) {
  const params = await context.params;
  return params.attachmentId?.trim() || "";
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
