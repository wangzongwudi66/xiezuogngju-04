import { afterEach, describe, expect, it, vi } from "vitest";
import { syncWorkspaceCurrentUser } from "./workspace-session-api";

describe("workspace session API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("syncs the selected local user to the server workspace session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, currentUserId: "user-coordinator" }), {
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncWorkspaceCurrentUser("user-coordinator")).resolves.toEqual({
      currentUserId: "user-coordinator",
      ok: true
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/workspace-session", {
      body: JSON.stringify({ userId: "user-coordinator" }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });

  });

  it("returns route errors without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: "user_not_found" }), {
          status: 404
        })
      )
    );

    await expect(syncWorkspaceCurrentUser("missing-user")).resolves.toEqual({
      error: "user_not_found",
      ok: false
    });
  });
});
