import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedWorkspace, type WorkspaceState } from "@aigc/domain";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAssetLockDbRuntime, getAssetLockDbRuntime } from "./runtime";
import { mutateAssetLockRecord } from "../app/api/asset-lock-records/service";
import {
  deleteAssetAttachment,
  listAssetAttachments,
  uploadAssetAttachment
} from "../app/api/asset-lock-attachments/service";
import { getAssetDecisionTimelineProjection } from "../app/api/asset-decision-timeline/service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

if (!testDatabaseUrl) {
  throw new Error(
    "db_smoke_test_database_url_required: set TEST_DATABASE_URL to a dedicated disposable Postgres test database; DATABASE_URL is intentionally ignored."
  );
}

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  deliveryImportStorePath: process.env.AIGC_DELIVERY_IMPORT_STORE_PATH,
  attachmentFileDir: process.env.AIGC_ASSET_LOCK_ATTACHMENT_FILE_DIR,
  assetLockRecordsRepository: process.env.ASSET_LOCK_RECORDS_REPOSITORY,
  assetLockAttachmentsRepository: process.env.ASSET_LOCK_ATTACHMENTS_REPOSITORY
};

const projectId = "project-jincheng";
const deliveryPackagePrefix = "smoke-delivery-";
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const deliveryPackageId = `${deliveryPackagePrefix}${runId}`;
const now = "2026-05-30T00:00:00.000Z";

let tempDir = "";
let attachmentDir = "";

describe("real Postgres asset lock smoke", () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "aigc-postgres-smoke-"));
    attachmentDir = path.join(tempDir, "asset-lock-attachments");

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = path.join(tempDir, "delivery-import-store.json");
    process.env.AIGC_ASSET_LOCK_ATTACHMENT_FILE_DIR = attachmentDir;
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    process.env.ASSET_LOCK_ATTACHMENTS_REPOSITORY = "db";

    await applyMigrations();
    await cleanupSmokeRows();
    await writeSmokeWorkspaceStore();
  });

  afterAll(async () => {
    await cleanupSmokeRows();
    await closeAssetLockRuntime();
    restoreEnv();

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates, binds, uploads, deletes, projects, and locks asset data through Postgres", async () => {
    const created = await mutateAssetLockRecord(
      {
        action: "create",
        projectId,
        deliveryPackageId,
        episodeNos: [1],
        assetName: `Smoke Mine Lift ${runId}`,
        assetType: "scene",
        changeType: "new",
        risk: "attention",
        writerNote: "writer should verify the smoke asset"
      },
      { userId: "user-head-writer" }
    );
    expect(created.record).toMatchObject({
      projectId,
      deliveryPackageId,
      episodeNos: [1],
      assetType: "scene",
      changeType: "new",
      status: "draft"
    });

    const bound = await mutateAssetLockRecord(
      {
        action: "bind_source",
        assetLockRecordId: created.record.id,
        deliveryPackageId,
        episodeNo: 1,
        startLine: 2,
        endLine: 2
      },
      { userId: "user-head-writer" }
    );
    expect(bound.sourceBinding).toEqual(
      expect.objectContaining({
        projectId,
        deliveryPackageId,
        assetLockRecordId: created.record.id,
        excerptSnapshot: "Smoke Mine Lift source binding line."
      })
    );

    const projection = await getAssetDecisionTimelineProjection({
      projectId,
      deliveryPackageId,
      actor: { userId: "user-owner" }
    });
    expect(projection).toMatchObject({
      ok: true,
      projection: {
        decisionQueue: [expect.objectContaining({ assetLockRecordId: created.record.id })],
        sourceExcerpts: [
          expect.objectContaining({
            id: `source-binding-${bound.sourceBinding?.id}`,
            sourceKind: "explicit_binding",
            excerpt: "Smoke Mine Lift source binding line."
          })
        ]
      }
    });

    const attachment = await uploadAssetAttachment(
      {
        assetLockRecordId: created.record.id,
        attachmentType: "reference",
        fileName: "smoke-reference.png",
        mime: "image/png",
        fileBuffer: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        note: "smoke upload"
      },
      { userId: "user-head-writer" }
    );
    expect(await listAssetAttachments(created.record.id, { userId: "user-head-writer" })).toEqual([attachment]);

    const deletedAttachment = await deleteAssetAttachment(attachment.id, { userId: "user-head-writer" });
    expect(deletedAttachment).toMatchObject({
      id: attachment.id,
      status: "deleted",
      deletedByUserId: "user-head-writer"
    });
    expect(await listAssetAttachments(created.record.id, { userId: "user-head-writer" })).toEqual([]);

    const removed = await mutateAssetLockRecord(
      {
        action: "remove_source_binding",
        scriptSourceBindingId: bound.sourceBinding?.id ?? ""
      },
      { userId: "user-head-writer" }
    );
    expect(removed).toMatchObject({
      removedSourceBindingId: bound.sourceBinding?.id,
      sourceBindings: []
    });

    const writerConfirmed = await mutateAssetLockRecord(
      {
        action: "writer_confirm",
        assetLockRecordId: created.record.id,
        note: "writer smoke ok"
      },
      { userId: "user-head-writer" }
    );
    expect(writerConfirmed.record).toMatchObject({
      writerConfirmation: "confirmed",
      writerConfirmedByUserId: "user-head-writer",
      status: "draft"
    });

    const productionConfirmed = await mutateAssetLockRecord(
      {
        action: "production_confirm",
        assetLockRecordId: created.record.id,
        note: "production smoke ok"
      },
      { userId: "user-creator-a" }
    );
    expect(productionConfirmed.record).toMatchObject({
      productionConfirmation: "confirmed",
      productionConfirmedByUserId: "user-creator-a",
      status: "ready_to_lock"
    });

    const locked = await mutateAssetLockRecord(
      {
        action: "final_lock",
        assetLockRecordId: created.record.id
      },
      { userId: "user-owner" }
    );
    expect(locked.record).toMatchObject({
      id: created.record.id,
      status: "locked",
      finalLockedByUserId: "user-owner"
    });
  });
});

