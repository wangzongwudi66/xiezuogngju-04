import { NextResponse } from "next/server";

const canonicalPrefixErrorCodes = new Set([
  "asset_attachment_file_integrity_failed",
  "asset_attachment_storage_verification_failed"
]);

const statusByAttachmentError = {
  asset_attachment_delete_forbidden: 403,
  asset_attachment_file_empty: 400,
  asset_attachment_file_id_invalid: 400,
  asset_attachment_file_integrity_failed: 409,
  asset_attachment_file_not_found: 404,
  asset_attachment_file_required: 400,
  asset_attachment_file_too_large: 400,
  asset_attachment_file_type_invalid: 400,
  asset_attachment_forbidden: 403,
  asset_attachment_id_required: 400,
  asset_attachment_locked_record_delete_forbidden: 409,
  asset_attachment_locked_record_upload_forbidden: 409,
  asset_attachment_metadata_conflict: 400,
  asset_attachment_metadata_not_created: 500,
  asset_attachment_not_found: 404,
  asset_attachment_project_member_required: 403,
  asset_attachment_record_id_required: 400,
  asset_attachment_record_mismatch: 409,
  asset_attachment_record_not_found: 404,
  asset_attachment_request_failed: 400,
  asset_attachment_storage_verification_failed: 502,
  asset_attachment_unauthenticated: 401,
  asset_attachment_version_conflict: 400
} as const;

export type AssetAttachmentRouteErrorCode = keyof typeof statusByAttachmentError;

const allowedAttachmentErrorCodes = new Set<AssetAttachmentRouteErrorCode>(
  Object.keys(statusByAttachmentError) as AssetAttachmentRouteErrorCode[]
);

export function attachmentErrorResponse(error: AssetAttachmentRouteErrorCode, includeMessage = false) {
  return NextResponse.json(
    includeMessage ? { error, message: error } : { error },
    { status: statusForAttachmentError(error) }
  );
}

export function assetAttachmentErrorCodeFromUnknown(
  error: unknown,
  fallback: AssetAttachmentRouteErrorCode = "asset_attachment_request_failed"
): AssetAttachmentRouteErrorCode {
  const message = error instanceof Error ? error.message : "";
  const code = canonicalAttachmentErrorCode(message);

  return code ?? fallback;
}

function canonicalAttachmentErrorCode(message: string): AssetAttachmentRouteErrorCode | null {
  if (allowedAttachmentErrorCodes.has(message as AssetAttachmentRouteErrorCode)) {
    return message as AssetAttachmentRouteErrorCode;
  }

  for (const code of canonicalPrefixErrorCodes) {
    if (message === code || message.startsWith(`${code} `) || message.startsWith(`${code}:`)) {
      return code as AssetAttachmentRouteErrorCode;
    }
  }

  return null;
}

function statusForAttachmentError(error: AssetAttachmentRouteErrorCode) {
  return statusByAttachmentError[error];
}
