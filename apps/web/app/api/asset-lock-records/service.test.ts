import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loginAsUser, seedWorkspace, type AssetLockRecord, type ScriptSourceBinding, type WorkspaceState } from "@aigc/domain";
import { createDeliveryImportJob, getDeliveryImportWorkspace } from "../delivery-import-jobs/service";
import { mutateDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { mutateDeliveryPackage } from "../delivery-packages/service";
import * as assetLockRecordRepositoryModule from "./repository";
import type { AssetLockRecordRepositorySnapshot, DbAssetLockRecordRepository } from "./repository";
import {
  listAssetLockRecords as listAssetLockRecordsForActor,
  mutateAssetLockRecord as mutateAssetLockRecordForActor
} from "./service";

let currentActorUserId = "user-head-writer";

describe("asset lock record service", () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-asset-lock-records-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storeDir, { recursive: true });
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
    delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
    delete process.env.DATABASE_URL;
    await login("user-head-writer");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
    delete process.env.DATABASE_URL;
    await rm(storeDir, { recursive: true, force: true });
  });

  it("creates an asset lock record and persists it in the workspace", async () => {
    const deliveryPackageId = await createDraft();
    const result = await createAssetRecord(deliveryPackageId);
    const persisted = await getDeliveryImportWorkspace();

    expect(result.record).toMatchObject({
      projectId: "project-jincheng",
      deliveryPackageId,
      episodeNos: [1, 2],
      assetName: "Mine Lift",
      assetType: "scene",
      changeType: "new",
      risk: "attention",
      status: "draft"
    });
    expect(persisted.state.assetLockRecords).toContainEqual(result.record);
  });

  it("fails closed before writing local state when DB mode is requested without DATABASE_URL", async () => {
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    delete process.env.DATABASE_URL;
    const deliveryPackageId = await createDraft();
    const workspaceBefore = await getDeliveryImportWorkspace();

    await expect(createAssetRecord(deliveryPackageId, "Fail Closed Asset")).rejects.toThrow(
      "asset_lock_record_database_url_required"
    );
    await expect(getDeliveryImportWorkspace()).resolves.toEqual(workspaceBefore);
  });

  it("rejects DB-mode mutations that are intentionally not DB-backed before writing to local state", async () => {
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    process.env.DATABASE_URL = "postgres://example.invalid/aigc";
    const workspaceBefore = await getDeliveryImportWorkspace();

    await expect(
      mutateAssetLockRecord({
        action: "prepare_demo",
        projectId: "project-jincheng",
        actorUserId: "user-head-writer"
      })
    ).rejects.toThrow("asset_lock_record_db_mutation_unsupported:prepare_demo");
    await expect(getDeliveryImportWorkspace()).resolves.toEqual(workspaceBefore);
  });

  it("validates the local session user against DB-overlaid auth scope", async () => {
    const dbUser: WorkspaceState["users"][number] = {
      id: "user-db-session",
      name: "DB Session User",
      defaultRole: "head_writer",
      avatarTone: "violet"
    };
    const dbMember: WorkspaceState["members"][number] = {
      id: "member-db-session",
      projectId: "project-jincheng",
      userId: dbUser.id,
      role: "head_writer",
      createdAt: "2026-05-29T00:00:00.000Z"
    };
    const dbRecord: AssetLockRecord = {
      id: "asset-lock-db-session",
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-db-session",
      episodeNos: [1],
      assetName: "DB Session Lift",
      assetType: "scene",
      changeType: "new",
      writerConfirmation: "pending",
      productionConfirmation: "pending",
      risk: "attention",
      status: "draft",
      createdByUserId: dbUser.id,
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z"
    };
    const repository = createMockDbAssetLockRecordRepository(
      snapshotFromState({
        ...seedWorkspace,
        currentUserId: dbUser.id,
        users: [dbUser],
        members: [dbMember],
        assetLockRecords: [dbRecord]
      })
    );
    vi.spyOn(assetLockRecordRepositoryModule, "resolveAssetLockRecordRepository").mockReturnValue(repository);
    currentActorUserId = dbUser.id;

    await expect(listAssetLockRecords("project-jincheng")).resolves.toMatchObject({
      records: [dbRecord],
      summary: { total: 1 }
    });

    const missingDbUserRepository = createMockDbAssetLockRecordRepository(
      snapshotFromState({
        ...seedWorkspace,
        currentUserId: "user-local-only",
        users: seedWorkspace.users.filter((user) => user.id !== "user-local-only"),
        assetLockRecords: [dbRecord]
      })
    );
    vi.spyOn(assetLockRecordRepositoryModule, "resolveAssetLockRecordRepository").mockReturnValue(missingDbUserRepository);
    currentActorUserId = "user-local-only";

    await expect(listAssetLockRecords("project-jincheng")).rejects.toThrow("asset_lock_unauthenticated");
  });

  it("generates asset records from a package through the DB repository without mutating local workspace state", async () => {
    const deliveryPackageId = await createCandidateDraft();
    const workspace = await getDeliveryImportWorkspace();
    const dbDeliveryPackages = workspace.state.deliveryPackages.filter((item) => item.id === deliveryPackageId);
    const dbDeliveryPackageEpisodes = workspace.state.deliveryPackageEpisodes.filter(
      (item) => item.deliveryPackageId === deliveryPackageId
    );
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      deliveryPackages: [],
      deliveryPackageEpisodes: []
    }));
    const repository = createMockDbAssetLockRecordRepository(
      snapshotFromState({
        ...workspace.state,
        deliveryPackages: dbDeliveryPackages,
        deliveryPackageEpisodes: dbDeliveryPackageEpisodes
      })
    );
    vi.spyOn(assetLockRecordRepositoryModule, "resolveAssetLockRecordRepository").mockReturnValue(repository);

    const result = await mutateAssetLockRecord({
      action: "generate_from_package",
      projectId: "project-jincheng",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });
    const persisted = await getDeliveryImportWorkspace();

    expect(repository.read).toHaveBeenCalledTimes(1);
    expect(repository.createAssetLockRecords).toHaveBeenCalledTimes(1);
    expect(repository.createAssetLockRecord).not.toHaveBeenCalled();
    expect(repository.updateAssetLockRecord).not.toHaveBeenCalled();
    expect(repository.createSourceBinding).not.toHaveBeenCalled();
    expect(repository.removeSourceBinding).not.toHaveBeenCalled();
    expect(repository.createAssetLockRecords).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: "project-jincheng",
          deliveryPackageId,
          assetType: "scene",
          episodeNos: [1],
          createdByUserId: "user-head-writer"
        }),
        expect.objectContaining({
          projectId: "project-jincheng",
          deliveryPackageId,
          assetType: "prop",
          createdByUserId: "user-head-writer"
        })
      ])
    );
    expect(result.records.length).toBeGreaterThan(1);
    expect(result.records.every((record) => record.deliveryPackageId === deliveryPackageId)).toBe(true);
    expect(persisted.state.assetLockRecords ?? []).toEqual(workspace.state.assetLockRecords ?? []);
    expect(persisted.state.deliveryPackages).toEqual([]);
    expect(persisted.state.deliveryPackageEpisodes).toEqual([]);
  });

  it("does not call DB record writes when package generation rejects draft packages", async () => {
    const deliveryPackageId = await createCandidateDraft({ publish: false });
    const workspace = await getDeliveryImportWorkspace();
    const repository = createMockDbAssetLockRecordRepository(snapshotFromState(workspace.state));
    vi.spyOn(assetLockRecordRepositoryModule, "resolveAssetLockRecordRepository").mockReturnValue(repository);

    await expect(
      mutateAssetLockRecord({
        action: "generate_from_package",
        projectId: "project-jincheng",
        deliveryPackageId,
        actorUserId: "user-head-writer"
      })
    ).rejects.toThrow("published");

    expect(repository.read).toHaveBeenCalledTimes(1);
    expect(repository.createAssetLockRecords).not.toHaveBeenCalled();
    expect(repository.createAssetLockRecord).not.toHaveBeenCalled();
    expect(repository.updateAssetLockRecord).not.toHaveBeenCalled();
    expect(repository.createSourceBinding).not.toHaveBeenCalled();
    expect(repository.removeSourceBinding).not.toHaveBeenCalled();
  });

  it("does not call DB record writes when package generation finds no candidates", async () => {
    const deliveryPackageId = await createDraft();
    const workspace = await getDeliveryImportWorkspace();
    const repository = createMockDbAssetLockRecordRepository(snapshotFromState(workspace.state));
    vi.spyOn(assetLockRecordRepositoryModule, "resolveAssetLockRecordRepository").mockReturnValue(repository);

    await expect(
      mutateAssetLockRecord({
        action: "generate_from_package",
        projectId: "project-jincheng",
        deliveryPackageId,
        actorUserId: "user-head-writer"
      })
    ).rejects.toThrow("asset_lock_candidates_empty");

    expect(repository.read).toHaveBeenCalledTimes(1);
    expect(repository.createAssetLockRecords).not.toHaveBeenCalled();
    expect(repository.createAssetLockRecord).not.toHaveBeenCalled();
    expect(repository.updateAssetLockRecord).not.toHaveBeenCalled();
    expect(repository.createSourceBinding).not.toHaveBeenCalled();
    expect(repository.removeSourceBinding).not.toHaveBeenCalled();
  });

  it("returns existing DB records without a second write when package generation is idempotent", async () => {
    const deliveryPackageId = await createCandidateDraft();
    const workspace = await getDeliveryImportWorkspace();
    const repository = createMockDbAssetLockRecordRepository(snapshotFromState(workspace.state));
    vi.spyOn(assetLockRecordRepositoryModule, "resolveAssetLockRecordRepository").mockReturnValue(repository);

    const first = await mutateAssetLockRecord({
      action: "generate_from_package",
      projectId: "project-jincheng",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });
    const writesAfterFirstGenerate = vi.mocked(repository.createAssetLockRecords).mock.calls.length;
    const second = await mutateAssetLockRecord({
      action: "generate_from_package",
      projectId: "project-jincheng",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });

    expect(repository.read).toHaveBeenCalledTimes(2);
    expect(repository.createAssetLockRecords).toHaveBeenCalledTimes(1);
    expect(repository.createAssetLockRecords).toHaveBeenCalledTimes(writesAfterFirstGenerate);
    expect(second.records).toHaveLength(first.records.length);
    expect(second.records.map((record) => record.id).sort()).toEqual(first.records.map((record) => record.id).sort());
    expect(new Set(second.records.map((record) => record.assetName)).size).toBe(second.records.length);
  });

  it("binds source lines through the DB repository without mutating local workspace state", async () => {
    const deliveryPackageId = await createDraft();
    const record = (await createAssetRecord(deliveryPackageId)).record;
    const workspace = await getDeliveryImportWorkspace();
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      deliveryPackageEpisodes: state.deliveryPackageEpisodes.map((episode) =>
        episode.deliveryPackageId === deliveryPackageId && episode.episodeNo === 1
          ? { ...episode, content: "LOCAL STALE SOURCE" }
          : episode
      )
    }));
    const repository = createMockDbAssetLockRecordRepository(
      snapshotFromState({
        ...workspace.state,
        deliveryPackageEpisodes: workspace.state.deliveryPackageEpisodes.map((episode) =>
          episode.deliveryPackageId === deliveryPackageId && episode.episodeNo === 1
            ? { ...episode, content: "DB delivery package source line" }
            : episode
        )
      })
    );
    vi.spyOn(assetLockRecordRepositoryModule, "resolveAssetLockRecordRepository").mockReturnValue(repository);

    const result = await mutateAssetLockRecord({
      action: "bind_source",
      assetLockRecordId: record.id,
      deliveryPackageId,
      episodeNo: 1,
      startLine: 1,
      endLine: 1
    });
    const persisted = await getDeliveryImportWorkspace();

    expect(repository.read).toHaveBeenCalledTimes(1);
    expect(repository.createSourceBinding).toHaveBeenCalledTimes(1);
    expect(repository.removeSourceBinding).not.toHaveBeenCalled();
    expect(result.record).toEqual(record);
    expect(result.sourceBinding).toEqual(
      expect.objectContaining({
        assetLockRecordId: record.id,
        deliveryPackageId,
        episodeNo: 1,
        startLine: 1,
        endLine: 1,
        excerptSnapshot: "DB delivery package source line",
        createdByUserId: "user-head-writer"
      })
    );
    expect(result.sourceBinding?.excerptSnapshot).not.toBe("LOCAL STALE SOURCE");
    expect(result.sourceBindings).toEqual([result.sourceBinding]);
    expect(persisted.state.scriptSourceBindings ?? []).toEqual([]);
  });

  it("removes source bindings through the DB repository without mutating local workspace state", async () => {
    const deliveryPackageId = await createDraft();
    const record = (await createAssetRecord(deliveryPackageId)).record;
    const bound = await bindSource(record.id, deliveryPackageId);
    const sourceBinding = bound.sourceBinding;

    expect(sourceBinding).toBeTruthy();

    const workspace = await getDeliveryImportWorkspace();
    const repository = createMockDbAssetLockRecordRepository(snapshotFromState(workspace.state));
    vi.spyOn(assetLockRecordRepositoryModule, "resolveAssetLockRecordRepository").mockReturnValue(repository);

    const result = await mutateAssetLockRecord({
      action: "remove_source_binding",
      scriptSourceBindingId: sourceBinding?.id ?? ""
    });
    const persisted = await getDeliveryImportWorkspace();

    expect(repository.read).toHaveBeenCalledTimes(1);
    expect(repository.removeSourceBinding).toHaveBeenCalledWith(sourceBinding?.id);
    expect(repository.createSourceBinding).not.toHaveBeenCalled();
    expect(result.record).toEqual(record);
    expect(result.removedSourceBindingId).toBe(sourceBinding?.id);
    expect(result.sourceBindings).toEqual([]);
    expect(persisted.state.scriptSourceBindings ?? []).toContainEqual(sourceBinding);
  });

  it("updates lifecycle actions through the DB repository without mutating local workspace state", async () => {
    const deliveryPackageId = await createDraft();
    const lockRecord = (await createAssetRecord(deliveryPackageId, "DB Lifecycle Lock")).record;
    const needsInfoRecord = (await createAssetRecord(deliveryPackageId, "DB Lifecycle Needs Info")).record;
    const disputeRecord = (await createAssetRecord(deliveryPackageId, "DB Lifecycle Dispute")).record;
    const workspace = await getDeliveryImportWorkspace();
    const repository = createMockDbAssetLockRecordRepository(snapshotFromState(workspace.state));
    vi.spyOn(assetLockRecordRepositoryModule, "resolveAssetLockRecordRepository").mockReturnValue(repository);

    const writerConfirmed = await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId: lockRecord.id,
      confirmedByUserId: "user-head-writer",
      note: "writer ok"
    });
    await login("user-creator-a");
    const productionConfirmed = await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId: lockRecord.id,
      confirmedByUserId: "user-creator-a",
      note: "production ok"
    });
    await login("user-owner");
    const locked = await mutateAssetLockRecord({
      action: "final_lock",
      assetLockRecordId: lockRecord.id,
      lockedByUserId: "user-owner"
    });
    await login("user-creator-a");
    const needsInfo = await mutateAssetLockRecord({
      action: "needs_info",
      assetLockRecordId: needsInfoRecord.id,
      markedByUserId: "user-creator-a",
      missingInfo: "front reference missing"
    });
    await login("user-head-writer");
    const disputed = await mutateAssetLockRecord({
      action: "dispute",
      assetLockRecordId: disputeRecord.id,
      markedByUserId: "user-head-writer",
      disputeReason: "asset scope unclear"
    });
    const persisted = await getDeliveryImportWorkspace();

    expect(repository.read).toHaveBeenCalledTimes(5);
    expect(repository.updateAssetLockRecord).toHaveBeenCalledTimes(5);
    expect(repository.createAssetLockRecord).not.toHaveBeenCalled();
    expect(repository.createSourceBinding).not.toHaveBeenCalled();
    expect(repository.removeSourceBinding).not.toHaveBeenCalled();
    expect(writerConfirmed.record).toMatchObject({
      id: lockRecord.id,
      writerConfirmation: "confirmed",
      writerConfirmedByUserId: "user-head-writer",
      writerNote: "writer ok",
      status: "draft"
    });
    expect(productionConfirmed.record).toMatchObject({
      id: lockRecord.id,
      productionConfirmation: "confirmed",
      productionConfirmedByUserId: "user-creator-a",
      productionNote: "production ok",
      status: "ready_to_lock"
    });
    expect(locked.record).toMatchObject({
      id: lockRecord.id,
      status: "locked",
      finalLockedByUserId: "user-owner"
    });
    expect(needsInfo.record).toMatchObject({
      id: needsInfoRecord.id,
      writerConfirmation: "returned",
      productionConfirmation: "returned",
      status: "needs_info",
      missingInfo: "front reference missing"
    });
    expect(disputed.record).toMatchObject({
      id: disputeRecord.id,
      writerConfirmation: "returned",
      productionConfirmation: "returned",
      risk: "high",
      status: "disputed",
      disputeReason: "asset scope unclear"
    });
    expect(persisted.state.assetLockRecords).toEqual(workspace.state.assetLockRecords);
  });

  it("does not call DB source binding writes when validation rejects the mutation", async () => {
    const deliveryPackageId = await createDraftForRange(1, 21);
    const record = (await createAssetRecord(deliveryPackageId, "DB Validation Asset", [1, 21])).record;
    const bound = await bindSource(record.id, deliveryPackageId, { episodeNo: 1, startLine: 1, endLine: 1 });
    const sourceBinding = bound.sourceBinding;

    expect(sourceBinding).toBeTruthy();

    const workspace = await getDeliveryImportWorkspace();
    const resolveRepository = vi.spyOn(assetLockRecordRepositoryModule, "resolveAssetLockRecordRepository");
    const duplicateRepository = createMockDbAssetLockRecordRepository(snapshotFromState(workspace.state));
    resolveRepository.mockReturnValue(duplicateRepository);

    await expect(
      mutateAssetLockRecord({
        action: "bind_source",
        assetLockRecordId: record.id,
        deliveryPackageId,
        episodeNo: 1,
        startLine: 1,
        endLine: 1
      })
    ).rejects.toThrow("Script source binding already exists");
    expect(duplicateRepository.createSourceBinding).not.toHaveBeenCalled();

    const permissionRepository = createMockDbAssetLockRecordRepository(snapshotFromState(workspace.state));
    resolveRepository.mockReturnValue(permissionRepository);
    await login("user-writer");
    await expect(
      mutateAssetLockRecord({
        action: "bind_source",
        assetLockRecordId: record.id,
        deliveryPackageId,
        episodeNo: 21,
        startLine: 1,
        endLine: 1
      })
    ).rejects.toThrow("asset_lock_episode_scope_forbidden");
    expect(permissionRepository.createSourceBinding).not.toHaveBeenCalled();

    const lockedRepository = createMockDbAssetLockRecordRepository(
      snapshotFromState({
        ...workspace.state,
        assetLockRecords: (workspace.state.assetLockRecords ?? []).map((item) =>
          item.id === record.id ? { ...item, status: "locked" as const } : item
        )
      })
    );
    resolveRepository.mockReturnValue(lockedRepository);
    await login("user-head-writer");
    await expect(
      mutateAssetLockRecord({
        action: "remove_source_binding",
        scriptSourceBindingId: sourceBinding?.id ?? ""
      })
    ).rejects.toThrow("Locked asset lock records cannot change source bindings");
    expect(lockedRepository.removeSourceBinding).not.toHaveBeenCalled();
  });

  it("does not call DB record updates when lifecycle validation rejects the mutation", async () => {
    const deliveryPackageId = await createDraft();
    const record = (await createAssetRecord(deliveryPackageId, "DB Lifecycle Validation Asset")).record;
    const workspace = await getDeliveryImportWorkspace();
    const resolveRepository = vi.spyOn(assetLockRecordRepositoryModule, "resolveAssetLockRecordRepository");

    const permissionRepository = createMockDbAssetLockRecordRepository(snapshotFromState(workspace.state));
    resolveRepository.mockReturnValue(permissionRepository);
    await login("user-creator-a");
    await expect(
      mutateAssetLockRecord({
        action: "writer_confirm",
        assetLockRecordId: record.id,
        confirmedByUserId: "user-creator-a"
      })
    ).rejects.toThrow("asset_lock_action_forbidden");
    expect(permissionRepository.updateAssetLockRecord).not.toHaveBeenCalled();

    const lockedRepository = createMockDbAssetLockRecordRepository(
      snapshotFromState({
        ...workspace.state,
        assetLockRecords: (workspace.state.assetLockRecords ?? []).map((item) =>
          item.id === record.id ? { ...item, status: "locked" as const } : item
        )
      })
    );
    resolveRepository.mockReturnValue(lockedRepository);
    await login("user-head-writer");
    await expect(
      mutateAssetLockRecord({
        action: "writer_confirm",
        assetLockRecordId: record.id,
        confirmedByUserId: "user-head-writer"
      })
    ).rejects.toThrow();
    expect(lockedRepository.updateAssetLockRecord).not.toHaveBeenCalled();

    const statusRepository = createMockDbAssetLockRecordRepository(snapshotFromState(workspace.state));
    resolveRepository.mockReturnValue(statusRepository);
    await login("user-owner");
    await expect(
      mutateAssetLockRecord({
        action: "final_lock",
        assetLockRecordId: record.id,
        lockedByUserId: "user-owner"
      })
    ).rejects.toThrow();
    expect(statusRepository.updateAssetLockRecord).not.toHaveBeenCalled();
  });

  it("lists records by project and returns a summary", async () => {
    const deliveryPackageId = await createDraft();
    const created = await createAssetRecord(deliveryPackageId);
    await createAssetRecord(deliveryPackageId, "Mine Lift Backup");
    const listed = await listAssetLockRecords("project-jincheng");
    const allRecords = await listAssetLockRecords();

    expect(listed.records).toContainEqual(created.record);
    expect(allRecords.summary.total).toBe(2);
    expect(listed.summary).toMatchObject({
      total: 2,
      byStatus: {
        draft: 2
      },
      byRisk: {
        attention: 2
      },
      pendingWriterCount: 2,
      pendingProductionCount: 2
    });
    await expect(listAssetLockRecords("project-tide")).resolves.toMatchObject({
      records: [],
      summary: {
        total: 0
      }
    });
  });

  it("uses the explicit actor when workspace currentUserId differs for create and list", async () => {
    const deliveryPackageId = await createDraft();
    await mutateDeliveryImportWorkspace((state) => ({ ...state, currentUserId: "user-creator-b" }));
    currentActorUserId = "user-head-writer";

    const created = await mutateAssetLockRecord({
      action: "create",
      projectId: "project-jincheng",
      deliveryPackageId,
      episodeNos: [1, 2],
      assetName: "Actor Boundary Lift",
      assetType: "scene",
      changeType: "new",
      createdByUserId: "user-creator-b",
      risk: "attention"
    });
    const listed = await listAssetLockRecords("project-jincheng");

    expect(created.record.createdByUserId).toBe("user-head-writer");
    expect(created.records.map((record) => record.id)).toContain(created.record.id);
    expect(listed.records.map((record) => record.id)).toContain(created.record.id);
  });

  it("prepares demo delivery package and asset records for acceptance testing", async () => {
    await login("user-owner");
    const result = await mutateAssetLockRecord({
      action: "prepare_demo",
      projectId: "project-jincheng",
      actorUserId: "user-owner"
    });
    const workspace = await getDeliveryImportWorkspace();

    expect(result.summary.total).toBeGreaterThan(0);
    expect(result.records.length).toBeGreaterThan(0);
    expect(workspace.state.deliveryPackages).toContainEqual(
      expect.objectContaining({
        projectId: "project-jincheng",
        status: "published",
        sourceFileName: "asset-lock-demo.docx"
      })
    );
    expect(workspace.state.assetLockRecords?.length).toBeGreaterThan(0);
  });

  it("generates asset records from a published delivery package", async () => {
    const deliveryPackageId = await createCandidateDraft();
    const result = await mutateAssetLockRecord({
      action: "generate_from_package",
      projectId: "project-jincheng",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });

    expect(result.records.length).toBeGreaterThan(1);
    expect(result.records.every((record) => record.deliveryPackageId === deliveryPackageId)).toBe(true);
    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetType: "scene",
          episodeNos: [1]
        }),
        expect.objectContaining({
          assetType: "prop"
        })
      ])
    );
  });

  it("does not duplicate records when generating from the same package repeatedly", async () => {
    const deliveryPackageId = await createCandidateDraft();
    const first = await mutateAssetLockRecord({
      action: "generate_from_package",
      projectId: "project-jincheng",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });
    const second = await mutateAssetLockRecord({
      action: "generate_from_package",
      projectId: "project-jincheng",
      deliveryPackageId,
      actorUserId: "user-head-writer"
    });

    expect(second.records).toHaveLength(first.records.length);
    expect(new Set(second.records.map((record) => record.assetName)).size).toBe(second.records.length);
  });

  it("rejects generate_from_package for draft packages", async () => {
    const deliveryPackageId = await createCandidateDraft({ publish: false });

    await expect(
      mutateAssetLockRecord({
        action: "generate_from_package",
        projectId: "project-jincheng",
        deliveryPackageId,
        actorUserId: "user-head-writer"
      })
    ).rejects.toThrow("published");
  });

  it("rejects generate_from_package when no candidates are found", async () => {
    const deliveryPackageId = await createDraft();

    await expect(
      mutateAssetLockRecord({
        action: "generate_from_package",
        projectId: "project-jincheng",
        deliveryPackageId,
        actorUserId: "user-head-writer"
      })
    ).rejects.toThrow("asset_lock_candidates_empty");
  });

  it("prepares demo records from an existing published package using its real episodes", async () => {
    const deliveryPackageId = await createCandidateDraft();
    const result = await mutateAssetLockRecord({
      action: "prepare_demo",
      projectId: "project-jincheng",
      actorUserId: "user-head-writer"
    });

    expect(result.records.every((record) => record.deliveryPackageId === deliveryPackageId)).toBe(true);
    expect(result.records.flatMap((record) => record.episodeNos).every((episodeNo) => episodeNo === 1 || episodeNo === 2)).toBe(true);
  });

  it("ignores client-controlled state fields on create", async () => {
    const deliveryPackageId = await createDraft();
    const result = await mutateAssetLockRecord({
      action: "create",
      projectId: "project-jincheng",
      deliveryPackageId,
      episodeNos: [1, 2],
      assetName: "Client Spoof",
      assetType: "scene",
      changeType: "new",
      createdByUserId: "user-head-writer",
      risk: "attention",
      writerNote: "writer note",
      status: "locked",
      finalLockedByUserId: "user-owner",
      writerConfirmation: "confirmed",
      productionConfirmation: "confirmed"
    } as Parameters<typeof mutateAssetLockRecord>[0]);

    expect(result.record).toMatchObject({
      status: "draft",
      writerConfirmation: "pending",
      productionConfirmation: "pending"
    });
    expect(result.record.finalLockedByUserId).toBeUndefined();
  });

  it("rejects duplicate asset names within one delivery package", async () => {
    const deliveryPackageId = await createDraft();
    await createAssetRecord(deliveryPackageId);

    await expect(createAssetRecord(deliveryPackageId, "  Mine   Lift  ")).rejects.toThrow(
      "同一交稿包内已存在同名资产核对记录"
    );
  });

  it("rejects cross-project packages, draft packages, and episode numbers outside the package", async () => {
    const draftDeliveryPackageId = await createDraft({ publish: false });
    const publishedDeliveryPackageId = await createDraft();

    await expect(
      mutateAssetLockRecord({
        action: "create",
        projectId: "project-tide",
        deliveryPackageId: publishedDeliveryPackageId,
        episodeNos: [1],
        assetName: "Cross Project",
        assetType: "scene",
        changeType: "new",
        createdByUserId: "user-creator-a"
      })
    ).rejects.toThrow();
    await expect(
      mutateAssetLockRecord({
        action: "create",
        projectId: "project-jincheng",
        deliveryPackageId: draftDeliveryPackageId,
        episodeNos: [1],
        assetName: "Draft Package",
        assetType: "scene",
        changeType: "new",
        createdByUserId: "user-head-writer"
      })
    ).rejects.toThrow("published");
    await expect(
      mutateAssetLockRecord({
        action: "create",
        projectId: "project-jincheng",
        deliveryPackageId: publishedDeliveryPackageId,
        episodeNos: [3],
        assetName: "Wrong Episode",
        assetType: "scene",
        changeType: "new",
        createdByUserId: "user-head-writer"
      })
    ).rejects.toThrow();
  });

  it("records writer and production confirmations", async () => {
    const record = (await createAssetRecord(await createDraft())).record;
    const writerConfirmed = await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-head-writer",
      note: "writer ok"
    });
    await login("user-creator-a");
    const productionConfirmed = await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-creator-a",
      note: "production ok"
    });

    expect(writerConfirmed.record).toMatchObject({
      writerConfirmation: "confirmed",
      writerConfirmedByUserId: "user-head-writer",
      writerNote: "writer ok",
      status: "draft"
    });
    expect(productionConfirmed.record).toMatchObject({
      productionConfirmation: "confirmed",
      productionConfirmedByUserId: "user-creator-a",
      productionNote: "production ok",
      status: "ready_to_lock"
    });
  });

  it("binds script source lines using the server session user and persists the snapshot", async () => {
    const deliveryPackageId = await createDraft();
    const record = (await createAssetRecord(deliveryPackageId)).record;
    const result = await mutateAssetLockRecord({
      action: "bind_source",
      assetLockRecordId: record.id,
      deliveryPackageId,
      episodeNo: 1,
      startLine: 1,
      endLine: 1,
      createdByUserId: "user-owner",
      actorUserId: "user-owner",
      excerptSnapshot: "client supplied source"
    } as Parameters<typeof mutateAssetLockRecord>[0]);
    const persisted = await getDeliveryImportWorkspace();

    expect(result.record).toEqual(record);
    expect(result.sourceBinding).toEqual(
      expect.objectContaining({
        projectId: "project-jincheng",
        deliveryPackageId,
        assetLockRecordId: record.id,
        episodeNo: 1,
        startLine: 1,
        endLine: 1,
        createdByUserId: "user-head-writer"
      })
    );
    expect(result.sourceBinding?.excerptSnapshot).toBeTruthy();
    expect(result.sourceBinding?.excerptSnapshot).not.toBe("client supplied source");
    expect(persisted.state.scriptSourceBindings).toContainEqual(result.sourceBinding);
  });

  it("removes source bindings while preserving the mutated asset record response", async () => {
    const deliveryPackageId = await createDraft();
    const record = (await createAssetRecord(deliveryPackageId)).record;
    const bound = await bindSource(record.id, deliveryPackageId);

    expect(bound.sourceBinding).toBeTruthy();

    const removed = await mutateAssetLockRecord({
      action: "remove_source_binding",
      scriptSourceBindingId: bound.sourceBinding?.id ?? ""
    });
    const persisted = await getDeliveryImportWorkspace();

    expect(removed.record).toEqual(record);
    expect(removed.removedSourceBindingId).toBe(bound.sourceBinding?.id);
    expect(persisted.state.scriptSourceBindings ?? []).toEqual([]);
  });

  it("lists source bindings visible to the current viewer", async () => {
    const deliveryPackageId = await createDraftForRange(1, 21);
    const record = (await createAssetRecord(deliveryPackageId, "Wide Range Source", [1, 21])).record;
    const inScope = await bindSource(record.id, deliveryPackageId, { episodeNo: 1 });
    await login("user-head-writer");
    const outOfScope = await bindSource(record.id, deliveryPackageId, { episodeNo: 21 });

    await login("user-writer");
    const writerList = await listAssetLockRecords("project-jincheng");
    expect(writerList.sourceBindings.map((binding) => binding.id)).toEqual([inScope.sourceBinding?.id]);

    await login("user-head-writer");
    const headWriterList = await listAssetLockRecords("project-jincheng");
    expect(headWriterList.sourceBindings.map((binding) => binding.id).sort()).toEqual(
      [inScope.sourceBinding?.id, outOfScope.sourceBinding?.id].sort()
    );
  });

  it("allows writers to bind only their assigned source episodes", async () => {
    const deliveryPackageId = await createDraft();
    const record = (await createAssetRecord(deliveryPackageId)).record;

    await login("user-writer");
    await expect(bindSource(record.id, deliveryPackageId, { episodeNo: 1 })).resolves.toMatchObject({
      sourceBinding: expect.objectContaining({
        episodeNo: 1,
        createdByUserId: "user-writer"
      })
    });

    const outOfScopeDeliveryPackageId = await createDraftForRange(21, 22);
    const outOfScopeRecord = (await createAssetRecord(outOfScopeDeliveryPackageId, "Episode Twenty One Asset", [21])).record;
    await login("user-writer");
    await expect(bindSource(outOfScopeRecord.id, outOfScopeDeliveryPackageId, { episodeNo: 21 })).rejects.toThrow(
      "asset_lock_episode_scope_forbidden"
    );
  });

  it("checks writer remove permissions against the exact binding episode", async () => {
    const deliveryPackageId = await createDraftForRange(1, 21);
    const record = (await createAssetRecord(deliveryPackageId, "Wide Range Asset", [1, 21])).record;
    const inScopeBinding = await bindSource(record.id, deliveryPackageId, { episodeNo: 1, startLine: 1, endLine: 1 });
    await login("user-head-writer");
    const outOfScopeBinding = await bindSource(record.id, deliveryPackageId, { episodeNo: 21, startLine: 1, endLine: 1 });

    await login("user-writer");
    await expect(
      mutateAssetLockRecord({
        action: "remove_source_binding",
        scriptSourceBindingId: outOfScopeBinding.sourceBinding?.id ?? ""
      })
    ).rejects.toThrow("asset_lock_episode_scope_forbidden");
    await expect(
      mutateAssetLockRecord({
        action: "remove_source_binding",
        scriptSourceBindingId: inScopeBinding.sourceBinding?.id ?? ""
      })
    ).resolves.toMatchObject({
      removedSourceBindingId: inScopeBinding.sourceBinding?.id
    });
  });

  it("rejects creators and locked records for source binding mutations", async () => {
    const deliveryPackageId = await createDraft();
    const record = (await createAssetRecord(deliveryPackageId)).record;

    await login("user-creator-a");
    await expect(bindSource(record.id, deliveryPackageId)).rejects.toThrow("asset_lock_action_forbidden");

    await login("user-head-writer");
    const bound = await bindSource(record.id, deliveryPackageId);
    await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-head-writer"
    });
    await login("user-creator-a");
    await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-creator-a"
    });
    await login("user-owner");
    await mutateAssetLockRecord({
      action: "final_lock",
      assetLockRecordId: record.id,
      lockedByUserId: "user-owner"
    });

    await expect(
      mutateAssetLockRecord({
        action: "remove_source_binding",
        scriptSourceBindingId: bound.sourceBinding?.id ?? ""
      })
    ).rejects.toThrow("Locked asset lock records cannot change source bindings");
    await expect(bindSource(record.id, deliveryPackageId, { startLine: 2, endLine: 2 })).rejects.toThrow(
      "Locked asset lock records cannot change source bindings"
    );
  });

  it("marks records as needing information or disputed", async () => {
    const needsInfoRecord = (await createAssetRecord(await createDraft())).record;
    await login("user-creator-a");
    const needsInfo = await mutateAssetLockRecord({
      action: "needs_info",
      assetLockRecordId: needsInfoRecord.id,
      markedByUserId: "user-creator-a",
      missingInfo: "front reference missing"
    });
    const disputedRecord = (await createAssetRecord(await createDraft())).record;
    await login("user-head-writer");
    const disputed = await mutateAssetLockRecord({
      action: "dispute",
      assetLockRecordId: disputedRecord.id,
      markedByUserId: "user-head-writer",
      disputeReason: "asset scope unclear"
    });

    expect(needsInfo.record).toMatchObject({
      status: "needs_info",
      missingInfo: "front reference missing"
    });
    expect(disputed.record).toMatchObject({
      status: "disputed",
      risk: "high",
      disputeReason: "asset scope unclear"
    });
  });

  it("final locks only after required confirmations", async () => {
    const record = (await createAssetRecord(await createDraft())).record;

    await expect(
      mutateAssetLockRecord({
        action: "final_lock",
        assetLockRecordId: record.id,
        lockedByUserId: "user-owner"
      })
    ).rejects.toThrow();

    await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-head-writer"
    });
    await login("user-creator-a");
    await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-creator-a"
    });
    await login("user-owner");
    const locked = await mutateAssetLockRecord({
      action: "final_lock",
      assetLockRecordId: record.id,
      lockedByUserId: "user-owner"
    });

    expect(locked.record).toMatchObject({
      status: "locked",
      finalLockedByUserId: "user-owner"
    });
    expect(locked.record.finalLockedAt).toBeTruthy();

    await login("user-owner");
    await expect(
      mutateAssetLockRecord({
        action: "writer_confirm",
        assetLockRecordId: record.id,
        confirmedByUserId: "user-head-writer"
      })
    ).rejects.toThrow("资产已定版，不能修改资产核对记录");
    await expect(
      mutateAssetLockRecord({
        action: "final_lock",
        assetLockRecordId: record.id,
        lockedByUserId: "user-owner"
      })
    ).rejects.toThrow("资产已定版，不能重复定版");
  });

  it("does not final lock records that still need information or are disputed", async () => {
    const needsInfoRecord = (await createAssetRecord(await createDraft())).record;
    await login("user-creator-a");
    await mutateAssetLockRecord({
      action: "needs_info",
      assetLockRecordId: needsInfoRecord.id,
      markedByUserId: "user-creator-a",
      missingInfo: "front reference missing"
    });

    await login("user-owner");
    await expect(
      mutateAssetLockRecord({
        action: "final_lock",
        assetLockRecordId: needsInfoRecord.id,
        lockedByUserId: "user-owner"
      })
    ).rejects.toThrow();

    const disputedRecord = (await createAssetRecord(await createDraft())).record;
    await login("user-head-writer");
    await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId: disputedRecord.id,
      confirmedByUserId: "user-head-writer"
    });
    await login("user-creator-a");
    await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId: disputedRecord.id,
      confirmedByUserId: "user-creator-a"
    });
    await login("user-head-writer");
    await mutateAssetLockRecord({
      action: "dispute",
      assetLockRecordId: disputedRecord.id,
      markedByUserId: "user-head-writer",
      disputeReason: "asset scope unclear"
    });

    await login("user-owner");
    await expect(
      mutateAssetLockRecord({
        action: "final_lock",
        assetLockRecordId: disputedRecord.id,
        lockedByUserId: "user-owner"
      })
    ).rejects.toThrow();
  });

  it("returns clear errors for missing records and does not corrupt the workspace", async () => {
    const before = await getDeliveryImportWorkspace();

    await expect(
      mutateAssetLockRecord({
        action: "writer_confirm",
        assetLockRecordId: "missing-record",
        confirmedByUserId: "user-head-writer"
      })
    ).rejects.toThrow();
    await expect(getDeliveryImportWorkspace()).resolves.toEqual(before);
  });

  it("rejects actors without the required role for each action", async () => {
    const record = (await createAssetRecord(await createDraft())).record;

    await login("user-creator-a");
    await expect(
      mutateAssetLockRecord({
        action: "writer_confirm",
        assetLockRecordId: record.id,
        confirmedByUserId: "user-creator-a"
      })
    ).rejects.toThrow();
    await login("user-writer");
    await expect(
      mutateAssetLockRecord({
        action: "production_confirm",
        assetLockRecordId: record.id,
        confirmedByUserId: "user-writer"
      })
    ).rejects.toThrow();
    await login("user-head-writer");
    await mutateAssetLockRecord({
      action: "writer_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-head-writer"
    });
    await login("user-creator-a");
    await mutateAssetLockRecord({
      action: "production_confirm",
      assetLockRecordId: record.id,
      confirmedByUserId: "user-creator-a"
    });
    await login("user-writer");
    await expect(
      mutateAssetLockRecord({
        action: "final_lock",
        assetLockRecordId: record.id,
        lockedByUserId: "user-writer"
      })
    ).rejects.toThrow();
    await login("user-creator-a");
    await expect(
      mutateAssetLockRecord({
        action: "final_lock",
        assetLockRecordId: record.id,
        lockedByUserId: "user-creator-a"
      })
    ).rejects.toThrow();
  });

  it("handles legacy workspaces without asset lock records or source bindings", async () => {
    const { assetLockRecords, scriptSourceBindings, ...legacyWorkspace } = seedWorkspace;
    await writeFile(
      join(storeDir, "store.json"),
      JSON.stringify({
        version: 1,
        results: [],
        workspace: legacyWorkspace,
        deliveryParseIssuesByPackageId: {}
      }),
      "utf8"
    );
    await login("user-head-writer");

    await expect(listAssetLockRecords("project-jincheng")).resolves.toMatchObject({
      records: [],
      summary: {
        total: 0
      }
    });

    const deliveryPackageId = await createDraft();
    const result = await createAssetRecord(deliveryPackageId);
    const bound = await bindSource(result.record.id, deliveryPackageId);
    const persisted = await getDeliveryImportWorkspace();

    expect(Array.isArray(persisted.state.assetLockRecords)).toBe(true);
    expect(persisted.state.assetLockRecords).toContainEqual(result.record);
    expect(Array.isArray(persisted.state.scriptSourceBindings)).toBe(true);
    expect(persisted.state.scriptSourceBindings).toContainEqual(bound.sourceBinding);
  });
});

