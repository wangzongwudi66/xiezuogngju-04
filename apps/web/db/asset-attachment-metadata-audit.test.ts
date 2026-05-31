import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assetAttachments } from "./schema/asset-lock-records";
import {
  listAssetAttachmentMetadataAuditRows,
  runAssetAttachmentMetadataAuditCli,
  runAssetAttachmentMetadataAuditDryRun
} from "./asset-attachment-metadata-audit";
import { AssetAttachmentStorageFileNotFoundError, type AssetAttachmentStorage } from "../app/api/asset-lock-attachments/storage";
import type { AssetAttachmentMetadataAuditRow } from "../app/api/asset-lock-attachments/metadata-audit";
import type { AssetLockDbRuntime } from "./runtime";

const now = new Date("2026-05-31T08:00:00.000Z");
const bytes = new Uint8Array([1, 2, 3]);
const checksumSha256 = sha256Hex(bytes);
type MockAuditDb = Pick<AssetLockDbRuntime["db"], "select"> & {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
};

describe("asset attachment metadata audit runner", () => {
  it("exits behind the env gate without reading DB or storage", async () => {
    const stdout = createOutputSink();
    const stderr = createErrorSink();
    const createRuntime = vi.fn(() => createRuntimeForRows([]));
    const resolveStorage = vi.fn(() => createStorage(new Map()));
    const exitCode = await runAssetAttachmentMetadataAuditCli({
      env: {
        DATABASE_URL: "postgres://secret-user:secret-pass@example.invalid/aigc",
        TEST_DATABASE_URL: "postgres://test-secret@example.invalid/aigc"
      },
      stdout,
      stderr,
      createRuntime,
      resolveStorage,
      now
    });
    const output = stdout.output();

    expect(exitCode).toBe(0);
    expect(createRuntime).not.toHaveBeenCalled();
    expect(resolveStorage).not.toHaveBeenCalled();
    expect(stderr.error).not.toHaveBeenCalled();
    expect(output).toContain("ASSET_ATTACHMENT_METADATA_AUDIT");
    expect(output).not.toContain("secret-user");
    expect(output).not.toContain("secret-pass");
    expect(output).not.toContain("test-secret");
  });

  it("selects only metadata fields needed for the audit", async () => {
    const db = createDbForRows([row()]);

    await listAssetAttachmentMetadataAuditRows(db);

    expect(Object.keys(db.select.mock.calls[0][0])).toEqual([
      "id",
      "fileId",
      "fileName",
      "status",
      "sizeBytes",
      "storageKey",
      "checksumSha256"
    ]);
    expect(db.from).toHaveBeenCalledWith(assetAttachments);
  });

  it("passes active and deleted rows into the metadata audit", async () => {
    const report = await runAssetAttachmentMetadataAuditDryRun({
      db: createDbForRows([
        row({ id: "attachment-active", status: "active", fileId: "asset-att-123e4567-e89b-12d3-a456-426614174001" }),
        row({ id: "attachment-deleted", status: "deleted", fileId: "asset-att-123e4567-e89b-12d3-a456-426614174002" })
      ]),
      storage: createStorage(
        new Map([
          ["asset-att-123e4567-e89b-12d3-a456-426614174001.png", bytes],
          ["asset-att-123e4567-e89b-12d3-a456-426614174002.png", bytes]
        ])
      ),
      now
    });

    expect(report.counts.inputRowCount).toBe(2);
    expect(report.counts.referencedRowCount).toBe(2);
    expect(report.statusCounts).toEqual({ active: 1, deleted: 1 });
  });

  it("uses legacy prefixes from env and CLI without outputting raw prefixes", async () => {
    const envLegacyPrefix = "private-env-prefix";
    const cliLegacyPrefix = "private-cli-prefix";
    const stdout = createOutputSink();
    const exitCode = await runAssetAttachmentMetadataAuditCli({
      env: {
        ASSET_ATTACHMENT_METADATA_AUDIT: "1",
        ASSET_ATTACHMENT_METADATA_AUDIT_LEGACY_PREFIXES: envLegacyPrefix
      },
      args: ["--legacy-prefix", cliLegacyPrefix, "--max-items", "100"],
      stdout,
      stderr: createErrorSink(),
      createRuntime: () =>
        createRuntimeForRows([
          row({
            id: "attachment-legacy",
            fileId: "asset-att-123e4567-e89b-12d3-a456-426614174003",
            storageKey: null
          })
        ]),
      resolveStorage: () =>
        createStorage(new Map([[`${cliLegacyPrefix}/asset-att-123e4567-e89b-12d3-a456-426614174003.png`, bytes]])),
      now
    });
    const parsed = JSON.parse(stdout.output());
    const serialized = stdout.output();

    expect(exitCode).toBe(0);
    expect(parsed.report.counts.readableRowCount).toBe(1);
    expect(parsed.report.reasonCounts.backfill_candidate).toBeGreaterThan(0);
    expect(serialized).not.toContain(envLegacyPrefix);
    expect(serialized).not.toContain(cliLegacyPrefix);
  });

  it("outputs only redacted ids, keys, and checksums", async () => {
    const rawStorageKey = "secret-bucket-prefix/asset-att-123e4567-e89b-12d3-a456-426614174004.png";
    const rawChecksumSha256 = sha256Hex(new Uint8Array([9, 9, 9]));
    const stdout = createOutputSink();
    const exitCode = await runAssetAttachmentMetadataAuditCli({
      env: { ASSET_ATTACHMENT_METADATA_AUDIT: "1" },
      stdout,
      stderr: createErrorSink(),
      createRuntime: () =>
        createRuntimeForRows([
          row({
            id: "attachment-secret-id",
            fileId: "asset-att-123e4567-e89b-12d3-a456-426614174004",
            storageKey: rawStorageKey,
            checksumSha256: rawChecksumSha256
          })
        ]),
      resolveStorage: () => createStorage(new Map([[rawStorageKey, bytes]])),
      now
    });
    const parsed = JSON.parse(stdout.output());
    const serialized = stdout.output();

    expect(exitCode).toBe(0);
    expect(parsed.report.items[0].attachmentIdHash).toBe(sha256Hex("attachment-secret-id"));
    expect(serialized).not.toContain("attachment-secret-id");
    expect(serialized).not.toContain(rawStorageKey);
    expect(serialized).not.toContain("secret-bucket-prefix");
    expect(serialized).not.toContain(rawChecksumSha256);
  });
});

