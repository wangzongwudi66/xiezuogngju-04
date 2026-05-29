import type { AssetLockRecord, ScriptSourceBinding, WorkspaceState } from "@aigc/domain";
import { asc, eq } from "drizzle-orm";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { assetLockRecordEpisodes, assetLockRecords, scriptSourceBindings } from "../../../db/schema";
import { readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import type { DbAssetLockRecordRepository } from "./repository";

export type AssetLockRecordDbRecordRow = typeof assetLockRecords.$inferSelect;
export type AssetLockRecordDbEpisodeRow = typeof assetLockRecordEpisodes.$inferSelect;
export type ScriptSourceBindingDbRow = typeof scriptSourceBindings.$inferSelect;

type AssetLockRecordDbRecordInsert = typeof assetLockRecords.$inferInsert;
type AssetLockRecordDbEpisodeInsert = typeof assetLockRecordEpisodes.$inferInsert;
type ScriptSourceBindingDbInsert = typeof scriptSourceBindings.$inferInsert;
type AssetLockRecordDbRecordUpdate = Pick<
  AssetLockRecordDbRecordInsert,
  | "writerConfirmation"
  | "writerConfirmedByUserId"
  | "writerConfirmedAt"
  | "writerNote"
  | "productionConfirmation"
  | "productionConfirmedByUserId"
  | "productionConfirmedAt"
  | "productionNote"
  | "risk"
  | "status"
  | "missingInfo"
  | "disputeReason"
  | "finalLockedByUserId"
  | "finalLockedAt"
  | "updatedAt"
>;

export function createDbAssetLockRecordRepository(): DbAssetLockRecordRepository {
  return {
    mode: "db",
    read: readDbAssetLockRecordRepositorySnapshot,
    async createAssetLockRecord(record) {
      const { db } = getAssetLockDbRuntime();
      const rows = mapAssetLockRecordToDbRows(record);

      await db.transaction(async (tx) => {
        await tx.insert(assetLockRecords).values(rows.record);
        await tx.insert(assetLockRecordEpisodes).values(rows.episodes);
      });

      return readDbAssetLockRecordRepositorySnapshot();
    },
    async updateAssetLockRecord(record) {
      const { db } = getAssetLockDbRuntime();
      const updatedRows = await db
        .update(assetLockRecords)
        .set(mapAssetLockRecordToDbUpdateRow(record))
        .where(eq(assetLockRecords.id, record.id))
        .returning();

      if (updatedRows.length === 0) {
        throw new Error("asset_lock_record_not_found");
      }

      return readDbAssetLockRecordRepositorySnapshot();
    },
    async createSourceBinding(binding) {
      const { db } = getAssetLockDbRuntime();
      const row = mapScriptSourceBindingToDbRow(binding);

      await db.transaction(async (tx) => {
        await tx.insert(scriptSourceBindings).values(row);
      });

      return readDbAssetLockRecordRepositorySnapshot();
    },
    async removeSourceBinding(id) {
      const { db } = getAssetLockDbRuntime();

      await db.transaction(async (tx) => {
        const deletedRows = await tx
          .delete(scriptSourceBindings)
          .where(eq(scriptSourceBindings.id, id))
          .returning({ id: scriptSourceBindings.id });

        if (deletedRows.length === 0) {
          throw new Error("script_source_binding_not_found");
        }
      });

      return readDbAssetLockRecordRepositorySnapshot();
    }
  };
}

export async function readDbAssetLockRecordRepositorySnapshot() {
  const workspace = await readDeliveryImportWorkspace();
  const { db } = getAssetLockDbRuntime();
  const [recordRows, episodeRows, sourceBindingRows] = await Promise.all([
    db.select().from(assetLockRecords).orderBy(asc(assetLockRecords.createdAt), asc(assetLockRecords.id)),
    db
      .select()
      .from(assetLockRecordEpisodes)
      .orderBy(asc(assetLockRecordEpisodes.assetLockRecordId), asc(assetLockRecordEpisodes.episodeNo)),
    db
      .select()
      .from(scriptSourceBindings)
      .orderBy(
        asc(scriptSourceBindings.projectId),
        asc(scriptSourceBindings.deliveryPackageId),
        asc(scriptSourceBindings.assetLockRecordId),
        asc(scriptSourceBindings.episodeNo),
        asc(scriptSourceBindings.startLine),
        asc(scriptSourceBindings.endLine),
        asc(scriptSourceBindings.id)
      )
  ]);

  return toDbRepositorySnapshot(
    workspace.state,
    mapAssetLockRecordRows(recordRows, episodeRows),
    mapScriptSourceBindingRows(sourceBindingRows)
  );
}

export function mapAssetLockRecordRows(
  recordRows: AssetLockRecordDbRecordRow[],
  episodeRows: AssetLockRecordDbEpisodeRow[]
): AssetLockRecord[] {
  const episodeNosByRecordId = new Map<string, number[]>();

  for (const row of episodeRows) {
    const episodeNos = episodeNosByRecordId.get(row.assetLockRecordId) ?? [];
    episodeNos.push(row.episodeNo);
    episodeNosByRecordId.set(row.assetLockRecordId, episodeNos);
  }

  return recordRows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    deliveryPackageId: row.deliveryPackageId,
    episodeNos: Array.from(new Set(episodeNosByRecordId.get(row.id) ?? [])).sort((a, b) => a - b),
    assetName: row.assetName,
    assetType: row.assetType,
    changeType: row.changeType,
    writerConfirmation: row.writerConfirmation,
    writerConfirmedByUserId: optional(row.writerConfirmedByUserId),
    writerConfirmedAt: optional(row.writerConfirmedAt),
    writerNote: optional(row.writerNote),
    productionConfirmation: row.productionConfirmation,
    productionConfirmedByUserId: optional(row.productionConfirmedByUserId),
    productionConfirmedAt: optional(row.productionConfirmedAt),
    productionNote: optional(row.productionNote),
    risk: row.risk,
    status: row.status,
    missingInfo: optional(row.missingInfo),
    disputeReason: optional(row.disputeReason),
    finalLockedByUserId: optional(row.finalLockedByUserId),
    finalLockedAt: optional(row.finalLockedAt),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));
}

