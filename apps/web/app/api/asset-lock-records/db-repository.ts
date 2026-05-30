import type { AssetLockRecord } from "@aigc/domain";
import { eq } from "drizzle-orm";
import { getAssetLockDbRuntime } from "../../../db/runtime";
import { assetLockRecordEpisodes, assetLockRecords, scriptSourceBindings } from "../../../db/schema";
import { readDeliveryImportLocalWorkspaceState } from "../delivery-import-jobs/persistence";
import { readDbWorkspaceSnapshotOverlay } from "../workspace-snapshot";
import {
  mapAssetLockRecordRows,
  mapAssetLockRecordToDbRows,
  mapAssetLockRecordToDbUpdateRow,
  mapScriptSourceBindingRows,
  mapScriptSourceBindingToDbRow,
  type AssetLockRecordDbEpisodeRow,
  type AssetLockRecordDbRecordRow,
  type ScriptSourceBindingDbRow
} from "./db-parts";
import type { DbAssetLockRecordRepository } from "./repository";

export {
  mapAssetLockRecordRows,
  mapAssetLockRecordToDbRows,
  mapAssetLockRecordToDbUpdateRow,
  mapScriptSourceBindingRows,
  mapScriptSourceBindingToDbRow,
  type AssetLockRecordDbEpisodeRow,
  type AssetLockRecordDbRecordRow,
  type ScriptSourceBindingDbRow
} from "./db-parts";

export function createDbAssetLockRecordRepository(): DbAssetLockRecordRepository {
  return {
    mode: "db",
    read: readDbAssetLockRecordRepositorySnapshot,
    async createAssetLockRecord(record) {
      return createAssetLockRecordsInDb([record]);
    },
    async createAssetLockRecords(records) {
      return createAssetLockRecordsInDb(records);
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

async function createAssetLockRecordsInDb(records: AssetLockRecord[]) {
  const { db } = getAssetLockDbRuntime();

  if (records.length === 0) {
    return readDbAssetLockRecordRepositorySnapshot();
  }

  const rows = records.map(mapAssetLockRecordToDbRows);

  await db.transaction(async (tx) => {
    await tx.insert(assetLockRecords).values(rows.map((row) => row.record));
    await tx.insert(assetLockRecordEpisodes).values(rows.flatMap((row) => row.episodes));
  });

  return readDbAssetLockRecordRepositorySnapshot();
}

export async function readDbAssetLockRecordRepositorySnapshot() {
  const workspaceState = await readDbWorkspaceSnapshotOverlay(await readDeliveryImportLocalWorkspaceState());

  return {
    state: workspaceState,
    assetLockRecords: workspaceState.assetLockRecords,
    scriptSourceBindings: workspaceState.scriptSourceBindings
  };
}
