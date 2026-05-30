import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAssetAttachmentMetadata, listAssetAttachmentsForRecord, selectPrimaryRole } from "@aigc/domain";
import type {
  AssetAttachment,
  AssetAttachmentMetadataInput,
  AssetAttachmentType,
  AssetLockRecord,
  EpisodeAssignment,
  ProjectRole,
  WorkspaceState
} from "@aigc/domain";
import { mutateDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import type { WorkspaceRequestActor } from "../workspace-actor";
import { createLocalAssetAttachmentRepository, resolveAssetAttachmentRepository } from "./repository";
import type { AssetAttachmentRepository } from "./repository";
import {
  AssetAttachmentStorageFileNotFoundError,
  allowedAssetAttachmentFileTypes,
  resolveAssetAttachmentStorage
} from "./storage";
import type { AssetAttachmentStorage } from "./storage";

const maxAttachmentBytes = 20 * 1024 * 1024;

export { resolveAssetAttachmentFilePath } from "./storage";

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

export interface AssetAttachmentServiceOptions {
  persistMetadata?: typeof mutateDeliveryImportWorkspace;
  repository?: AssetAttachmentRepository;
  storage?: AssetAttachmentStorage;
}

export async function uploadAssetAttachment(
  input: AssetAttachmentUploadInput,
  actor: WorkspaceRequestActor,
  options: AssetAttachmentServiceOptions = {}
): Promise<AssetAttachment> {
  const bytes = input.fileBuffer instanceof Uint8Array ? input.fileBuffer : new Uint8Array(input.fileBuffer);
  const fileRule = validateAttachmentFile({
    fileName: input.fileName,
    mime: input.mime,
    size: bytes.byteLength
  });
  const fileId = createAssetAttachmentFileId();
  const metadataInput: AssetAttachmentMetadataInput = {
    assetLockRecordId: input.assetLockRecordId,
    fileId,
    fileName: input.fileName,
    mime: fileRule.mime,
    size: bytes.byteLength,
    attachmentType: input.attachmentType,
    uploadedByUserId: actor.userId,
    note: input.note
  };
  const repository = resolveServiceRepository(options);
  const storage = resolveServiceStorage(options);
  const snapshot = await repository.read();

  assertKnownActor(snapshot.state, actor);
  const { record } = requireVisibleRecordAccess(snapshot.state, input.assetLockRecordId, actor);
  assertCanUploadAttachment(record);

  const nextState = createAssetAttachmentMetadata(snapshot.state, metadataInput);
  const attachment = findCreatedAttachment(nextState, fileId);

  if (!attachment) {
    throw new Error("asset_attachment_metadata_not_created");
  }

  const storageKey = storage.makeKey({ fileId, extension: fileRule.extension });

  await storage.put({ key: storageKey, bytes, mime: fileRule.mime });

  try {
    return await repository.createAssetAttachmentMetadata({ attachment, metadataInput });
  } catch (error) {
    try {
      await storage.delete({ key: storageKey });
    } catch {
      // Keep the metadata failure as the upload result; cleanup is compensating work.
    }
    throw error;
  }
}

export async function listAssetAttachments(
  recordId: string,
  actor: WorkspaceRequestActor,
  options: AssetAttachmentServiceOptions = {}
) {
  const repository = resolveServiceRepository(options);
  const snapshot = await repository.read();
  const { record } = requireVisibleRecordAccess(snapshot.state, recordId, actor);

  return listAssetAttachmentsForRecord(snapshot.state, record.id);
}

export async function downloadAssetAttachment(
  attachmentId: string,
  actor: WorkspaceRequestActor,
  options: AssetAttachmentServiceOptions = {}
): Promise<AssetAttachmentDownload> {
  const repository = resolveServiceRepository(options);
  const storage = resolveServiceStorage(options);
  const snapshot = await repository.read();
  const { attachment } = requireActiveAttachmentAccess(snapshot.state, attachmentId, actor);
  const storageKey = storage.makeKey({ fileId: attachment.fileId, extension: path.extname(attachment.fileName) });
  let bytes: Uint8Array;

  try {
    bytes = await storage.get({ key: storageKey });
  } catch (error) {
    if (error instanceof AssetAttachmentStorageFileNotFoundError || (error as Error).message === "asset_attachment_file_not_found") {
      throw new Error("asset_attachment_file_not_found");
    }

    throw error;
  }

  return {
    bytes,
    fileName: attachment.fileName,
    mime: attachment.mime,
    size: bytes.byteLength
  };
}

export async function deleteAssetAttachment(
  attachmentId: string,
  actor: WorkspaceRequestActor,
  options: AssetAttachmentServiceOptions = {}
): Promise<AssetAttachment> {
  const repository = resolveServiceRepository(options);
  const snapshot = await repository.read();
  const { attachment, record, viewerRole, viewerUserId } = requireActiveAttachmentAccess(snapshot.state, attachmentId, actor);

  assertCanDeleteAttachment(attachment, record, viewerUserId, viewerRole);

  return repository.softDeleteAssetAttachmentMetadata({
    assetAttachmentId: attachment.id,
    deletedByUserId: viewerUserId
  });
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
  const fileRule = allowedAssetAttachmentFileTypes[extension];

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

function resolveServiceRepository(options: AssetAttachmentServiceOptions) {
  if (options.repository) {
    return options.repository;
  }

  const repository = resolveAssetAttachmentRepository();

  if (repository.mode === "local" && options.persistMetadata) {
    return createLocalAssetAttachmentRepository(options.persistMetadata);
  }

  return repository;
}

function resolveServiceStorage(options: AssetAttachmentServiceOptions) {
  return options.storage ?? resolveAssetAttachmentStorage();
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

function assertCanUploadAttachment(record: AssetLockRecord) {
  if (record.status === "locked") {
    throw new Error("asset_attachment_locked_record_upload_forbidden");
  }
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

function createAssetAttachmentFileId() {
  return `asset-att-${randomUUID()}`;
}
