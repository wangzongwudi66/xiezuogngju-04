import type { AssetAttachment, WorkspaceState } from "@aigc/domain";
import { readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { createDbAssetAttachmentRepository } from "./db-repository";

export interface AssetAttachmentRepositorySnapshot {
  state: WorkspaceState;
  assetAttachments: AssetAttachment[];
}

export interface LocalAssetAttachmentRepository {
  mode: "local";
  read(): Promise<AssetAttachmentRepositorySnapshot>;
}

export interface DbAssetAttachmentRepository {
  mode: "db";
  read(): Promise<AssetAttachmentRepositorySnapshot>;
}

export type AssetAttachmentRepository = LocalAssetAttachmentRepository | DbAssetAttachmentRepository;

const assetAttachmentRepositoryEnvKey = "ASSET_LOCK_ATTACHMENTS_REPOSITORY";
type AssetAttachmentRepositoryEnv = Record<string, string | undefined>;

export const localAssetAttachmentRepository: LocalAssetAttachmentRepository = {
  mode: "local",
  async read() {
    const workspace = await readDeliveryImportWorkspace();

    return toAssetAttachmentRepositorySnapshot(workspace.state);
  }
};

export function resolveAssetAttachmentRepository(env: AssetAttachmentRepositoryEnv = process.env): AssetAttachmentRepository {
  if (isAssetAttachmentDbRepositoryEnabled(env)) {
    return createDbAssetAttachmentRepository();
  }

  return localAssetAttachmentRepository;
}

export function isAssetAttachmentDbRepositoryEnabled(env: AssetAttachmentRepositoryEnv = process.env) {
  return env[assetAttachmentRepositoryEnvKey]?.trim().toLowerCase() === "db" && Boolean(env.DATABASE_URL?.trim());
}

function toAssetAttachmentRepositorySnapshot(state: WorkspaceState): AssetAttachmentRepositorySnapshot {
  return {
    state,
    assetAttachments: state.assetAttachments ?? []
  };
}
