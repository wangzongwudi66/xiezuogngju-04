import { pathToFileURL } from "node:url";
import { assetAttachments } from "./schema/asset-lock-records";
import { createAssetLockDbRuntime, type AssetLockDb, type AssetLockDbRuntime } from "./runtime";
import {
  AssetAttachmentStorageFileNotFoundError,
  resolveAssetAttachmentStorage,
  type AssetAttachmentStorage
} from "../app/api/asset-lock-attachments/storage";
import {
  runAssetAttachmentMetadataAudit,
  type AssetAttachmentMetadataAuditReadAdapter,
  type AssetAttachmentMetadataAuditReport,
  type AssetAttachmentMetadataAuditRow
} from "../app/api/asset-lock-attachments/metadata-audit";

const optInEnvKey = "ASSET_ATTACHMENT_METADATA_AUDIT";
const legacyPrefixesEnvKey = "ASSET_ATTACHMENT_METADATA_AUDIT_LEGACY_PREFIXES";
const maxItemsEnvKey = "ASSET_ATTACHMENT_METADATA_AUDIT_MAX_ITEMS";
const defaultMaxItems = 1000;

export type AssetAttachmentMetadataAuditRunnerEnv = Record<string, string | undefined>;

export interface AssetAttachmentMetadataAuditRunnerOptions {
  enabled: boolean;
  legacyPrefixes: string[];
  maxItems: number;
}

export interface AssetAttachmentMetadataAuditRunnerOutput {
  dryRun: true;
  status: "disabled" | "completed" | "failed";
  message?: string;
  report?: AssetAttachmentMetadataAuditReport;
}

type AssetAttachmentMetadataAuditDb = Pick<AssetLockDb, "select">;
type AssetAttachmentMetadataAuditStorage = Pick<AssetAttachmentStorage, "makeKey" | "get">;

export function resolveAssetAttachmentMetadataAuditRunnerOptions(input: {
  args?: string[];
  env?: AssetAttachmentMetadataAuditRunnerEnv;
}): AssetAttachmentMetadataAuditRunnerOptions {
  const env = input.env ?? process.env;
  const enabled = env[optInEnvKey]?.trim() === "1";

  if (!enabled) {
    return {
      enabled: false,
      legacyPrefixes: [],
      maxItems: defaultMaxItems
    };
  }

  const cliOptions = parseAssetAttachmentMetadataAuditArgs(input.args ?? []);
  const envLegacyPrefixes = splitLegacyPrefixes(env[legacyPrefixesEnvKey]);
  const maxItems = cliOptions.maxItems ?? parseMaxItems(env[maxItemsEnvKey]) ?? defaultMaxItems;

  return {
    enabled,
    legacyPrefixes: [...envLegacyPrefixes, ...cliOptions.legacyPrefixes],
    maxItems
  };
}

export async function runAssetAttachmentMetadataAuditDryRun(input: {
  db: AssetAttachmentMetadataAuditDb;
  storage: AssetAttachmentMetadataAuditStorage;
  legacyPrefixes?: string[];
  maxItems?: number;
  now?: Date;
}): Promise<AssetAttachmentMetadataAuditReport> {
  const rows = await listAssetAttachmentMetadataAuditRows(input.db);

  return runAssetAttachmentMetadataAudit({
    adapter: createAssetAttachmentMetadataAuditReadAdapter(input.storage),
    rows,
    legacyPrefixes: input.legacyPrefixes,
    maxItems: input.maxItems,
    now: input.now
  });
}