export function mapAssetLockRecordToDbRows(record: AssetLockRecord): {
  record: AssetLockRecordDbRecordInsert;
  episodes: AssetLockRecordDbEpisodeInsert[];
} {
  return {
    record: {
      id: record.id,
      projectId: record.projectId,
      deliveryPackageId: record.deliveryPackageId,
      assetName: record.assetName,
      assetNameKey: normalizeAssetLockNameKey(record.assetName),
      assetType: record.assetType,
      changeType: record.changeType,
      writerConfirmation: record.writerConfirmation,
      writerConfirmedByUserId: record.writerConfirmedByUserId ?? null,
      writerConfirmedAt: record.writerConfirmedAt ?? null,
      writerNote: record.writerNote ?? null,
      productionConfirmation: record.productionConfirmation,
      productionConfirmedByUserId: record.productionConfirmedByUserId ?? null,
      productionConfirmedAt: record.productionConfirmedAt ?? null,
      productionNote: record.productionNote ?? null,
      risk: record.risk,
      status: record.status,
      missingInfo: record.missingInfo ?? null,
      disputeReason: record.disputeReason ?? null,
      finalLockedByUserId: record.finalLockedByUserId ?? null,
      finalLockedAt: record.finalLockedAt ?? null,
      createdByUserId: record.createdByUserId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    },
    episodes: record.episodeNos.map((episodeNo) => ({
      assetLockRecordId: record.id,
      episodeNo,
      createdAt: record.createdAt
    }))
  };
}

export function mapAssetLockRecordToDbUpdateRow(record: AssetLockRecord): AssetLockRecordDbRecordUpdate {
  return {
    writerConfirmation: record.writerConfirmation,
    writerConfirmedByUserId: record.writerConfirmedByUserId ?? null,
    writerConfirmedAt: record.writerConfirmedAt ?? null,
    writerNote: record.writerNote ?? null,
    productionConfirmation: record.productionConfirmation,
    productionConfirmedByUserId: record.productionConfirmedByUserId ?? null,
    productionConfirmedAt: record.productionConfirmedAt ?? null,
    productionNote: record.productionNote ?? null,
    risk: record.risk,
    status: record.status,
    missingInfo: record.missingInfo ?? null,
    disputeReason: record.disputeReason ?? null,
    finalLockedByUserId: record.finalLockedByUserId ?? null,
    finalLockedAt: record.finalLockedAt ?? null,
    updatedAt: record.updatedAt
  };
}

export function mapScriptSourceBindingRows(bindingRows: ScriptSourceBindingDbRow[]): ScriptSourceBinding[] {
  return bindingRows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    deliveryPackageId: row.deliveryPackageId,
    assetLockRecordId: row.assetLockRecordId,
    episodeNo: row.episodeNo,
    startLine: row.startLine,
    endLine: row.endLine,
    excerptSnapshot: row.excerptSnapshot,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt
  }));
}

export function mapScriptSourceBindingToDbRow(binding: ScriptSourceBinding): ScriptSourceBindingDbInsert {
  return {
    id: binding.id,
    projectId: binding.projectId,
    deliveryPackageId: binding.deliveryPackageId,
    assetLockRecordId: binding.assetLockRecordId,
    episodeNo: binding.episodeNo,
    startLine: binding.startLine,
    endLine: binding.endLine,
    excerptSnapshot: binding.excerptSnapshot,
    createdByUserId: binding.createdByUserId,
    createdAt: binding.createdAt
  };
}

function toDbRepositorySnapshot(
  state: WorkspaceState,
  records: AssetLockRecord[],
  sourceBindings: ScriptSourceBinding[]
) {
  const nextState: WorkspaceState = {
    ...state,
    assetLockRecords: records,
    scriptSourceBindings: sourceBindings
  };

  return {
    state: nextState,
    assetLockRecords: records,
    scriptSourceBindings: sourceBindings
  };
}

function normalizeAssetLockNameKey(assetName: string) {
  return assetName.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function optional<T>(value: T | null | undefined) {
  return value ?? undefined;
}
