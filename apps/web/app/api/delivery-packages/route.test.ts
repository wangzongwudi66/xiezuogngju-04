import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loginAsUser, seedWorkspace } from "@aigc/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as assetLockRecordDbParts from "../asset-lock-records/db-parts";
import * as authScopeDbRepository from "../auth-scope/db-repository";
import { createDeliveryImportJob, getDeliveryImportWorkspace } from "../delivery-import-jobs/service";
import { mutateDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import * as publishReadModelDbRepository from "../publish-read-model/db-repository";
import { createWorkspaceSessionCookieValue, WORKSPACE_SESSION_COOKIE_NAME } from "../workspace-session/session-cookie";
import { POST } from "./route";
import * as deliveryPackageDbRepository from "./db-repository";

let sessionCookie = "";

describe("delivery package route", () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `aigc-delivery-packages-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storeDir, { recursive: true });
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
    process.env.AIGC_WORKSPACE_SESSION_SECRET = "delivery-package-route-test-secret";
    vi.spyOn(authScopeDbRepository, "readDbAuthScopeSnapshot").mockResolvedValue({
      users: seedWorkspace.users,
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
    vi.spyOn(publishReadModelDbRepository, "readDbPublishReadModelSnapshot").mockResolvedValue({
      episodeRevisions: [],
      episodeCurrents: [],
      notifications: []
    });
    await setCurrentUser("user-head-writer");
  });

  afterEach(async () => {
    sessionCookie = "";
    vi.restoreAllMocks();
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    delete process.env.AIGC_WORKSPACE_SESSION_SECRET;
    delete process.env.ASSET_LOCK_RECORDS_REPOSITORY;
    delete process.env.DATABASE_URL;
    await rm(storeDir, { recursive: true, force: true });
  });

  it("ignores client actorUserId when submitting a package", async () => {
    const deliveryPackageId = await createDraft();

    const response = await POST(
      jsonRequest({
        action: "submit",
        deliveryPackageId,
        actorUserId: "user-attacker"
      })
    );
    const snapshot = await response.json();

    expect(response.status).toBe(200);
    expect(snapshot.state.deliveryPackages).toContainEqual(
      expect.objectContaining({
        id: deliveryPackageId,
        status: "pending_review",
        submittedByUserId: "user-head-writer"
      })
    );
  });

  it("ignores client actorUserId when publishing a package", async () => {
    const deliveryPackageId = await createDraft();
    await POST(jsonRequest({ action: "submit", deliveryPackageId, actorUserId: "user-attacker" }));
    await setCurrentUser("user-owner");

    const response = await POST(
      jsonRequest({
        action: "publish",
        deliveryPackageId,
        actorUserId: "user-attacker"
      })
    );
    const snapshot = await response.json();

    expect(response.status).toBe(200);
    expect(snapshot.state.deliveryPackages).toContainEqual(
      expect.objectContaining({
        id: deliveryPackageId,
        status: "published",
        reviewedByUserId: "user-owner"
      })
    );
  });

  it("ignores client actorUserId when rejecting a package", async () => {
    const deliveryPackageId = await createDraft();
    await POST(jsonRequest({ action: "submit", deliveryPackageId, actorUserId: "user-attacker" }));
    await setCurrentUser("user-owner");

    const response = await POST(
      jsonRequest({
        action: "reject",
        deliveryPackageId,
        actorUserId: "user-attacker",
        rejectionReason: "range unclear"
      })
    );
    const snapshot = await response.json();

    expect(response.status).toBe(200);
    expect(snapshot.state.deliveryPackages).toContainEqual(
      expect.objectContaining({
        id: deliveryPackageId,
        status: "rejected",
        reviewedByUserId: "user-owner",
        rejectionReason: "range unclear"
      })
    );
  });

  it("returns unauthenticated when package mutations have no server workspace actor", async () => {
    const deliveryPackageId = await createDraft();
    sessionCookie = "";

    const response = await POST(jsonRequest({ action: "submit", deliveryPackageId, actorUserId: "user-head-writer" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthenticated" });
  });

  it("uses DB overlay users for package actor validation instead of stale local users", async () => {
    const deliveryPackageId = await createDraft();
    const workspace = await getDeliveryImportWorkspace();
    let dbSnapshot: deliveryPackageDbRepository.DeliveryPackageDbSnapshot = {
      deliveryPackages: workspace.state.deliveryPackages.filter((item) => item.id === deliveryPackageId),
      deliveryPackageEpisodes: workspace.state.deliveryPackageEpisodes.filter(
        (item) => item.deliveryPackageId === deliveryPackageId
      )
    };
    await mutateDeliveryImportWorkspace((state) => ({
      ...state,
      currentUserId: "user-head-writer",
      users: [],
      projects: [],
      members: [],
      memberPermissions: [],
      episodes: [],
      assignments: [],
      deliveryPackages: [],
      deliveryPackageEpisodes: []
    }));
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    process.env.DATABASE_URL = "postgres://example.invalid/aigc";
    vi.spyOn(deliveryPackageDbRepository, "readDbDeliveryPackageSnapshot").mockImplementation(async () => dbSnapshot);
    vi.spyOn(deliveryPackageDbRepository, "updateDbDeliveryPackage").mockImplementation(async (deliveryPackage) => {
      dbSnapshot = {
        ...dbSnapshot,
        deliveryPackages: dbSnapshot.deliveryPackages.map((item) =>
          item.id === deliveryPackage.id ? deliveryPackage : item
        )
      };
      return deliveryPackage;
    });

    const response = await POST(jsonRequest({ action: "submit", deliveryPackageId, actorUserId: "user-attacker" }));
    const snapshot = await response.json();

    expect(response.status).toBe(200);
    expect(snapshot.state.deliveryPackages).toContainEqual(
      expect.objectContaining({
        id: deliveryPackageId,
        status: "pending_review",
        submittedByUserId: "user-head-writer"
      })
    );
  });

  it("rejects package mutations when currentUserId is missing from DB overlay users", async () => {
    const deliveryPackageId = await createDraft();
    await mutateDeliveryImportWorkspace((state) => ({ ...state, currentUserId: "user-head-writer" }));
    process.env.ASSET_LOCK_RECORDS_REPOSITORY = "db";
    process.env.DATABASE_URL = "postgres://example.invalid/aigc";
    vi.mocked(authScopeDbRepository.readDbAuthScopeSnapshot).mockResolvedValue({
      users: [],
      projects: seedWorkspace.projects,
      members: seedWorkspace.members,
      memberPermissions: seedWorkspace.memberPermissions,
      episodes: seedWorkspace.episodes,
      assignments: seedWorkspace.assignments
    });
    vi.spyOn(deliveryPackageDbRepository, "readDbDeliveryPackageSnapshot").mockResolvedValue({
      deliveryPackages: [],
      deliveryPackageEpisodes: []
    });

    const response = await POST(jsonRequest({ action: "submit", deliveryPackageId, actorUserId: "user-head-writer" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthenticated" });
  });
});

async function createDraft() {
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

  return result.job.deliveryPackageId;
}

async function setCurrentUser(userId: string) {
  await mutateDeliveryImportWorkspace((state) => loginAsUser(state, userId));
  sessionCookie = `${WORKSPACE_SESSION_COOKIE_NAME}=${createWorkspaceSessionCookieValue(userId)}`;
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/delivery-packages", {
    body: JSON.stringify(body),
    headers: {
      cookie: sessionCookie,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}