async function applyMigrations() {
  const runtime = createAssetLockDbRuntime(testDatabaseUrl);

  try {
    await migrate(runtime.db, {
      migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url))
    });
  } finally {
    await runtime.pool.end();
  }
}

async function cleanupSmokeRows() {
  const runtime = createAssetLockDbRuntime(testDatabaseUrl);

  try {
    await runtime.pool.query("begin");
    await runtime.pool.query(
      "delete from asset_attachments where delivery_package_id like $1",
      [`${deliveryPackagePrefix}%`]
    );
    await runtime.pool.query(
      "delete from script_source_bindings where delivery_package_id like $1",
      [`${deliveryPackagePrefix}%`]
    );
    await runtime.pool.query(
      `delete from asset_lock_record_episodes
       where asset_lock_record_id in (
         select id from asset_lock_records where delivery_package_id like $1
       )`,
      [`${deliveryPackagePrefix}%`]
    );
    await runtime.pool.query(
      "delete from asset_lock_records where delivery_package_id like $1",
      [`${deliveryPackagePrefix}%`]
    );
    await runtime.pool.query("commit");
  } catch (error) {
    await runtime.pool.query("rollback").catch(() => undefined);

    if (!isUndefinedTableError(error)) {
      throw error;
    }
  } finally {
    await runtime.pool.end();
  }
}

async function writeSmokeWorkspaceStore() {
  const workspace = buildSmokeWorkspace();
  const store = {
    version: 1,
    results: [],
    workspace,
    deliveryParseIssuesByPackageId: {}
  };

  await writeFile(process.env.AIGC_DELIVERY_IMPORT_STORE_PATH ?? "", JSON.stringify(store, null, 2), "utf8");
}

function buildSmokeWorkspace(): WorkspaceState {
  return {
    ...seedWorkspace,
    currentUserId: "user-owner",
    assetLockRecords: [],
    assetAttachments: [],
    scriptSourceBindings: [],
    deliveryPackages: [
      ...seedWorkspace.deliveryPackages,
      {
        id: deliveryPackageId,
        projectId,
        type: "range",
        title: "M3 real Postgres smoke delivery",
        declaredEpisodeFrom: 1,
        declaredEpisodeTo: 2,
        status: "published",
        uploadedByUserId: "user-head-writer",
        submittedByUserId: "user-head-writer",
        reviewedByUserId: "user-owner",
        createdAt: now,
        submittedAt: now,
        publishedAt: now
      }
    ],
    deliveryPackageEpisodes: [
      ...seedWorkspace.deliveryPackageEpisodes,
      {
        id: `${deliveryPackageId}-episode-1`,
        deliveryPackageId,
        episodeNo: 1,
        title: "Smoke episode 1",
        content: "Smoke Mine Lift appears.\nSmoke Mine Lift source binding line.\nSmoke Mine Lift exits.",
        isConfirmedChange: true
      },
      {
        id: `${deliveryPackageId}-episode-2`,
        deliveryPackageId,
        episodeNo: 2,
        title: "Smoke episode 2",
        content: "Smoke background continuity line.",
        isConfirmedChange: true
      }
    ]
  };
}

async function closeAssetLockRuntime() {
  try {
    await getAssetLockDbRuntime(testDatabaseUrl).pool.end();
  } catch {
    // The cached runtime is only created after DB-backed repositories are resolved.
  }
}

function restoreEnv() {
  restoreEnvValue("DATABASE_URL", originalEnv.databaseUrl);
  restoreEnvValue("AIGC_DELIVERY_IMPORT_STORE_PATH", originalEnv.deliveryImportStorePath);
  restoreEnvValue("AIGC_ASSET_LOCK_ATTACHMENT_FILE_DIR", originalEnv.attachmentFileDir);
  restoreEnvValue("ASSET_LOCK_RECORDS_REPOSITORY", originalEnv.assetLockRecordsRepository);
  restoreEnvValue("ASSET_LOCK_ATTACHMENTS_REPOSITORY", originalEnv.assetLockAttachmentsRepository);
}

function restoreEnvValue(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function isUndefinedTableError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42P01");
}
