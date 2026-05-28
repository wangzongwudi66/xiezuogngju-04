import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type AssetLockDb = NodePgDatabase<typeof schema>;

export interface AssetLockDbRuntime {
  db: AssetLockDb;
  pool: Pool;
}

let cachedRuntime: (AssetLockDbRuntime & { databaseUrl: string }) | undefined;

export function createAssetLockDbRuntime(databaseUrl = process.env.DATABASE_URL): AssetLockDbRuntime {
  const normalizedDatabaseUrl = databaseUrl?.trim();

  if (!normalizedDatabaseUrl) {
    throw new Error("asset_lock_record_database_url_required");
  }

  const pool = new Pool({ connectionString: normalizedDatabaseUrl });

  return {
    db: drizzle(pool, { schema }),
    pool
  };
}

export function getAssetLockDbRuntime(databaseUrl = process.env.DATABASE_URL): AssetLockDbRuntime {
  const normalizedDatabaseUrl = databaseUrl?.trim();

  if (!normalizedDatabaseUrl) {
    throw new Error("asset_lock_record_database_url_required");
  }

  if (!cachedRuntime || cachedRuntime.databaseUrl !== normalizedDatabaseUrl) {
    const runtime = createAssetLockDbRuntime(normalizedDatabaseUrl);
    cachedRuntime = {
      ...runtime,
      databaseUrl: normalizedDatabaseUrl
    };
  }

  return cachedRuntime;
}