export async function runAssetAttachmentMetadataAuditCli(input: {
  args?: string[];
  env?: AssetAttachmentMetadataAuditRunnerEnv;
  stdout?: Pick<typeof console, "log">;
  stderr?: Pick<typeof console, "error">;
  createRuntime?: () => AssetLockDbRuntime;
  resolveStorage?: () => AssetAttachmentMetadataAuditStorage;
  now?: Date;
} = {}): Promise<number> {
  const stdout = input.stdout ?? console;
  const stderr = input.stderr ?? console;

  try {
    const options = resolveAssetAttachmentMetadataAuditRunnerOptions({ args: input.args, env: input.env });

    if (!options.enabled) {
      stdout.log(
        formatAssetAttachmentMetadataAuditOutput({
          dryRun: true,
          status: "disabled",
          message: `${optInEnvKey} must be explicitly enabled before this dry-run audit reads metadata.`
        })
      );
      return 0;
    }

    const runtime = input.createRuntime?.() ?? createAssetLockDbRuntime();

    try {
      const report = await runAssetAttachmentMetadataAuditDryRun({
        db: runtime.db,
        storage: input.resolveStorage?.() ?? resolveAssetAttachmentStorage(),
        legacyPrefixes: options.legacyPrefixes,
        maxItems: options.maxItems,
        now: input.now
      });

      stdout.log(
        formatAssetAttachmentMetadataAuditOutput({
          dryRun: true,
          status: "completed",
          report
        })
      );
      return 0;
    } finally {
      await runtime.pool.end();
    }
  } catch {
    stderr.error(
      formatAssetAttachmentMetadataAuditOutput({
        dryRun: true,
        status: "failed",
        message: "asset_attachment_metadata_audit_failed"
      })
    );
    return 1;
  }
}

export async function listAssetAttachmentMetadataAuditRows(
  db: AssetAttachmentMetadataAuditDb
): Promise<AssetAttachmentMetadataAuditRow[]> {
  const rows = await db
    .select({
      id: assetAttachments.id,
      fileId: assetAttachments.fileId,
      fileName: assetAttachments.fileName,
      status: assetAttachments.status,
      sizeBytes: assetAttachments.sizeBytes,
      storageKey: assetAttachments.storageKey,
      checksumSha256: assetAttachments.checksumSha256
    })
    .from(assetAttachments);

  return rows.map((row) => ({
    id: row.id,
    fileId: row.fileId,
    fileName: row.fileName,
    status: row.status,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    checksumSha256: row.checksumSha256
  }));
}

export function createAssetAttachmentMetadataAuditReadAdapter(
  storage: AssetAttachmentMetadataAuditStorage
): AssetAttachmentMetadataAuditReadAdapter {
  return {
    makeKey: storage.makeKey,
    async get(input) {
      try {
        return await storage.get(input);
      } catch (error) {
        if (error instanceof AssetAttachmentStorageFileNotFoundError) {
          return null;
        }

        throw error;
      }
    }
  };
}

export function formatAssetAttachmentMetadataAuditOutput(output: AssetAttachmentMetadataAuditRunnerOutput) {
  return JSON.stringify(output, null, 2);
}

function parseAssetAttachmentMetadataAuditArgs(args: string[]) {
  const options: { legacyPrefixes: string[]; maxItems?: number } = {
    legacyPrefixes: []
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--legacy-prefix") {
      const value = args[index + 1];

      if (!value) {
        throw new Error("asset_attachment_metadata_audit_legacy_prefix_required");
      }

      options.legacyPrefixes.push(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--legacy-prefix=")) {
      const value = arg.slice("--legacy-prefix=".length);

      if (!value) {
        throw new Error("asset_attachment_metadata_audit_legacy_prefix_required");
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

    throw new Error("asset_attachment_metadata_audit_arg_invalid");
  }

  return options;
}

function splitLegacyPrefixes(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseMaxItems(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10000) {
    throw new Error("asset_attachment_metadata_audit_max_items_invalid");
  }

  return parsed;
}

function isDirectRun() {
  const scriptPath = process.argv[1];

  return Boolean(scriptPath && import.meta.url === pathToFileURL(scriptPath).href);
}

if (isDirectRun()) {
  void runAssetAttachmentMetadataAuditCli({ args: process.argv.slice(2) }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
