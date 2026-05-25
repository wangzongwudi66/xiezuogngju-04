import type { ScriptSourceBinding } from "@aigc/domain";

export type AssetSourceBindingCacheScope = {
  projectId: string;
  userId: string;
} | null;

export function clearProjectAssetSourceBindings(bindings: ScriptSourceBinding[], projectId: string) {
  return bindings.filter((binding) => binding.projectId !== projectId);
}

export function selectAssetLockWorkbenchSourceBindings(input: {
  assetSourceBindings: ScriptSourceBinding[];
  cacheScope: AssetSourceBindingCacheScope;
  currentUserId: string | null | undefined;
  projectId: string;
  scriptSourceBindings?: ScriptSourceBinding[];
  syncedServerUserId: string | null;
}) {
  if (
    !input.currentUserId ||
    input.syncedServerUserId !== input.currentUserId ||
    input.cacheScope?.projectId !== input.projectId ||
    input.cacheScope.userId !== input.currentUserId
  ) {
    return [];
  }

  return input.assetSourceBindings.filter((binding) => binding.projectId === input.projectId);
}
