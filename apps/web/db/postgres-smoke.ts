import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedWorkspace, type WorkspaceState } from "@aigc/domain";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAssetLockDbRuntime, getAssetLockDbRuntime } from "./runtime";
import { readDbAssetLockRecordRepositorySnapshot } from "../app/api/asset-lock-records/db-repository";
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
const generatedDeliveryPackageId = `${deliveryPackagePrefix}generated-${runId}`;
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
    await seedSmokeDeliveryPackages();
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

  it("generates, creates, binds, uploads, deletes, projects, locks, and cleans asset data through Postgres", async () => {
    const generated = await mutateAssetLockRecord(
      {
        action: "generate_from_package",
        projectId,
        deliveryPackageId: generatedDeliveryPackageId
      },
      { userId: "user-head-writer" }
    );
    const generatedRecords = generated.records.filter((record) => record.deliveryPackageId === generatedDeliveryPackageId);
    const generatedSnapshot = await readDbAssetLockRecordRepositorySnapshot();
    const generatedSnapshotRecords = generatedSnapshot.assetLockRecords.filter(
      (record) => record.deliveryPackageId === generatedDeliveryPackageId
    );

    expect(generatedRecords.length).toBeGreaterThan(1);
    expect(generatedRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId,
          deliveryPackageId: generatedDeliveryPackageId,
          assetType: "scene",
          episodeNos: [1],
          createdByUserId: "user-head-writer"
        }),
        expect.objectContaining({
          projectId,
          deliveryPackageId: generatedDeliveryPackageId,
          assetType: "prop",
          createdByUserId: "user-head-writer"
        })
      ])
    );
    expect(generatedSnapshotRecords.map((record) => record.id).sort()).toEqual(
      generatedRecords.map((record) => record.id).sort()
    );

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

    const firstAttachment = await uploadAssetAttachment(
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
    const secondAttachment = await uploadAssetAttachment(
      {
        assetLockRecordId: created.record.id,
        attachmentType: "final",
        fileName: "smoke-final.png",
        mime: "image/png",
        fileBuffer: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]),
        note: "smoke second upload"
      },
      { userId: "user-head-writer" }
    );
    const activeAttachments = await listAssetAttachments(created.record.id, { userId: "user-head-writer" });

    expect(firstAttachment).toMatchObject({ version: 1 });
    expect(secondAttachment).toMatchObject({ version: 2 });
    expect(activeAttachments).toEqual([firstAttachment, secondAttachment]);

    const deletedFirstAttachment = await deleteAssetAttachment(firstAttachment.id, { userId: "user-head-writer" });
    expect(deletedFirstAttachment).toMatchObject({
      id: firstAttachment.id,
      status: "deleted",
      deletedByUserId: "user-head-writer"
    });
    expect(await listAssetAttachments(created.record.id, { userId: "user-head-writer" })).toEqual([secondAttachment]);

    const deletedSecondAttachment = await deleteAssetAttachment(secondAttachment.id, { userId: "user-head-writer" });
    expect(deletedSecondAttachment).toMatchObject({
      id: secondAttachment.id,
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

    await cleanupSmokeRows();
    await cleanupSmokeRows();
    await expect(countSmokeRows()).resolves.toEqual({
      attachments: 0,
      deliveryPackageEpisodes: 0,
      deliveryPackages: 0,
      records: 0,
      recordEpisodes: 0,
      sourceBindings: 0
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
    await runtime.pool.query(
      "delete from delivery_package_episodes where delivery_package_id like $1",
      [`${deliveryPackagePrefix}%`]
    );
    await runtime.pool.query(
      "delete from delivery_packages where id like $1",
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

async function countSmokeRows() {
  const runtime = createAssetLockDbRuntime(testDatabaseUrl);

  try {
    const [attachments, sourceBindings, recordEpisodes, records, deliveryPackageEpisodes, deliveryPackages] = await Promise.all([
      countRows(runtime, "select count(*)::int as count from asset_attachments where delivery_package_id like $1"),
      countRows(runtime, "select count(*)::int as count from script_source_bindings where delivery_package_id like $1"),
      countRows(
        runtime,
        `select count(*)::int as count from asset_lock_record_episodes
         where asset_lock_record_id in (
           select id from asset_lock_records where delivery_package_id like $1
         )`
      ),
      countRows(runtime, "select count(*)::int as count from asset_lock_records where delivery_package_id like $1"),
      countRows(runtime, "select count(*)::int as count from delivery_package_episodes where delivery_package_id like $1"),
      countRows(runtime, "select count(*)::int as count from delivery_packages where id like $1")
    ]);

    return {
      attachments,
      deliveryPackageEpisodes,
      deliveryPackages,
      records,
      recordEpisodes,
      sourceBindings
    };
  } finally {
    await runtime.pool.end();
  }
}

async function countRows(runtime: ReturnType<typeof createAssetLockDbRuntime>, sql: string) {
  const result = await runtime.pool.query<{ count: number }>(sql, [`${deliveryPackagePrefix}%`]);

  return result.rows[0]?.count ?? 0;
}

async function seedSmokeDeliveryPackages() {
  const runtime = createAssetLockDbRuntime(testDatabaseUrl);

  try {
    await runtime.pool.query("begin");
    await runtime.pool.query(
      `insert into delivery_packages (
         id,
         project_id,
         type,
         title,
         source_file_name,
         declared_episode_from,
         declared_episode_to,
         status,
         uploaded_by_user_id,
         submitted_by_user_id,
         reviewed_by_user_id,
         rejection_reason,
         created_at,
         submitted_at,
         published_at,
         rejected_at
       )
       values
         ($1, $2, 'range', 'M3 real Postgres smoke delivery', null, 1, 2, 'published', $3, $3, $4, null, $5, $5, $5, null),
         ($6, $2, 'range', 'M3 real Postgres generated smoke delivery', null, 1, 2, 'published', $3, $3, $4, null, $5, $5, $5, null)`,
      [deliveryPackageId, projectId, "user-head-writer", "user-owner", now, generatedDeliveryPackageId]
    );
    await runtime.pool.query(
      `insert into delivery_package_episodes (
         id,
         delivery_package_id,
         episode_no,
         title,
         content,
         is_confirmed_change
       )
       values
         ($1, $2, 1, 'Smoke episode 1', $3, true),
         ($4, $2, 2, 'Smoke episode 2', $5, true),
         ($6, $7, 1, 'Generated smoke episode 1', $8, true),
         ($9, $7, 2, 'Generated smoke episode 2', $10, true)`,
      [
        `${deliveryPackageId}-episode-1`,
        deliveryPackageId,
        "Smoke Mine Lift appears.\nSmoke Mine Lift source binding line.\nSmoke Mine Lift exits.",
        `${deliveryPackageId}-episode-2`,
        "Smoke background continuity line.",
        `${generatedDeliveryPackageId}-episode-1`,
        generatedDeliveryPackageId,
        "\u9435\u7926\u4e95\u5165\u53e3\u65b0\u589e\u5347\u964d\u7b3c\uff0c\u4f17\u4eba\u7b2c\u4e00\u6b21\u8fdb\u5165\u5317\u4e95\u3002",
        `${generatedDeliveryPackageId}-episode-2`,
        "\u7ea2\u8272\u5b89\u5168\u706f\u6cbf\u7528\uff0c\u5730\u56fe\u5c55\u5f00\uff0c\u7c89\u5c18\u7206\u95ea\u4f5c\u4e3a\u584c\u65b9\u524d\u5146\u3002"
      ]
    );
    await runtime.pool.query("commit");
  } catch (error) {
    await runtime.pool.query("rollback").catch(() => undefined);
    throw error;
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
    deliveryPackages: [],
    deliveryPackageEpisodes: []
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