function row(input: Partial<AssetAttachmentMetadataAuditRow> = {}): AssetAttachmentMetadataAuditRow {
  return {
    id: "attachment-default",
    fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000",
    fileName: "upload.png",
    status: "active",
    sizeBytes: bytes.byteLength,
    storageKey: null,
    checksumSha256,
    ...input
  };
}

function createRuntimeForRows(rows: AssetAttachmentMetadataAuditRow[]): AssetLockDbRuntime {
  return {
    db: createDbForRows(rows) as unknown as AssetLockDbRuntime["db"],
    pool: {
      end: vi.fn(async () => undefined)
    } as unknown as AssetLockDbRuntime["pool"]
  };
}

function createDbForRows(rows: AssetAttachmentMetadataAuditRow[]): MockAuditDb {
  const from = vi.fn(async () => rows);
  const select = vi.fn(() => ({ from }));

  return { select, from } as unknown as MockAuditDb;
}

function createStorage(objects: Map<string, Uint8Array>): Pick<AssetAttachmentStorage, "makeKey" | "get"> {
  return {
    makeKey: ({ fileId, extension }) => `${fileId}${extension}`,
    async get({ key }) {
      const object = objects.get(key);

      if (!object) {
        throw new AssetAttachmentStorageFileNotFoundError();
      }

      return object;
    }
  };
}

function createOutputSink() {
  const log = vi.fn();

  return {
    log,
    output() {
      return log.mock.calls.map(([line]) => line).join("\n");
    }
  };
}

function createErrorSink() {
  return {
    error: vi.fn()
  };
}

function sha256Hex(input: Uint8Array | string) {
  return createHash("sha256").update(input).digest("hex");
}
