import { pathToFileURL } from "node:url";
import { createAssetLockDbRuntime, type AssetLockDb, type AssetLockDbRuntime } from "./runtime";
import { listAssetAttachmentMetadataAuditRows, createAssetAttachmentMetadataAuditReadAdapter } from "./asset-attachment-metadata-audit";
import {
  acquireAssetAttachmentStorageBackfillAdvisoryLock,
  releaseAssetAttachmentStorageBackfillAdvisoryLock,
  writeAssetAttachmentStorageBackfillBatch,
  type AssetAttachmentStorageBackfillBatchWriteResult
} from "./asset-attachment-storage-backfill-repository";
import { resolveAssetAttachmentStorage, type AssetAttachmentStorage } from "../app/api/asset-lock-attachments/storage";
import {
  buildAssetAttachmentStorageBackfillPlan,
  type AssetAttachmentStorageBackfillPlan,
  type AssetAttachmentStorageBackfillWrite
} from "../app/api/asset-lock-attachments/storage-backfill";

const confirmWriteFlag = "--confirm-asset-attachment-storage-backfill";
const defaultBatchSize = 50;
const defaultMaxItems = 1000;

export type AssetAttachmentStorageBackfillRunnerEnv = Record<string, string | undefined>;

export interface AssetAttachmentStorageBackfillRunnerOptions {
  write: boolean;
  confirmWrite: boolean;
  legacyPrefixes: string[];
  maxItems: number;
  batchSize: number;
}

export interface AssetAttachmentStorageBackfillRunnerOutput {
  dryRun: boolean;
  status: "completed" | "failed";
  message?: string;
  report?: AssetAttachmentStorageBackfillRedactedPlan;
  writeResult?: {
    batchSize: number;
    attemptedRowCount: number;
    updatedRowCount: number;
    batchCount: number;
  };
}

type AssetAttachmentStorageBackfillStorage = Pick<AssetAttachmentStorage, "makeKey" | "get">;
type AssetAttachmentStorageBackfillRedactedPlan = Omit<AssetAttachmentStorageBackfillPlan, "writes">;

export function resolveAssetAttachmentStorageBackfillRunnerOptions(input: {
  args?: string[];
  env?: AssetAttachmentStorageBackfillRunnerEnv;
}): AssetAttachmentStorageBackfillRunnerOptions {
  const env = input.env ?? process.env;
  const cliOptions = parseAssetAttachmentStorageBackfillArgs(input.args ?? []);

  return {
    write: cliOptions.write,
    confirmWrite: cliOptions.confirmWrite,
    legacyPrefixes: cliOptions.legacyPrefixes,
    maxItems: cliOptions.maxItems ?? defaultMaxItems,
    batchSize: cliOptions.batchSize ?? parseBatchSize(env.ASSET_ATTACHMENT_STORAGE_BACKFILL_BATCH_SIZE) ?? defaultBatchSize
  };
}

export async function runAssetAttachmentStorageBackfillDryRun(input: {
  db: Pick<AssetLockDb, "select">;
  storage: AssetAttachmentStorageBackfillStorage;
  legacyPrefixes?: string[];
  maxItems?: number;
  now?: Date;
}): Promise<AssetAttachmentStorageBackfillPlan> {
  const rows = await listAssetAttachmentMetadataAuditRows(input.db);

  return buildAssetAttachmentStorageBackfillPlan({
    adapter: createAssetAttachmentMetadataAuditReadAdapter(input.storage),
    rows,
    legacyPrefixes: input.legacyPrefixes,
    maxItems: input.maxItems,
    now: input.now
  });
}

export async function runAssetAttachmentStorageBackfillCli(input: {
  args?: string[];
  env?: AssetAttachmentStorageBackfillRunnerEnv;
  stdout?: Pick<typeof console, "log">;
  stderr?: Pick<typeof console, "error">;
  createRuntime?: () => AssetLockDbRuntime;
  resolveStorage?: () => AssetAttachmentStorageBackfillStorage;
  writeBatch?: (
    db: AssetLockDb,
    writes: AssetAttachmentStorageBackfillWrite[]
  ) => Promise<AssetAttachmentStorageBackfillBatchWriteResult>;
  acquireLock?: (db: Pick<AssetLockDb, "execute">) => Promise<void>;
  releaseLock?: (db: Pick<AssetLockDb, "execute">) => Promise<void>;
  now?: Date;
} = {}): Promise<number> {
  const stdout = input.stdout ?? console;
  const stderr = input.stderr ?? console;
  let attemptedWrite = false;

  try {
    const options = resolveAssetAttachmentStorageBackfillRunnerOptions({ args: input.args, env: input.env });
    const runtime = input.createRuntime?.() ?? createAssetLockDbRuntime();

    try {
      const plan = await runAssetAttachmentStorageBackfillDryRun({
        db: runtime.db,
        storage: input.resolveStorage?.() ?? resolveAssetAttachmentStorage(),
        legacyPrefixes: options.legacyPrefixes,
        maxItems: options.maxItems,
        now: input.now
      });

      if (!options.write || !options.confirmWrite) {
        stdout.log(
          formatAssetAttachmentStorageBackfillOutput({
            dryRun: true,
            status: "completed",
            message: options.write ? `${confirmWriteFlag} is required before DB updates are allowed.` : undefined,
            report: redactBackfillPlan(plan)
          })
        );
        return 0;
      }

      attemptedWrite = true;
      const writeResult = await writeBackfillPlan({
        db: runtime.db,
        plan,
        batchSize: options.batchSize,
        writeBatch: input.writeBatch ?? writeAssetAttachmentStorageBackfillBatch,
        acquireLock: input.acquireLock ?? acquireAssetAttachmentStorageBackfillAdvisoryLock,
        releaseLock: input.releaseLock ?? releaseAssetAttachmentStorageBackfillAdvisoryLock
      });

      stdout.log(
        formatAssetAttachmentStorageBackfillOutput({
          dryRun: false,
          status: "completed",
          report: redactBackfillPlan(plan),
          writeResult
        })
      );
      return 0;
    } finally {
      await runtime.pool.end();
    }
  } catch {
    stderr.error(
      formatAssetAttachmentStorageBackfillOutput({
        dryRun: !attemptedWrite,
        status: "failed",
        message: "asset_attachment_storage_backfill_failed"
      })
    );
    return 1;
  }
}