async function createDraft(input: { publish?: boolean } = {}) {
  const result = await createDeliveryImportJob({
    source: "text",
    projectId: "project-jincheng",
    uploadedByUserId: "user-head-writer",
    declaredRangeText: "1-2",
    rawText: "\u7b2c 1 \u96c6 \u5f00\u573a\n\u6b63\u6587\u4e00\n\u7b2c 2 \u96c6 \u8ffd\u8e2a\n\u6b63\u6587\u4e8c"
  });

  expect(result.ok).toBe(true);
  if (!result.ok || !result.job.deliveryPackageId) {
    throw new Error("delivery package draft was not created");
  }

  const deliveryPackageId = result.job.deliveryPackageId;

  if (input.publish === false) {
    return deliveryPackageId;
  }

  await mutateDeliveryPackage({
    action: "submit",
    deliveryPackageId,
    actorUserId: "user-head-writer"
  });
  await mutateDeliveryPackage({
    action: "publish",
    deliveryPackageId,
    actorUserId: "user-owner"
  });

  return deliveryPackageId;
}

async function createCandidateDraft(input: { publish?: boolean } = {}) {
  const result = await createDeliveryImportJob({
    source: "text",
    projectId: "project-jincheng",
    uploadedByUserId: "user-head-writer",
    declaredRangeText: "1-2",
    rawText:
      "\u7b2c 1 \u96c6\n\u9435\u7926\u4e95\u5165\u53e3\u65b0\u589e\u5347\u964d\u7b3c\uff0c\u4f17\u4eba\u7b2c\u4e00\u6b21\u8fdb\u5165\u5317\u4e95\u3002\n\u7b2c 2 \u96c6\n\u7ea2\u8272\u5b89\u5168\u706f\u6cbf\u7528\uff0c\u5730\u56fe\u5c55\u5f00\uff0c\u7c89\u5c18\u7206\u95ea\u4f5c\u4e3a\u584c\u65b9\u524d\u5146\u3002"
  });

  expect(result.ok).toBe(true);
  if (!result.ok || !result.job.deliveryPackageId) {
    throw new Error("delivery package draft was not created");
  }

  const deliveryPackageId = result.job.deliveryPackageId;

  if (input.publish === false) {
    return deliveryPackageId;
  }

  await mutateDeliveryPackage({
    action: "submit",
    deliveryPackageId,
    actorUserId: "user-head-writer"
  });
  await mutateDeliveryPackage({
    action: "publish",
    deliveryPackageId,
    actorUserId: "user-owner"
  });

  return deliveryPackageId;
}

