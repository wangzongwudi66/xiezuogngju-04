import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAssetAttachmentMetadata, listAssetAttachmentsForRecord, selectPrimaryRole, softDeleteAssetAttachment } from "@aigc/domain";
import type { AssetAttachment, AssetAttachmentType, AssetLockRecord, EpisodeAssignment, ProjectRole, WorkspaceState } from "@aigc/domain";
import { mutateDeliveryImportWorkspace, readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import type { WorkspaceRequestActor } from "../workspace-actor";

const attachmentFileDirEnvKey = "AIGC_ASSET_LOCK_ATTACHMENT_FILE_DIR";
const defaultAttachmentFileDir = path.join(process.cwd(), ".local-data", "asset-lock-attachments");
const maxAttachmentBytes = 20 * 1024 * 1024;
const allowedAttachmentTypes: Record<string, { extension: string; mime: string }> = {
  ".jpg": { extension: ".jpg", mime: "image/jpeg" },
  ".jpeg": { extension: ".jpeg", mime: "image/jpeg" },
  ".png": { extension: ".png", mime: "image/png" },
  ".webp": { extension: ".webp", mime: "image/webp" },
  ".pdf": { extension: ".pdf", mime: "application/pdf" }
};

export interface AssetAttachmentUploadInput {
  assetLockRecordId: string;
  attachmentType: AssetAttachmentType;
  note?: string;
  fileName: string;
  mime: string;
  fileBuffer: ArrayBuffer | Uint8Array;
}

export interface AssetAttachmentDownload {
  bytes: Uint8Array;
  fileName: string;
  mime: string;
  size: number;
}

export async function uploadAssetAttachment(
  input: AssetAttachmentUploadInput,
  actor: WorkspaceRequestActor,
  options: {
    persistMetadata?: typeof mutateDeliveryImportWorkspace;
  } = {}
): Promise<AssetAttachment> {
  const bytes = input.fileBuffer instanceof Uint8Array ? input.fileBuffer : new Uint8Array(input.fileBuffer);
  const fileRule = validateAttachmentFile({
    fileName: input.fileName,
    mime: input.mime,
    size: bytes.byteLength
  });
  const fileId = createAssetAttachmentFileId();
  const metadataInput = {
    assetLockRecordId: input.assetLockRecordId,
    fileId,
    fileName: input.fileName,
    mime: fileRule.mime,
    size: bytes.byteLength,
    attachmentType: input.attachmentType,
    uploadedByUserId: actor.userId,
    note: input.note
  };

  const workspace = await readDeliveryImportWorkspace();
  assertKnownActor(workspace.state, actor);
  requireVisibleRecordAccess(workspace.state, input.assetLockRecordId, actor);
  createAssetAttachmentMetadata(workspace.state, metadataInput);
  const filePath = resolveAssetAttachmentFilePath(fileId, fileRule.extension);
  const persistMetadata = options.persistMetadata ?? mutateDeliveryImportWorkspace;

  await mkdir(/* turbopackIgnore: true */ path.dirname(filePath), { recursive: true });
  await writeFile(/* turbopackIgnore: true */ filePath, bytes);

  try {
    const snapshot = await persistMetadata((state) => createAssetAttachmentMetadata(state, metadataInput));
    const attachment = findCreatedAttachment(snapshot.state, fileId);

    if (!attachment) {
      throw new Error("asset_attachment_metadata_not_created");
    }

    return attachment;
  } catch (error) {
    await rm(/* turbopackIgnore: true */ filePath, { force: true });
    throw error;
  }
}

export async function listAssetAttachments(recordId: string, actor: WorkspaceRequestActor) {
  const workspace = await readDeliveryImportWorkspace();
  const { record } = requireVisibleRecordAccess(workspace.state, recordId, actor);
  return listAssetAttachmentsForRecord(workspace.state, record.id);
}

export async function downloadAssetAttachment(attachmentId: string, actor: WorkspaceRequestActor): Promise<AssetAttachmentDownload> {
  const workspace = await readDeliveryImportWorkspace();
  const { attachment } = requireActiveAttachmentAccess(workspace.state, attachmentId, actor);
  const filePath = resolveAssetAttachmentFilePath(attachment.fileId, path.extname(attachment.fileName));
  let bytes: Uint8Array;

  try {
    bytes = await readFile(/* turbopackIgnore: true */ filePath);
  } catch {
    throw new Error("asset_attachment_file_not_found");
  }

  return {
    bytes,
    fileName: attachment.fileName,
    mime: attachment.mime,
    size: bytes.byteLength
  };
}

export async function deleteAssetAttachment(attachmentId: string, actor: WorkspaceRequestActor): Promise<AssetAttachment> {
  let deletedAttachment: AssetAttachment | null = null;
  const snapshot = await mutateDeliveryImportWorkspace((state) => {
    const { attachment, record, viewerRole, viewerUserId } = requireActiveAttachmentAccess(state, attachmentId, actor);

    assertCanDeleteAttachment(attachment, record, viewerUserId, viewerRole);

    const nextState = softDeleteAssetAttachment(state, {
      assetAttachmentId: attachment.id,
      deletedByUserId: viewerUserId
    });
    deletedAttachment = findAttachmentById(nextState, attachment.id);

    return nextState;
  });

  const attachment = deletedAttachment ?? findAttachmentById(snapshot.state, attachmentId);

  if (!attachment) {
    throw new Error("asset_attachment_not_found");
  }

  return attachment;
}

export function resolveAssetAttachmentFilePath(fileId: string, extension: string) {
  const baseDir = path.resolve(/* turbopackIgnore: true */ resolveAssetAttachmentFileDir());
  const filePath = path.resolve(/* turbopackIgnore: true */ baseDir, `${assertAssetAttachmentFileId(fileId)}${assertSafeExtension(extension)}`);
  const relativePath = path.relative(baseDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("asset_attachment_file_path_invalid");
  }

  return filePath;
}

function validateAttachmentFile(input: { fileName: string; mime: string; size: number }) {
  if (!input.fileName.trim()) {
    throw new Error("asset_attachment_file_required");
  }

  if (input.size <= 0) {
    throw new Error("asset_attachment_file_empty");
  }

  if (input.size > maxAttachmentBytes) {
    throw new Error("asset_attachment_file_too_large");
  }

  const extension = path.extname(input.fileName).toLowerCase();
  const fileRule = allowedAttachmentTypes[extension];

  if (!fileRule) {
    throw new Error("asset_attachment_file_type_invalid");
  }

  if (input.mime.trim().toLowerCase() !== fileRule.mime) {
    throw new Error("asset_attachment_file_type_invalid");
  }

  return fileRule;
}

function findCreatedAttachment(state: WorkspaceState, fileId: string) {
  return (state.assetAttachments ?? []).find((attachment) => attachment.fileId === fileId) ?? null;
}

function requireActiveAttachmentAccess(state: WorkspaceState, attachmentId: string, actor: WorkspaceRequestActor) {
  const normalizedAttachmentId = attachmentId.trim();

  if (!normalizedAttachmentId) {
    throw new Error("asset_attachment_id_required");
  }

  const attachment = findAttachmentById(state, normalizedAttachmentId);

  if (!attachment || attachment.status !== "active") {
    throw new Error("asset_attachment_not_found");
  }

  const record = (state.assetLockRecords ?? []).find((item) => item.id === attachment.assetLockRecordId);

  if (!record) {
    throw new Error("asset_attachment_record_not_found");
  }

  if (attachment.projectId !== record.projectId || attachment.deliveryPackageId !== record.deliveryPackageId) {
    throw new Error("asset_attachment_record_mismatch");
  }

  const { viewerRole, viewerUserId } = requireVisibleRecordAccess(state, record.id, actor);

  return { attachment, record, viewerRole, viewerUserId };
}

function requireVisibleRecordAccess(state: WorkspaceState, assetLockRecordId: string, actor: WorkspaceRequestActor) {
  const normalizedRecordId = assetLockRecordId.trim();

  if (!normalizedRecordId) {
    throw new Error("asset_attachment_record_id_required");
  }

  const viewerUserId = requireActorUserId(state, actor);
  const record = (state.assetLockRecords ?? []).find((item) => item.id === normalizedRecordId);

  if (!record) {
    throw new Error("asset_attachment_record_not_found");
  }

  const viewerRole = requireVisibleAssetLockRecord(state, record, viewerUserId);

  return { record, viewerRole, viewerUserId };
}

function requireActorUserId(state: WorkspaceState, actor: WorkspaceRequestActor) {
  if (!actor.userId || !state.users.some((user) => user.id === actor.userId)) {
    throw new Error("asset_attachment_unauthenticated");
  }

  return actor.userId;
}

function assertKnownActor(state: WorkspaceState, actor: WorkspaceRequestActor) {
  requireActorUserId(state, actor);
}

function requireVisibleAssetLockRecord(state: WorkspaceState, record: AssetLockRecord, viewerUserId: string) {
  const isProjectMember = state.members.some((member) => member.projectId === record.projectId && member.userId === viewerUserId);

  if (!isProjectMember) {
    throw new Error("asset_attachment_project_member_required");
  }

  const role = selectPrimaryRole(state, viewerUserId, record.projectId);

  if (!canViewAssetLockRecord(state, record, viewerUserId, role)) {
    throw new Error("asset_attachment_forbidden");
  }

  return role;
}

function canViewAssetLockRecord(state: WorkspaceState, record: AssetLockRecord, viewerUserId: string, role: ProjectRole) {
  if (hasFullAssetLockAccess(role)) {
    return true;
  }

  if (role === "writer") {
    return intersects(record.episodeNos, getAssignedEpisodeNos(state, record.projectId, viewerUserId, ["writer"]));
  }

  if (role === "creator") {
    return intersects(record.episodeNos, getAssignedEpisodeNos(state, record.projectId, viewerUserId, ["creator", "lead_creator"]));
  }

  return false;
}

function assertCanDeleteAttachment(
  attachment: AssetAttachment,
  record: AssetLockRecord,
  viewerUserId: string,
  viewerRole: ProjectRole
) {
  if (record.status === "locked") {
    throw new Error("asset_attachment_locked_record_delete_forbidden");
  }

  if (attachment.uploadedByUserId === viewerUserId || viewerRole === "owner" || viewerRole === "coordinator") {
    return;
  }

  throw new Error("asset_attachment_delete_forbidden");
}

function hasFullAssetLockAccess(role: ProjectRole) {
  return role === "owner" || role === "coordinator" || role === "head_writer";
}

function getAssignedEpisodeNos(
  state: WorkspaceState,
  projectId: string,
  userId: string,
  responsibilities: EpisodeAssignment["responsibility"][]
) {
  const episodeIds = new Set(
    state.assignments
      .filter((assignment) => assignment.userId === userId && responsibilities.includes(assignment.responsibility))
      .map((assignment) => assignment.episodeId)
  );

  return state.episodes
    .filter((episode) => episode.projectId === projectId && episodeIds.has(episode.id))
    .map((episode) => episode.episodeNo);
}

function intersects(left: number[], right: number[]) {
  const rightSet = new Set(right);
  return left.some((episodeNo) => rightSet.has(episodeNo));
}

function findAttachmentById(state: WorkspaceState, attachmentId: string) {
  return (state.assetAttachments ?? []).find((attachment) => attachment.id === attachmentId) ?? null;
}

function resolveAssetAttachmentFileDir() {
  return process.env[attachmentFileDirEnvKey] || defaultAttachmentFileDir;
}

function assertAssetAttachmentFileId(fileId: string) {
  if (!/^asset-att-[a-f0-9-]{36}$/i.test(fileId)) {
    throw new Error("asset_attachment_file_id_invalid");
  }

  return fileId;
}

function assertSafeExtension(extension: string) {
  const normalized = extension.toLowerCase();

  if (!allowedAttachmentTypes[normalized]) {
    throw new Error("asset_attachment_file_type_invalid");
  }

  return normalized;
}

function createAssetAttachmentFileId() {
  return `asset-att-${randomUUID()}`;
}
