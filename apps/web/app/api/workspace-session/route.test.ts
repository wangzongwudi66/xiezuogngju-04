import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { POST } from "./route";

describe("workspace session route", () => {
  let storeDir = "";

  beforeEach(async () => {
    storeDir = await mkdtemp(join(tmpdir(), "aigc-workspace-session-"));
    process.env.AIGC_DELIVERY_IMPORT_STORE_PATH = join(storeDir, "store.json");
  });

  afterEach(async () => {
    delete process.env.AIGC_DELIVERY_IMPORT_STORE_PATH;
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
