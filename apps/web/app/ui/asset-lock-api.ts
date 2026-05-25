import type { AssetLockRecordMutationRequest, AssetLockRecordSummary } from "../api/asset-lock-records/service";
import type { AssetLockRecord, ScriptSourceBinding } from "@aigc/domain";

export type AssetLockRecordListResponse = {
  records: AssetLockRecord[];
  sourceBindings: ScriptSourceBinding[];
  summary: AssetLockRecordSummary;
};

export type AssetLockRecordMutationInput = AssetLockRecordMutationRequest;
export type AssetLockRecordMutationResponse = AssetLockRecordListResponse & {
  record: AssetLockRecord;
  sourceBinding?: ScriptSourceBinding;
  removedSourceBindingId?: string;
};

export type AssetLockCreateDraft = Omit<Extract<AssetLockRecordMutationRequest, { action: "create" }>, "action" | "projectId" | "createdByUserId">;
export type AssetLockPrepareDemoInput = Omit<Extract<AssetLockRecordMutationRequest, { action: "prepare_demo" }>, "action" | "actorUserId">;
export type AssetSourceBindInput = Omit<Extract<AssetLockRecordMutationRequest, { action: "bind_source" }>, "action">;
export type AssetSourceRemoveInput = Omit<Extract<AssetLockRecordMutationRequest, { action: "remove_source_binding" }>, "action">;

export type { AssetLockRecordSummary };

export async function fetchAssetLockRecords(projectId: string): Promise<AssetLockRecordListResponse> {
  const response = await fetch(`/api/asset-lock-records?projectId=${encodeURIComponent(projectId)}`);

  if (!response.ok) {
    throw new Error(await readAssetLockApiError(response, "asset_lock_records_request_failed"));
  }

  return withDefaultSourceBindings((await response.json()) as AssetLockRecordListResponse);
}

export async function mutateAssetLockRecord(input: AssetLockRecordMutationInput): Promise<AssetLockRecordMutationResponse> {
  const response = await fetch("/api/asset-lock-records", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await readAssetLockApiError(response, "asset_lock_record_mutation_request_failed"));
  }

  const payload = (await response.json()) as AssetLockRecordMutationResponse;

  return {
    ...withDefaultSourceBindings(payload),
    record: payload.record,
    sourceBinding: payload.sourceBinding,
    removedSourceBindingId: payload.removedSourceBindingId
  };
}

export async function prepareAssetLockDemo(input: AssetLockPrepareDemoInput): Promise<AssetLockRecordListResponse> {
  return mutateAssetLockRecord({
    action: "prepare_demo",
    ...input
  });
}

export async function bindAssetSource(input: AssetSourceBindInput): Promise<AssetLockRecordMutationResponse> {
  return mutateAssetLockRecord({
    action: "bind_source",
    ...input
  });
}

export async function removeAssetSourceBinding(input: AssetSourceRemoveInput): Promise<AssetLockRecordMutationResponse> {
  return mutateAssetLockRecord({
    action: "remove_source_binding",
    ...input
  });
}

export function formatAssetLockError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (message.includes("asset_lock_records_request_failed")) {
    return "资产定版记录加载失败，请稍后重试。";
  }

  if (message.includes("invalid_asset_lock_record_request")) {
    return "资产定版操作信息不完整，请刷新页面后重试。";
  }

  if (message.includes("asset_lock_record_mutation_request_failed") || message.includes("asset_lock_record_mutation_failed")) {
    return "资产定版操作失败，请检查当前记录状态后重试。";
  }

  if (message.includes("asset_lock_record_not_found")) {
    return "没有找到这条资产定版记录，请刷新后重试。";
  }

  if (message.includes("asset_lock_action_forbidden") || message.includes("asset_lock_episode_scope_forbidden")) {
    return "当前角色没有权限修改这条剧本来源绑定。";
  }

  if (message.includes("Script source binding already exists")) {
    return "这段剧本来源已经绑定过了。";
  }

  if (
    message.includes("Line range") ||
    message.includes("Source excerpt cannot be empty") ||
    message.includes("Delivery package episode")
  ) {
    return "剧本来源行号无效，请确认集数和起止行号。";
  }

  if (message.includes("资产已定版")) {
    return "这条资产已定版，不能继续修改。";
  }

  if (message.includes("交稿包状态必须是 published") || message.includes("只能基于已发布交稿包创建资产定版记录")) {
    return "只能基于已发布交稿包生成资产核对记录。请先完成交稿发布。";
  }

  if (
    message.includes("存在未完成确认") ||
    message.includes("存在争议") ||
    message.includes("存在需补资料") ||
    message.includes("编剧和制作确认完成后才能定版") ||
    message.includes("资产仍需补充信息") ||
    message.includes("资产仍有争议")
  ) {
    return "仍有未完成确认、争议或需补资料项，暂不能最终定版。";
  }

  return "";
}

function withDefaultSourceBindings<T extends AssetLockRecordListResponse>(response: T): T {
  return {
    ...response,
    sourceBindings: response.sourceBindings ?? []
  };
}

async function readAssetLockApiError(response: Response, fallback: string) {
  const payload = await readJsonSafely(response);

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    const message = record.message;

    if (typeof message === "string" && message.trim()) {
      return message;
    }

    if (typeof error === "string" && error.trim()) {
      return error;
    }
  }

  return fallback;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