async function createDraftForRange(episodeFrom: number, episodeTo: number) {
  const rawText = Array.from({ length: episodeTo - episodeFrom + 1 }, (_, index) => {
    const episodeNo = episodeFrom + index;
    return `第 ${episodeNo} 集\nEpisode ${episodeNo} source line`;
  }).join("\n");
  const result = await createDeliveryImportJob({
    source: "text",
    projectId: "project-jincheng",
    uploadedByUserId: "user-head-writer",
    declaredRangeText: `${episodeFrom}-${episodeTo}`,
    rawText
  });

  expect(result.ok).toBe(true);
  if (!result.ok || !result.job.deliveryPackageId) {
    throw new Error("delivery package draft was not created");
  }

  const deliveryPackageId = result.job.deliveryPackageId;

  await mutateDeliveryPackage({
    action: "submit",
    deliveryPackageId,
    actorUserId: "user-head-writer"
  });
  await mutateDeliveryPackage({
    action: "publish",
    deliveryPackageId,
    actorUserId: "user-owner"
  });

  return deliveryPackageId;
}

async function createAssetRecord(deliveryPackageId: string, assetName = "Mine Lift", episodeNos = [1, 2]) {
  await login("user-head-writer");
  return mutateAssetLockRecord({
    action: "create",
    projectId: "project-jincheng",
    deliveryPackageId,
    episodeNos,
    assetName,
    assetType: "scene",
    changeType: "new",
    createdByUserId: "user-head-writer",
    risk: "attention",
    writerNote: "writer note"
  });
}

