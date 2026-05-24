export type WorkspaceSessionSyncResult =
  | {
      currentUserId: string | null;
      ok: true;
    }
  | {
      error: string;
      ok: false;
    };

export async function syncWorkspaceCurrentUser(userId: string | null): Promise<WorkspaceSessionSyncResult> {
  const response = await fetch("/api/workspace-session", {
    body: JSON.stringify({ userId }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  const payload = (await readJsonSafely(response)) as Record<string, unknown> | null;

  if (!response.ok) {
    return {
      error: typeof payload?.error === "string" ? payload.error : "workspace_session_sync_failed",
      ok: false
    };
  }

  return {
    currentUserId: typeof payload?.currentUserId === "string" ? payload.currentUserId : null,
    ok: true
  };
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
