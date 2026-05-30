import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mutateDeliveryImportWorkspace } from "./delivery-import-jobs/persistence";
import { resolveWorkspaceRequestActor } from "./workspace-actor";
import {
  createWorkspaceSessionCookieValue,
  WORKSPACE_SESSION_COOKIE_MAX_AGE_SECONDS,
  WORKSPACE_SESSION_COOKIE_NAME
} from "./workspace-session/session-cookie";

describe("workspace request actor", () => {
  let storeDir = "";

  beforeEach(async () => {
    storeDir = await mkdtemp(join(tmpdir(), "aigc-workspace-actor-"));
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
    process.env.AIGC_WORKSPACE_SESSION_SECRET = "workspace-actor-test-secret";
  });

  afterEach(async () => {
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
    delete process.env.AIGC_WORKSPACE_SESSION_SECRET;
    if (storeDir) {
      await rm(storeDir, { force: true, recursive: true });
    }
  });

  it("resolves the signed cookie user instead of the shared workspace currentUserId", async () => {
    await mutateDeliveryImportWorkspace((state) => ({ ...state, currentUserId: "user-creator-a" }));

    await expect(resolveWorkspaceRequestActor(requestWithCookie("user-owner"))).resolves.toEqual({ userId: "user-owner" });
  });

  it("returns null for missing, malformed, tampered, expired, or unsigned cookies", async () => {
    const validValue = createWorkspaceSessionCookieValue("user-owner");
    const expiredValue = createWorkspaceSessionCookieValue(
      "user-owner",
      Date.now() - (WORKSPACE_SESSION_COOKIE_MAX_AGE_SECONDS + 1) * 1000
    );

    await expect(resolveWorkspaceRequestActor(new Request("http://localhost"))).resolves.toBeNull();
    await expect(resolveWorkspaceRequestActor(requestWithRawCookie("not-a-session"))).resolves.toBeNull();
    await expect(resolveWorkspaceRequestActor(requestWithRawCookie(`${validValue}tampered`))).resolves.toBeNull();
    await expect(resolveWorkspaceRequestActor(requestWithRawCookie(expiredValue))).resolves.toBeNull();

    delete process.env.AIGC_WORKSPACE_SESSION_SECRET;
    await expect(resolveWorkspaceRequestActor(requestWithRawCookie(validValue))).resolves.toBeNull();
  });

  it("returns null when the cookie user is no longer present in the workspace overlay", async () => {
    await mutateDeliveryImportWorkspace((state) => ({ ...state, users: [] }));

    await expect(resolveWorkspaceRequestActor(requestWithCookie("user-owner"))).resolves.toBeNull();
  });
});

function requestWithCookie(userId: string) {
  return requestWithRawCookie(createWorkspaceSessionCookieValue(userId));
}

function requestWithRawCookie(value: string) {
  return new Request("http://localhost/api/example", {
    headers: {
      cookie: `${WORKSPACE_SESSION_COOKIE_NAME}=${value}`
    }
  });
}
