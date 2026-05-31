import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runAssetAttachmentStorageBackfillCli } from "./asset-attachment-storage-backfill";
import type { AssetLockDbRuntime } from "./runtime";
import type { AssetAttachmentMetadataAuditRow } from "../app/api/asset-lock-attachments/metadata-audit";
import { AssetAttachmentStorageFileNotFoundError, type AssetAttachmentStorage } from "../app/api/asset-lock-attachments/storage";

const now = new Date("2026-05-31T08:00:00.000Z");
const bytes = new Uint8Array([1, 2, 3]);
const checksumSha256 = sha256Hex(bytes);

describe("asset attachment storage backfill runner", () => {
  it("defaults to dry-run and does not call the DB update writer", async () => {
    const stdout = createOutputSink();
    const writeBatch = vi.fn();
    const exitCode = await runAssetAttachmentStorageBackfillCli({
      env: {
        DATABASE_URL: "postgres://secret-user:secret-pass@example.invalid/aigc"
      },
      stdout,
      stderr: createErrorSink(),
      createRuntime: () => createRuntimeForRows([row({ storageKey: null, checksumSha256: null })]),
      resolveStorage: () =>
        createStorage(new Map([["asset-att-123e4567-e89b-12d3-a456-426614174000.png", bytes]])),
      writeBatch,
      now
    });
    const output = stdout.output();

    expect(exitCode).toBe(0);
    expect(writeBatch).not.toHaveBeenCalled();
    expect(JSON.parse(output)).toEqual(
      expect.objectContaining({
        dryRun: true,
        status: "completed"
      })
    );
    expect(output).not.toContain("secret-user");
    expect(output).not.toContain("secret-pass");
    expect(output).not.toContain("asset-att-123e4567-e89b-12d3-a456-426614174000.png");
    expect(output).not.toContain(checksumSha256);
  });

  it("does not write when --write is passed without the confirm flag", async () => {
    const stdout = createOutputSink();
    const writeBatch = vi.fn();
    const exitCode = await runAssetAttachmentStorageBackfillCli({
      args: ["--write"],
      stdout,
      stderr: createErrorSink(),
      createRuntime: () => createRuntimeForRows([row({ storageKey: null, checksumSha256: null })]),
      resolveStorage: () =>
        createStorage(new Map([["asset-att-123e4567-e89b-12d3-a456-426614174000.png", bytes]])),
      writeBatch,
      now
    });
    const parsed = JSON.parse(stdout.output());

    expect(exitCode).toBe(0);
    expect(writeBatch).not.toHaveBeenCalled();
    expect(parsed.dryRun).toBe(true);
    expect(parsed.message).toContain("--confirm-asset-attachment-storage-backfill");
  });

  it("writes only after --write and confirm, and outputs a redacted summary", async () => {
    const stdout = createOutputSink();
    const writeBatch = vi.fn(async (_db, writes) => ({
      attemptedRowCount: writes.length,
      updatedRowCount: writes.length
    }));
    const acquireLock = vi.fn(async () => undefined);
    const releaseLock = vi.fn(async () => undefined);
    const exitCode = await runAssetAttachmentStorageBackfillCli({
      args: ["--write", "--confirm-asset-attachment-storage-backfill", "--batch-size", "10"],
      stdout,
      stderr: createErrorSink(),
      createRuntime: () => createRuntimeForRows([row({ storageKey: null, checksumSha256: null })]),
      resolveStorage: () =>
        createStorage(new Map([["asset-att-123e4567-e89b-12d3-a456-426614174000.png", bytes]])),
      writeBatch,
      acquireLock,
      releaseLock,
      now
    });
    const output = stdout.output();
    const parsed = JSON.parse(output);

    expect(exitCode).toBe(0);
    expect(writeBatch).toHaveBeenCalledTimes(1);
    expect(acquireLock).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(parsed).toEqual(
      expect.objectContaining({
        dryRun: false,
        status: "completed",
        writeResult: {
          batchSize: 10,
          attemptedRowCount: 1,
          updatedRowCount: 1,
          batchCount: 1
        }
      })
    );
    expect(output).not.toContain("asset-att-123e4567-e89b-12d3-a456-426614174000.png");
    expect(output).not.toContain(checksumSha256);
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
  const from = vi.fn(async () => rows);
  const select = vi.fn(() => ({ from }));

  return {
    db: { select } as unknown as AssetLockDbRuntime["db"],
    pool: {
      end: vi.fn(async () => undefined)
    } as unknown as AssetLockDbRuntime["pool"]
  };
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

function sha256Hex(input: Uint8Array) {
  return createHash("sha256").update(input).digest("hex");
}
