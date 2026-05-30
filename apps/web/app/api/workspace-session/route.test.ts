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
import { WORKSPACE_SESSION_COOKIE_NAME } from "./session-cookie";

describe("workspace session route", () => {
  let storeDir = "";

  beforeEach(async () => {
    storeDir = await mkdtemp(join(tmpdir(), "aigc-workspace-session-"));
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
    process.env.AIGC_WORKSPACE_SESSION_SECRET = "workspace-session-route-test-secret";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
    delete process.env.AIGC_WORKSPACE_SESSION_SECRET;
    delete process.env.DATABASE_URL;
    if (storeDir) {
      await rm(storeDir, { force: true, recursive: true });
    }
  });

  it("sets an HttpOnly cookie for the selected current user without mutating the workspace actor pointer", async () => {
    const response = await POST(jsonRequest({ userId: "user-owner" }));
    const setCookie = response.headers.get("set-cookie");

    await expect(response.json()).resolves.toEqual({ ok: true, currentUserId: "user-owner" });
    expect(setCookie).toContain(`${WORKSPACE_SESSION_COOKIE_NAME}=v1.`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
    await expect(readDeliveryImportWorkspace()).resolves.toMatchObject({
      state: {
        currentUserId: expect.not.stringMatching(/^user-owner$/)
      }
    });
  });

  it("rejects cross-origin session selection requests", async () => {
    const response = await POST(
      jsonRequest(
        { userId: "user-owner" },
        {
          origin: "http://evil.local"
        }
      )
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "request_origin_forbidden" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects cross-site session selection requests without relying on Origin", async () => {
    const response = await POST(
      jsonRequest(
        { userId: "user-owner" },
        {
          "sec-fetch-site": "cross-site"
        }
      )
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "request_origin_forbidden" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("fails closed when the session secret is missing", async () => {
    delete process.env.AIGC_WORKSPACE_SESSION_SECRET;

    const response = await POST(jsonRequest({ userId: "user-owner" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "workspace_session_secret_required" });
    expect(response.headers.get("set-cookie")).toBeNull();
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
    const setCookie = response.headers.get("set-cookie");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, currentUserId: dbOnlyUser.id });
    expect(setCookie).toContain(`${WORKSPACE_SESSION_COOKIE_NAME}=v1.`);
    await expect(readDeliveryImportWorkspace()).resolves.toMatchObject({
      state: {
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
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("clears the session cookie on logout", async () => {
    await POST(jsonRequest({ userId: "user-owner" }));
    const response = await POST(jsonRequest({ userId: null }));
    const setCookie = response.headers.get("set-cookie");

    await expect(response.json()).resolves.toEqual({ ok: true, currentUserId: null });
    expect(setCookie).toContain(`${WORKSPACE_SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("Max-Age=0");
  });

  it("rejects unknown users without setting a new cookie", async () => {
    await POST(jsonRequest({ userId: "user-owner" }));
    const response = await POST(jsonRequest({ userId: "missing-user" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "user_not_found" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

function jsonRequest(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request("http://localhost/api/workspace-session", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders
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
