import type { WorkspaceState } from "@aigc/domain";
import { readDeliveryImportWorkspace } from "./delivery-import-jobs/persistence";

export interface WorkspaceRequestActor {
  userId: string;
}

export async function resolveWorkspaceRequestActor() {
  const snapshot = await readDeliveryImportWorkspace();
  return resolveWorkspaceRequestActorFromState(snapshot.state);
}

export async function requireWorkspaceRequestActor(errorMessage: string) {
  const actor = await resolveWorkspaceRequestActor();

  if (!actor) {
    throw new Error(errorMessage);
  }

  return actor;
}

export function resolveWorkspaceRequestActorFromState(state: WorkspaceState): WorkspaceRequestActor | null {
  const userId = state.currentUserId?.trim();

  if (!userId) {
    return null;
  }

  if (!state.users.some((user) => user.id === userId)) {
    return null;
  }

  return { userId };
}