async function bindSource(
  assetLockRecordId: string,
  deliveryPackageId: string,
  input: { endLine?: number; episodeNo?: number; startLine?: number } = {}
) {
  return mutateAssetLockRecord({
    action: "bind_source",
    assetLockRecordId,
    deliveryPackageId,
    episodeNo: input.episodeNo ?? 1,
    startLine: input.startLine ?? 1,
    endLine: input.endLine ?? input.startLine ?? 1
  });
}

function createMockDbAssetLockRecordRepository(initialSnapshot: AssetLockRecordRepositorySnapshot): DbAssetLockRecordRepository {
  let currentSnapshot = initialSnapshot;

  return {
    mode: "db",
    read: vi.fn(async () => currentSnapshot),
    createAssetLockRecord: vi.fn(async (record: AssetLockRecord) => {
      currentSnapshot = snapshotFromState({
        ...currentSnapshot.state,
        assetLockRecords: [...currentSnapshot.assetLockRecords, record]
      });

      return currentSnapshot;
    }),
    createAssetLockRecords: vi.fn(async (records: AssetLockRecord[]) => {
      currentSnapshot = snapshotFromState({
        ...currentSnapshot.state,
        assetLockRecords: [...currentSnapshot.assetLockRecords, ...records]
      });

      return currentSnapshot;
    }),
    updateAssetLockRecord: vi.fn(async (record: AssetLockRecord) => {
      if (!currentSnapshot.assetLockRecords.some((item) => item.id === record.id)) {
        throw new Error("asset_lock_record_not_found");
      }

      currentSnapshot = snapshotFromState({
        ...currentSnapshot.state,
        assetLockRecords: currentSnapshot.assetLockRecords.map((item) => (item.id === record.id ? record : item))
      });

      return currentSnapshot;
    }),
    createSourceBinding: vi.fn(async (binding: ScriptSourceBinding) => {
      currentSnapshot = snapshotFromState({
        ...currentSnapshot.state,
        scriptSourceBindings: [...currentSnapshot.scriptSourceBindings, binding]
      });

      return currentSnapshot;
    }),
    removeSourceBinding: vi.fn(async (id: string) => {
      if (!currentSnapshot.scriptSourceBindings.some((binding) => binding.id === id)) {
        throw new Error("script_source_binding_not_found");
      }

      currentSnapshot = snapshotFromState({
        ...currentSnapshot.state,
        scriptSourceBindings: currentSnapshot.scriptSourceBindings.filter((binding) => binding.id !== id)
      });

      return currentSnapshot;
    })
  };
}

function snapshotFromState(state: WorkspaceState): AssetLockRecordRepositorySnapshot {
  const assetLockRecords = state.assetLockRecords ?? [];
  const scriptSourceBindings = state.scriptSourceBindings ?? [];

  return {
    state: {
      ...state,
      assetLockRecords,
      scriptSourceBindings
    },
    assetLockRecords,
    scriptSourceBindings
  };
}

async function login(userId: string) {
  currentActorUserId = userId;
  await mutateDeliveryImportWorkspace((state) => loginAsUser(state, userId));
}

function listAssetLockRecords(projectId?: string) {
  return listAssetLockRecordsForActor(projectId, { userId: currentActorUserId });
}

function mutateAssetLockRecord(input: Parameters<typeof mutateAssetLockRecordForActor>[0]) {
  return mutateAssetLockRecordForActor(input, { userId: currentActorUserId });
}
