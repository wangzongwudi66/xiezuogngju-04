import type { WorkspaceState } from "@aigc/domain";
import { readDeliveryImportWorkspace } from "./delivery-import-jobs/persistence";
import { readWorkspaceSessionCookieUserId, WorkspaceSessionSecretMissingError } from "./workspace-session/session-cookie";

export interface WorkspaceRequestActor {
  userId: string;
}

export async function resolveWorkspaceRequestActor(request: Request) {
  const userId = resolveCookieUserId(request);

  if (!userId) {
    return null;
  }

  const snapshot = await readDeliveryImportWorkspace();
  return resolveKnownWorkspaceActorFromState(snapshot.state, { userId });
}

export async function requireWorkspaceRequestActor(request: Request, errorMessage: string) {
  const actor = await resolveWorkspaceRequestActor(request);

  if (!actor) {
    throw new Error(errorMessage);
  }

  return actor;
}

export function assertKnownActor(state: WorkspaceState, actor: WorkspaceRequestActor, errorMessage = "unauthenticated") {
  if (!resolveKnownWorkspaceActorFromState(state, actor)) {
    throw new Error(errorMessage);
  }

  return actor;
}

export function resolveKnownWorkspaceActorFromState(
  state: WorkspaceState,
  actor: WorkspaceRequestActor | null
): WorkspaceRequestActor | null {
  const userId = actor?.userId.trim();

  if (!userId) {
    return null;
  }

  if (!state.users.some((user) => user.id === userId)) {
    return null;
  }

  return { userId };
}

function resolveCookieUserId(request: Request) {
  try {
    return readWorkspaceSessionCookieUserId(request.headers.get("cookie"));
  } catch (error) {
    if (error instanceof WorkspaceSessionSecretMissingError) {
      return null;
    }

    throw error;
  }
}
