import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedWorkspace } from "@aigc/domain";
import {
  mutateDeliveryImportWorkspace,
  readDeliveryImportLocalWorkspaceState,
  readDeliveryImportWorkspace
} from "./persistence";

describe("delivery import workspace persistence", () => {
  let storeDir = "";

  beforeEach(async () => {
    storeDir = await mkdtemp(join(tmpdir(), "aigc-delivery-import-persistence-"));
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
  });

  afterEach(async () => {
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
    delete process.env.DATABASE_URL;
    await rm(storeDir, { force: true, recursive: true });
  });

  it("allows local auth scope array mutations outside DB mode", async () => {
    const snapshot = await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      users: []
    }));

    expect(snapshot.repositoryMode).toEqual({ authScope: "local" });
    expect(snapshot.state.users).toEqual([]);
  });

  it("blocks local auth scope array mutations in DB mode", async () => {
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    process.env.DATABASE_URL = "postgres://example.invalid/aigc";
    const expectedMembers = [...seedWorkspace.members];

    await expect(
      mutateDeliveryImportWorkspace((state) => ({
        ...state,
        members: []
      }))
    ).rejects.toThrow("auth_scope_local_mutation_forbidden_in_db_mode:members");

    const localState = await readDeliveryImportLocalWorkspaceState();
    expect(localState.members).toEqual(expectedMembers);
    expect(seedWorkspace.members).toEqual(expectedMembers);
  });

  it("blocks in-place auth scope array mutations in DB mode", async () => {
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    process.env.DATABASE_URL = "postgres://example.invalid/aigc";
    const expectedUsers = [...seedWorkspace.users];

    await expect(
      mutateDeliveryImportWorkspace((state) => {
        state.users.pop();
        return state;
      })
    ).rejects.toThrow("auth_scope_local_mutation_forbidden_in_db_mode:users");

    const localState = await readDeliveryImportLocalWorkspaceState();
    expect(localState.users).toEqual(expectedUsers);
    expect(seedWorkspace.users).toEqual(expectedUsers);
  });

  it("still allows local-only state mutations in DB mode", async () => {
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    process.env.DATABASE_URL = "postgres://example.invalid/aigc";

    const snapshot = await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      currentUserId: "user-head-writer"
    }));

    expect(snapshot.repositoryMode).toEqual({ authScope: "db" });
    expect(snapshot.state.currentUserId).toBe("user-head-writer");
    await expect(readDeliveryImportLocalWorkspaceState()).resolves.toMatchObject({
      currentUserId: "user-head-writer"
    });
  });

  it("fails closed when DB mode is requested without DATABASE_URL", async () => {
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    delete process.env.DATABASE_URL;

    await expect(
      mutateDeliveryImportWorkspace((state) => ({
        ...state,
        currentUserId: "user-head-writer"
      }))
    ).rejects.toThrow("asset_lock_record_database_url_required");

    await expect(readDeliveryImportWorkspace()).rejects.toThrow("asset_lock_record_database_url_required");
  });
});
