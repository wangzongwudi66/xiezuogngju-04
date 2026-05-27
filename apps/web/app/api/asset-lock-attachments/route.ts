import { NextResponse } from "next/server";
import type { AssetAttachmentType } from "@aigc/domain";
import { requireWorkspaceRequestActor } from "../workspace-actor";
import { listAssetAttachments, uploadAssetAttachment } from "./service";
import type { AssetAttachmentUploadInput } from "./service";

const attachmentTypes: AssetAttachmentType[] = ["reference", "production", "final"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const recordId = searchParams.get("recordId")?.trim();

  if (!recordId) {
    return NextResponse.json({ error: "asset_attachment_record_id_required" }, { status: 400 });
  }

  try {
    const actor = await requireWorkspaceRequestActor("asset_attachment_unauthenticated");
    return NextResponse.json({ attachments: await listAssetAttachments(recordId, actor) });
  } catch (error) {
    return attachmentErrorResponse(errorCodeFromUnknown(error, "asset_attachment_list_failed"));
  }
}

export async function POST(request: Request) {
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_asset_attachment_request" }, { status: 400 });
  }

  const parsed = await parseUploadRequest(form);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const actor = await requireWorkspaceRequestActor("asset_attachment_unauthenticated");
    const attachment = await uploadAssetAttachment(parsed.input, actor);
    return NextResponse.json({ attachment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "asset attachment upload failed";
    const errorCode = message.startsWith("asset_attachment_") ? message : "asset_attachment_upload_failed";

    return NextResponse.json(
      {
        error: errorCode,
        message
      },
      { status: statusForAttachmentError(errorCode) }
    );
  }
}

async function parseUploadRequest(
  form: FormData
): Promise<
  | { ok: true; input: AssetAttachmentUploadInput }
  | { ok: false; error: "asset_attachment_file_required" | "invalid_asset_attachment_request" }
> {
  const assetLockRecordId = readString(form.get("assetLockRecordId"));
  const attachmentType = readAttachmentType(form.get("attachmentType"));
  const note = readOptionalString(form.get("note"));
  const file = form.get("file");

  if (!(file instanceof File)) {
    return { ok: false, error: "asset_attachment_file_required" };
  }

  if (!assetLockRecordId || !attachmentType) {
    return { ok: false, error: "invalid_asset_attachment_request" };
  }

  return {
    ok: true,
    input: {
      assetLockRecordId,
      attachmentType,
      note,
      fileName: file.name,
      mime: file.type,
      fileBuffer: await file.arrayBuffer()
    }
  };
}

function readString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: FormDataEntryValue | null) {
  const text = readString(value);
  return text || undefined;
}

function readAttachmentType(value: FormDataEntryValue | null) {
  const text = readString(value);
  return attachmentTypes.includes(text as AssetAttachmentType) ? (text as AssetAttachmentType) : null;
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
    case "asset_attachment_record_id_required":
      return 400;
    case "asset_attachment_unauthenticated":
      return 401;
    case "asset_attachment_project_member_required":
    case "asset_attachment_forbidden":
      return 403;
    case "asset_attachment_record_not_found":
      return 404;
    default:
      return 400;
  }
}