export function formatAssetAttachmentStorageBackfillOutput(output: AssetAttachmentStorageBackfillRunnerOutput) {
  return JSON.stringify(output, null, 2);
}

function redactBackfillPlan(plan: AssetAttachmentStorageBackfillPlan): AssetAttachmentStorageBackfillRedactedPlan {
  const { writes: _writes, ...redacted } = plan;

  return redacted;
}

async function writeBackfillPlan(input: {
  db: AssetLockDb;
  plan: AssetAttachmentStorageBackfillPlan;
  batchSize: number;
  writeBatch: (
    db: AssetLockDb,
    writes: AssetAttachmentStorageBackfillWrite[]
  ) => Promise<AssetAttachmentStorageBackfillBatchWriteResult>;
  acquireLock: (db: Pick<AssetLockDb, "execute">) => Promise<void>;
  releaseLock: (db: Pick<AssetLockDb, "execute">) => Promise<void>;
}) {
  let attemptedRowCount = 0;
  let updatedRowCount = 0;
  let batchCount = 0;

  await input.acquireLock(input.db);

  try {
    for (const batch of chunkWrites(input.plan.writes, input.batchSize)) {
      const result = await input.writeBatch(input.db, batch);
      attemptedRowCount += result.attemptedRowCount;
      updatedRowCount += result.updatedRowCount;
      batchCount += 1;
    }
  } finally {
    await input.releaseLock(input.db);
  }

  return {
    batchSize: input.batchSize,
    attemptedRowCount,
    updatedRowCount,
    batchCount
  };
}

function chunkWrites(writes: AssetAttachmentStorageBackfillWrite[], batchSize: number) {
  const chunks: AssetAttachmentStorageBackfillWrite[][] = [];

  for (let index = 0; index < writes.length; index += batchSize) {
    chunks.push(writes.slice(index, index + batchSize));
  }

  return chunks;
}

function parseAssetAttachmentStorageBackfillArgs(args: string[]) {
  const options: {
    write: boolean;
    confirmWrite: boolean;
    legacyPrefixes: string[];
    maxItems?: number;
    batchSize?: number;
  } = {
    write: false,
    confirmWrite: false,
    legacyPrefixes: []
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--write") {
      options.write = true;
      continue;
    }

    if (arg === confirmWriteFlag) {
      options.confirmWrite = true;
      continue;
    }

    if (arg === "--legacy-prefix") {
      const value = args[index + 1];

      if (!value) {
        throw new Error("asset_attachment_storage_backfill_legacy_prefix_required");
      }

      options.legacyPrefixes.push(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--legacy-prefix=")) {
      const value = arg.slice("--legacy-prefix=".length);

      if (!value) {
        throw new Error("asset_attachment_storage_backfill_legacy_prefix_required");
      }

      options.legacyPrefixes.push(value);
      continue;
    }

    if (arg === "--max-items") {
      options.maxItems = parseMaxItems(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--max-items=")) {
      options.maxItems = parseMaxItems(arg.slice("--max-items=".length));
      continue;
    }

    if (arg === "--batch-size") {
      options.batchSize = parseBatchSize(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--batch-size=")) {
      options.batchSize = parseBatchSize(arg.slice("--batch-size=".length));
      continue;
    }

    throw new Error("asset_attachment_storage_backfill_arg_invalid");
  }

  return options;
}

function parseMaxItems(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10000) {
    throw new Error("asset_attachment_storage_backfill_max_items_invalid");
  }

  return parsed;
}

function parseBatchSize(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error("asset_attachment_storage_backfill_batch_size_invalid");
  }

  return parsed;
}

function isDirectRun() {
  const scriptPath = process.argv[1];

  return Boolean(scriptPath && import.meta.url === pathToFileURL(scriptPath).href);
}

if (isDirectRun()) {
  void runAssetAttachmentStorageBackfillCli({ args: process.argv.slice(2) }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
