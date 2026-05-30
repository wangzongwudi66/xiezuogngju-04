import {
  createAssetAttachmentMetadata as createAssetAttachmentMetadataInWorkspace,
  softDeleteAssetAttachment as softDeleteAssetAttachmentInWorkspace
} from "@aigc/domain";
import type { AssetAttachment, AssetAttachmentDeleteInput, AssetAttachmentMetadataInput, WorkspaceState } from "@aigc/domain";
import { mutateDeliveryImportWorkspace, readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { isAssetLockRecordDbRepositoryEnabled } from "../asset-lock-records/repository";
import { createDbAssetAttachmentRepository } from "./db-repository";

export interface AssetAttachmentRepositorySnapshot {
  state: WorkspaceState;
  assetAttachments: AssetAttachment[];
  storageMetadataByAttachmentId?: ReadonlyMap<string, AssetAttachmentPersistedStorageMetadata>;
}

export interface AssetAttachmentPersistedStorageMetadata {
  checksumSha256?: string;
  storageKey?: string;
}

export interface AssetAttachmentMetadataCreateCommand {
  attachment: AssetAttachment;
  metadataInput: AssetAttachmentMetadataInput;
  storage: AssetAttachmentStorageMetadata;
}

export interface AssetAttachmentStorageMetadata {
  checksumSha256: string;
  contentLength: number;
  storageKey: string;
}

export interface LocalAssetAttachmentRepository {
  mode: "local";
  read(): Promise<AssetAttachmentRepositorySnapshot>;
  createAssetAttachmentMetadata(command: AssetAttachmentMetadataCreateCommand): Promise<AssetAttachment>;
  softDeleteAssetAttachmentMetadata(input: AssetAttachmentDeleteInput): Promise<AssetAttachment>;
}

export interface DbAssetAttachmentRepository {
  mode: "db";
  read(): Promise<AssetAttachmentRepositorySnapshot>;
  createAssetAttachmentMetadata(command: AssetAttachmentMetadataCreateCommand): Promise<AssetAttachment>;
  softDeleteAssetAttachmentMetadata(input: AssetAttachmentDeleteInput): Promise<AssetAttachment>;
}

export type AssetAttachmentRepository = LocalAssetAttachmentRepository | DbAssetAttachmentRepository;

const assetAttachmentRepositoryEnvKey = "ASSET_LOCK_ATTACHMENTS_REPOSITORY";
type AssetAttachmentRepositoryEnv = Record<string, string | undefined>;
type PersistAssetAttachmentMetadata = typeof mutateDeliveryImportWorkspace;

export const localAssetAttachmentRepository = createLocalAssetAttachmentRepository();

export function createLocalAssetAttachmentRepository(
  persistMetadata: PersistAssetAttachmentMetadata = mutateDeliveryImportWorkspace
): LocalAssetAttachmentRepository {
  return {
    mode: "local",
    async read() {
      const workspace = await readDeliveryImportWorkspace();

      return toAssetAttachmentRepositorySnapshot(workspace.state);
    },
    async createAssetAttachmentMetadata(command) {
      let createdAttachment: AssetAttachment | null = null;
      const snapshot = await persistMetadata((state) => {
        const nextState = createAssetAttachmentMetadataInWorkspace(state, command.metadataInput);
        createdAttachment = findAttachmentByFileId(nextState, command.metadataInput.fileId);

        return nextState;
      });
      const attachment = createdAttachment ?? findAttachmentByFileId(snapshot.state, command.metadataInput.fileId);

      if (!attachment) {
        throw new Error("asset_attachment_metadata_not_created");
      }

      return attachment;
    },
    async softDeleteAssetAttachmentMetadata(input) {
      let deletedAttachment: AssetAttachment | null = null;
      const snapshot = await persistMetadata((state) => {
        const nextState = softDeleteAssetAttachmentInWorkspace(state, input);
        deletedAttachment = findAttachmentById(nextState, input.assetAttachmentId);

        return nextState;
      });
      const attachment = deletedAttachment ?? findAttachmentById(snapshot.state, input.assetAttachmentId);

      if (!attachment) {
        throw new Error("asset_attachment_not_found");
      }

      return attachment;
    }
  };
}

export function resolveAssetAttachmentRepository(env: AssetAttachmentRepositoryEnv = process.env): AssetAttachmentRepository {
  if (isAssetAttachmentDbRepositoryEnabled(env)) {
    return createDbAssetAttachmentRepository();
  }

  return localAssetAttachmentRepository;
}

export function isAssetAttachmentDbRepositoryEnabled(env: AssetAttachmentRepositoryEnv = process.env) {
  if (!isAssetAttachmentDbRepositoryRequested(env)) {
    return false;
  }

  if (!isAssetLockRecordDbRepositoryEnabled(env)) {
    throw new Error("asset_attachment_record_db_required");
  }

  return true;
}

function isAssetAttachmentDbRepositoryRequested(env: AssetAttachmentRepositoryEnv) {
  return env[assetAttachmentRepositoryEnvKey]?.trim().toLowerCase() === "db";
}

function toAssetAttachmentRepositorySnapshot(state: WorkspaceState): AssetAttachmentRepositorySnapshot {
  return {
    state,
    assetAttachments: state.assetAttachments ?? []
  };
}

function findAttachmentByFileId(state: WorkspaceState, fileId: string) {
  return (state.assetAttachments ?? []).find((attachment) => attachment.fileId === fileId) ?? null;
}

function findAttachmentById(state: WorkspaceState, attachmentId: string) {
  return (state.assetAttachments ?? []).find((attachment) => attachment.id === attachmentId) ?? null;
}
