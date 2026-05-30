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
import { createDeliveryImportJob, getDeliveryImportWorkspace } from "../app/api/delivery-import-jobs/service";
import { readDeliveryImportLocalWorkspaceState } from "../app/api/delivery-import-jobs/persistence";
import { readDbDeliveryPackageSnapshot } from "../app/api/delivery-packages/db-repository";
import { mutateDeliveryPackage } from "../app/api/delivery-packages/service";

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
const now = "2026-05-30T00:00:00.000Z";

let tempDir = "";
let attachmentDir = "";
let deliveryPackageId = "";

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
    await seedSmokeAuthScope();
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

  it("imports, publishes, generates, creates, binds, uploads, deletes, projects, locks, and cleans data through Postgres", async () => {
    deliveryPackageId = await createSmokeDeliveryImportDraft();
    await verifySmokeDeliveryPackageBasicMutations(deliveryPackageId);
    await publishSmokeDeliveryPackage(deliveryPackageId);

    const generated = await mutateAssetLockRecord(
      {
        action: "generate_from_package",
        projectId,
        deliveryPackageId
      },
      { userId: "user-head-writer" }
    );
    const generatedRecords = generated.records.filter((record) => record.deliveryPackageId === deliveryPackageId);
    const generatedSnapshot = await readDbAssetLockRecordRepositorySnapshot();
    const generatedSnapshotRecords = generatedSnapshot.assetLockRecords.filter(
      (record) => record.deliveryPackageId === deliveryPackageId
    );

    expect(generatedRecords.length).toBeGreaterThan(1);
    expect(generatedRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId,
          deliveryPackageId,
          assetType: "scene",
          episodeNos: [1],
          createdByUserId: "user-head-writer"
        }),
        expect.objectContaining({
          projectId,
          deliveryPackageId,
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
    if (!projection.ok) {
      throw new Error(`smoke_asset_timeline_projection_failed:${projection.error}`);
    }
    expect(projection.ok).toBe(true);
    expect(projection.projection.decisionQueue).toEqual(
      expect.arrayContaining([expect.objectContaining({ assetLockRecordId: created.record.id })])
    );
    expect(projection.projection.sourceExcerpts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `source-binding-${bound.sourceBinding?.id}`,
          sourceKind: "explicit_binding",
          excerpt: "Smoke Mine Lift source binding line."
        })
      ])
    );

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
      assignments: 0,
      deliveryPackageEpisodes: 0,
      deliveryPackages: 0,
      episodeCurrents: 0,
      episodeRevisions: 0,
      episodes: 0,
      memberPermissions: 0,
      members: 0,
      notifications: 0,
      projects: 0,
      records: 0,
      recordEpisodes: 0,
      sourceBindings: 0,
      users: 0
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
      "delete from asset_attachments where project_id = $1 or delivery_package_id like $2",
      [projectId, `${deliveryPackagePrefix}%`]
    );
    await runtime.pool.query(
      "delete from script_source_bindings where project_id = $1 or delivery_package_id like $2",
      [projectId, `${deliveryPackagePrefix}%`]
    );
    await runtime.pool.query(
      `delete from asset_lock_record_episodes
       where asset_lock_record_id in (
         select id from asset_lock_records where project_id = $1 or delivery_package_id like $2
       )`,
      [projectId, `${deliveryPackagePrefix}%`]
    );
    await runtime.pool.query(
      "delete from asset_lock_records where project_id = $1 or delivery_package_id like $2",
      [projectId, `${deliveryPackagePrefix}%`]
    );
    await runtime.pool.query(
      "delete from notifications where project_id = $1",
      [projectId]
    );
    await runtime.pool.query(
      "delete from episode_currents where project_id = $1",
      [projectId]
    );
    await runtime.pool.query(
      "delete from episode_revisions where project_id = $1",
      [projectId]
    );
    await runtime.pool.query(
      `delete from delivery_package_episodes
       where delivery_package_id like $1
          or delivery_package_id in (select id from delivery_packages where project_id = $2)`,
      [`${deliveryPackagePrefix}%`, projectId]
    );
    await runtime.pool.query(
      "delete from delivery_packages where project_id = $1 or id like $2",
      [projectId, `${deliveryPackagePrefix}%`]
    );
    await runtime.pool.query(
      "delete from episode_assignments where id like 'smoke-assignment-%'"
    );
    await runtime.pool.query(
      "delete from episodes where id like 'smoke-episode-%'"
    );
    await runtime.pool.query(
      "delete from project_member_permissions where id like 'smoke-permission-%'"
    );
    await runtime.pool.query(
      "delete from project_members where id like 'smoke-member-%'"
    );
    await runtime.pool.query(
      "delete from projects where id = $1",
      [projectId]
    );
    await runtime.pool.query(
      "delete from users where id in ($1, $2, $3)",
      ["user-head-writer", "user-owner", "user-creator-a"]
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
    const [
      attachments,
      sourceBindings,
      recordEpisodes,
      records,
      deliveryPackageEpisodes,
      deliveryPackages,
      episodeCurrents,
      episodeRevisions,
      assignments,
      episodes,
      memberPermissions,
      members,
      notifications,
      projects,
      users
    ] = await Promise.all([
      countRows(runtime, "select count(*)::int as count from asset_attachments where project_id = $1"),
      countRows(runtime, "select count(*)::int as count from script_source_bindings where project_id = $1"),
      countRows(
        runtime,
        `select count(*)::int as count from asset_lock_record_episodes
         where asset_lock_record_id in (
           select id from asset_lock_records where project_id = $1
         )`
      ),
      countRows(runtime, "select count(*)::int as count from asset_lock_records where project_id = $1"),
      countRows(
        runtime,
        `select count(*)::int as count from delivery_package_episodes
         where delivery_package_id in (select id from delivery_packages where project_id = $1)`
      ),
      countRows(runtime, "select count(*)::int as count from delivery_packages where project_id = $1"),
      countRows(runtime, "select count(*)::int as count from episode_currents where project_id = $1"),
      countRows(runtime, "select count(*)::int as count from episode_revisions where project_id = $1"),
      countRows(runtime, "select count(*)::int as count from episode_assignments where id like 'smoke-assignment-%'", []),
      countRows(runtime, "select count(*)::int as count from episodes where id like 'smoke-episode-%'", []),
      countRows(runtime, "select count(*)::int as count from project_member_permissions where id like 'smoke-permission-%'", []),
      countRows(runtime, "select count(*)::int as count from project_members where id like 'smoke-member-%'", []),
      countRows(runtime, "select count(*)::int as count from notifications where project_id = $1"),
      countRows(runtime, "select count(*)::int as count from projects where id = $1", [projectId]),
      countRows(runtime, "select count(*)::int as count from users where id in ($1, $2, $3)", [
        "user-head-writer",
        "user-owner",
        "user-creator-a"
      ])
    ]);

    return {
      attachments,
      assignments,
      deliveryPackageEpisodes,
      deliveryPackages,
      episodeCurrents,
      episodeRevisions,
      episodes,
      memberPermissions,
      members,
      notifications,
      projects,
      records,
      recordEpisodes,
      sourceBindings,
      users
    };
  } finally {
    await runtime.pool.end();
  }
}

