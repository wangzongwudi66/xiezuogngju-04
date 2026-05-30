import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { seedWorkspace } from "@aigc/domain";
import * as assetLockRecordDbParts from "../asset-lock-records/db-parts";
import * as authScopeDbRepository from "../auth-scope/db-repository";
import * as deliveryPackageDbRepository from "../delivery-packages/db-repository";
import * as publishReadModelDbRepository from "../publish-read-model/db-repository";
import { readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { POST } from "./route";

describe("workspace session route", () => {
  let storeDir = "";

  beforeEach(async () => {
    storeDir = await mkdtemp(join(tmpdir(), "aigc-workspace-session-"));
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
    delete process.env.DATABASE_URL;
    if (storeDir) {
      await rm(storeDir, { force: true, recursive: true });
    }
  });

  it("persists the selected current user for server-side projection routes", async () => {
    const response = await POST(jsonRequest({ userId: "user-owner" }));

    await expect(response.json()).resolves.toEqual({ ok: true, currentUserId: "user-owner" });
    await expect(readDeliveryImportWorkspace()).resolves.toMatchObject({
      state: {
        currentUserId: "user-owner"
      }
    });
  });

  it("allows DB-only users to log in through the overlay workspace", async () => {
    const dbOnlyUser = {
      id: "user-db-only",
      name: "DB Only",
      defaultRole: "head_writer" as const,
      avatarTone: "teal"
    };
    mockDbOverlayUsers([dbOnlyUser]);
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    process.env.DATABASE_URL = "postgres://example.invalid/aigc";

    const response = await POST(jsonRequest({ userId: dbOnlyUser.id }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, currentUserId: dbOnlyUser.id });
    await expect(readDeliveryImportWorkspace()).resolves.toMatchObject({
      state: {
        currentUserId: dbOnlyUser.id,
        users: [dbOnlyUser]
      }
    });
  });

  it("rejects missing DB users without changing the current session", async () => {
    const dbOnlyUser = {
      id: "user-db-only",
      name: "DB Only",
      defaultRole: "head_writer" as const,
      avatarTone: "teal"
    };
    mockDbOverlayUsers([dbOnlyUser]);
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    process.env.DATABASE_URL = "postgres://example.invalid/aigc";
    await POST(jsonRequest({ userId: dbOnlyUser.id }));

    const response = await POST(jsonRequest({ userId: "missing-user" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "user_not_found" });
    await expect(readDeliveryImportWorkspace()).resolves.toMatchObject({
      state: {
        currentUserId: dbOnlyUser.id
      }
    });
  });

  it("clears the current user on logout", async () => {
    await POST(jsonRequest({ userId: "user-owner" }));
    const response = await POST(jsonRequest({ userId: null }));

    await expect(response.json()).resolves.toEqual({ ok: true, currentUserId: null });
    await expect(readDeliveryImportWorkspace()).resolves.toMatchObject({
      state: {
        currentUserId: null
      }
    });
  });

  it("rejects unknown users without changing the workspace session", async () => {
    await POST(jsonRequest({ userId: "user-owner" }));
    const response = await POST(jsonRequest({ userId: "missing-user" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "user_not_found" });
    await expect(readDeliveryImportWorkspace()).resolves.toMatchObject({
      state: {
        currentUserId: "user-owner"
      }
    });
  });
});

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/workspace-session", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

function mockDbOverlayUsers(users: typeof seedWorkspace.users) {
  vi.spyOn(authScopeDbRepository, "readDbAuthScopeSnapshot").mockResolvedValue({
    users,
    projects: seedWorkspace.projects,
    members: seedWorkspace.members,
    memberPermissions: seedWorkspace.memberPermissions,
    episodes: seedWorkspace.episodes,
    assignments: seedWorkspace.assignments
  });
  vi.spyOn(assetLockRecordDbParts, "readDbAssetLockRecordParts").mockResolvedValue({
    assetLockRecords: [],
    scriptSourceBindings: []
  });
  vi.spyOn(deliveryPackageDbRepository, "readDbDeliveryPackageSnapshot").mockResolvedValue({
    deliveryPackages: [],
    deliveryPackageEpisodes: []
  });
  vi.spyOn(publishReadModelDbRepository, "readDbPublishReadModelSnapshot").mockResolvedValue({
    episodeRevisions: [],
    episodeCurrents: [],
    notifications: []
  });
}