async function countRows(
  runtime: ReturnType<typeof createAssetLockDbRuntime>,
  sql: string,
  params: unknown[] = [projectId]
) {
  const result = await runtime.pool.query<{ count: number }>(sql, params);

  return result.rows[0]?.count ?? 0;
}

async function seedSmokeAuthScope() {
  const runtime = createAssetLockDbRuntime(testDatabaseUrl);

  try {
    await runtime.pool.query("begin");
    await runtime.pool.query(
      `insert into users (id, name, default_role, avatar_tone)
       values
         ('user-head-writer', 'Smoke Head Writer', 'head_writer', 'violet'),
         ('user-owner', 'Smoke Owner', 'owner', 'amber'),
         ('user-creator-a', 'Smoke Creator A', 'creator', 'cyan')`
    );
    await runtime.pool.query(
      `insert into projects (id, name, code, episode_count, status, created_at)
       values ($1, 'Smoke Jincheng', 'SMK-JC', 2, 'active', $2)`,
      [projectId, now]
    );
    await runtime.pool.query(
      `insert into project_members (id, project_id, user_id, role, created_at)
       values
         ('smoke-member-head-writer', $1, 'user-head-writer', 'head_writer', $2),
         ('smoke-member-owner', $1, 'user-owner', 'owner', $2),
         ('smoke-member-creator-a', $1, 'user-creator-a', 'creator', $2)`,
      [projectId, now]
    );
    await runtime.pool.query(
      `insert into project_member_permissions (id, project_id, user_id, permission, granted_at)
       values
         ('smoke-permission-head-review-assets', $1, 'user-head-writer', 'canReviewAssets', $2),
         ('smoke-permission-owner-overview', $1, 'user-owner', 'canViewProjectOverview', $2),
         ('smoke-permission-creator-assigned', $1, 'user-creator-a', 'canViewAssignedEpisodes', $2)`,
      [projectId, now]
    );
    await runtime.pool.query(
      `insert into episodes (
         id,
         project_id,
         episode_no,
         title,
         production_status,
         has_unread_key_change,
         open_issue_count,
         asset_todo_count
       )
       values
         ('smoke-episode-jc-1', $1, 1, 'Smoke episode 1', 'not_started', false, 0, 0),
         ('smoke-episode-jc-2', $1, 2, 'Smoke episode 2', 'in_progress', false, 0, 0)`,
      [projectId]
    );
    await runtime.pool.query(
      `insert into episode_assignments (id, episode_id, user_id, responsibility, created_at)
       values
         ('smoke-assignment-head-writer-1', 'smoke-episode-jc-1', 'user-head-writer', 'writer', $1),
         ('smoke-assignment-head-writer-2', 'smoke-episode-jc-2', 'user-head-writer', 'writer', $1),
         ('smoke-assignment-creator-a-1', 'smoke-episode-jc-1', 'user-creator-a', 'creator', $1)`,
      [now]
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

async function createSmokeDeliveryImportDraft() {
  const result = await createDeliveryImportJob({
    source: "text",
    projectId,
    uploadedByUserId: "user-head-writer",
    declaredRangeText: "1-2",
    rawText: [
      "\u7b2c 1 \u96c6 \u70df\u96fe\u77ff\u4e95",
      "\u9435\u7926\u4e95\u5165\u53e3\u65b0\u589e\u5347\u964d\u7b3c\uff0c\u4f17\u4eba\u7b2c\u4e00\u6b21\u8fdb\u5165\u5317\u4e95\u3002",
      "Smoke Mine Lift source binding line.",
      "Smoke Mine Lift appears.",
      "\u7b2c 2 \u96c6 \u7ea2\u706f\u5730\u56fe",
      "\u7ea2\u8272\u5b89\u5168\u706f\u6cbf\u7528\uff0c\u5730\u56fe\u5c55\u5f00\uff0c\u7c89\u5c18\u7206\u95ea\u4f5c\u4e3a\u584c\u65b9\u524d\u5146\u3002"
    ].join("\n")
  });

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("smoke_delivery_import_failed");
  }

  const importedDeliveryPackageId = result.job.deliveryPackageId;
  expect(importedDeliveryPackageId).toBeTruthy();
  if (!importedDeliveryPackageId) {
    throw new Error("smoke_delivery_import_package_id_missing");
  }

  const dbWorkspace = await getDeliveryImportWorkspace();
  const dbDeliveryPackage = dbWorkspace.state.deliveryPackages.find((item) => item.id === importedDeliveryPackageId);
  const dbPackageEpisodes = dbWorkspace.state.deliveryPackageEpisodes.filter(
    (item) => item.deliveryPackageId === importedDeliveryPackageId
  );

  expect(dbDeliveryPackage).toMatchObject({
    projectId,
    status: "draft",
    declaredEpisodeFrom: 1,
    declaredEpisodeTo: 2
  });
  expect(dbPackageEpisodes.map((episode) => episode.episodeNo).sort()).toEqual([1, 2]);
  expect(dbPackageEpisodes.map((episode) => episode.content).join("\n")).toContain("Smoke Mine Lift source binding line.");

  const localWorkspace = await readDeliveryImportLocalWorkspaceState();
  expect(localWorkspace.deliveryPackages).toEqual([]);
  expect(localWorkspace.deliveryPackageEpisodes).toEqual([]);

  const dbSnapshot = await readDbDeliveryPackageSnapshot();
  const importedPackage = dbSnapshot.deliveryPackages.find((item) => item.id === importedDeliveryPackageId);

  expect(importedPackage).toEqual(dbDeliveryPackage);
  if (!importedPackage) {
    throw new Error("smoke_delivery_import_package_missing");
  }

  return importedDeliveryPackageId;
}

async function verifySmokeDeliveryPackageBasicMutations(importedDeliveryPackageId: string) {
  const confirmationSnapshot = await mutateDeliveryPackage({
    action: "update_confirmation",
    deliveryPackageId: importedDeliveryPackageId,
    confirmedEpisodeNos: [1]
  });
  const confirmedEpisodes = confirmationSnapshot.state.deliveryPackageEpisodes.filter(
    (episode) => episode.deliveryPackageId === importedDeliveryPackageId
  );

  expect(confirmedEpisodes.map((episode) => [episode.episodeNo, episode.isConfirmedChange])).toEqual([
    [1, true],
    [2, false]
  ]);

  const submittedSnapshot = await mutateDeliveryPackage({
    action: "submit",
    deliveryPackageId: importedDeliveryPackageId,
    actorUserId: "user-head-writer"
  });
  const submittedPackage = submittedSnapshot.state.deliveryPackages.find((item) => item.id === importedDeliveryPackageId);

  expect(submittedPackage).toMatchObject({
    status: "pending_review",
    submittedByUserId: "user-head-writer"
  });
  expect(submittedPackage?.submittedAt).toBeTruthy();
  await expectLocalDeliveryPackageStateToStayCanonical();

  const rejectedDeliveryPackageId = await createSmokeDeliveryImportDraft();

  await mutateDeliveryPackage({
    action: "update_confirmation",
    deliveryPackageId: rejectedDeliveryPackageId,
    confirmedEpisodeNos: [2]
  });
  await mutateDeliveryPackage({
    action: "submit",
    deliveryPackageId: rejectedDeliveryPackageId,
    actorUserId: "user-head-writer"
  });
  const rejectedSnapshot = await mutateDeliveryPackage({
    action: "reject",
    deliveryPackageId: rejectedDeliveryPackageId,
    actorUserId: "user-owner",
    rejectionReason: "smoke reject isolated package"
  });
  const rejectedPackage = rejectedSnapshot.state.deliveryPackages.find((item) => item.id === rejectedDeliveryPackageId);

  expect(rejectedPackage).toMatchObject({
    status: "rejected",
    reviewedByUserId: "user-owner",
    rejectionReason: "smoke reject isolated package"
  });
  expect(rejectedPackage?.rejectedAt).toBeTruthy();
  expect(rejectedDeliveryPackageId).not.toBe(importedDeliveryPackageId);
  await expectLocalDeliveryPackageStateToStayCanonical();
}

async function publishSmokeDeliveryPackage(importedDeliveryPackageId: string) {
  const beforePublishWorkspace = await getDeliveryImportWorkspace();
  const beforePublishPackage = beforePublishWorkspace.state.deliveryPackages.find(
    (item) => item.id === importedDeliveryPackageId
  );
  const beforePublishEpisode = beforePublishWorkspace.state.episodes.find((episode) => episode.id === "smoke-episode-jc-1");
  const beforeRevisionIds = new Set(beforePublishWorkspace.state.episodeRevisions.map((revision) => revision.id));
  const beforeNotificationIds = new Set(beforePublishWorkspace.state.notifications.map((notification) => notification.id));

  expect(beforePublishPackage).toMatchObject({
    status: "pending_review",
    submittedByUserId: "user-head-writer"
  });
  expect(beforePublishEpisode).toMatchObject({
    productionStatus: "not_started",
    hasUnreadKeyChange: false
  });

  const publishedSnapshot = await mutateDeliveryPackage({
    action: "publish",
    deliveryPackageId: importedDeliveryPackageId,
    actorUserId: "user-owner"
  });
  const state = publishedSnapshot.state;
  const publishedPackage = state.deliveryPackages.find((item) => item.id === importedDeliveryPackageId);
  const newRevisions = state.episodeRevisions.filter(
    (revision) => revision.deliveryPackageId === importedDeliveryPackageId && !beforeRevisionIds.has(revision.id)
  );
  const newNotifications = state.notifications.filter((notification) => !beforeNotificationIds.has(notification.id));
  const touchedEpisode = state.episodes.find((episode) => episode.id === "smoke-episode-jc-1");
  const untouchedEpisode = state.episodes.find((episode) => episode.id === "smoke-episode-jc-2");
  const current = state.episodeCurrents.find((item) => item.episodeId === "smoke-episode-jc-1");

  expect(publishedPackage).toMatchObject({
    status: "published",
    reviewedByUserId: "user-owner"
  });
  expect(publishedPackage?.publishedAt).toBeTruthy();
  expect(state.episodeRevisions).toHaveLength(beforePublishWorkspace.state.episodeRevisions.length + 1);
  expect(newRevisions).toHaveLength(1);
  expect(newRevisions[0]).toMatchObject({
    projectId,
    episodeId: "smoke-episode-jc-1",
    episodeNo: 1,
    deliveryPackageId: importedDeliveryPackageId,
    revisionNo: 1
  });
  expect(newRevisions[0]?.content).toContain("Smoke Mine Lift source binding line.");
  expect(state.episodeCurrents).toHaveLength(beforePublishWorkspace.state.episodeCurrents.length + 1);
  expect(current).toEqual(
    expect.objectContaining({
      projectId,
      episodeId: "smoke-episode-jc-1",
      currentRevisionId: newRevisions[0]?.id
    })
  );
  expect(touchedEpisode).toMatchObject({
    productionStatus: "key_update",
    hasUnreadKeyChange: true
  });
  expect(untouchedEpisode).toMatchObject({
    productionStatus: "in_progress",
    hasUnreadKeyChange: false
  });
  expect(state.notifications).toHaveLength(beforePublishWorkspace.state.notifications.length + 2);
  expect(newNotifications.map((notification) => notification.recipientId).sort()).toEqual([
    "user-creator-a",
    "user-head-writer"
  ]);
  expect(newNotifications).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        projectId,
        episodeId: "smoke-episode-jc-1",
        type: "key_change"
      })
    ])
  );
  await expectLocalDeliveryPackageStateToStayCanonical();
}

async function expectLocalDeliveryPackageStateToStayCanonical() {
  const localWorkspace = await readDeliveryImportLocalWorkspaceState();

  expect(localWorkspace.deliveryPackages).toEqual([]);
  expect(localWorkspace.deliveryPackageEpisodes).toEqual([]);
}

function buildSmokeWorkspace(): WorkspaceState {
  return {
    ...seedWorkspace,
    currentUserId: "user-owner",
    users: [],
    projects: [],
    members: [],
    memberPermissions: [],
    episodes: [],
    assignments: [],
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
