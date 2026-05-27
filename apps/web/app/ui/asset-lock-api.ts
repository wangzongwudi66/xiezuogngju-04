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

export type AssetLockErrorContext = {
  action?: AssetLockRecordMutationInput["action"];
};

export function formatAssetLockError(error: unknown, context: AssetLockErrorContext = {}) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const sourceBindingError = formatSourceBindingError(message, context);

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

  if (sourceBindingError) {
    return sourceBindingError;
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

function formatSourceBindingError(message: string, context: AssetLockErrorContext) {
  const isSourceBindingAction = context.action === "bind_source" || context.action === "remove_source_binding";

  if (message.includes("Script source binding already exists")) {
    return "这段剧本来源已经绑定过了，请选择不同的行号或先移除原绑定。";
  }

  if (message.includes("script_source_binding_not_found") || message.includes("Script source binding not found")) {
    return "没有找到这段来源绑定，请刷新后重试。";
  }

  if (message.includes("Locked asset lock records cannot change source bindings")) {
    return "这条资产记录已定版，不能修改剧本来源绑定。";
  }

  if (isSourceBindingAction && message.includes("asset_lock_episode_scope_forbidden")) {
    return "编剧只能修改自己负责集数内的剧本来源绑定，请切换到负责集数或联系统筹、主编剧。";
  }

  if (isSourceBindingAction && message.includes("asset_lock_action_forbidden")) {
    return "当前账号没有修改剧本来源绑定的权限，请联系统筹或主编剧处理。";
  }

  if (isSourceBindingAction && message.includes("asset_lock_project_member_required")) {
    return "当前账号不在这个项目中，不能修改剧本来源绑定。";
  }

  if (isSourceBindingAction && message.includes("asset_lock_unauthenticated")) {
    return "请先登录后再修改剧本来源绑定。";
  }

  if (message.includes("Line range start must be before or equal to end")) {
    return "来源起始行不能大于结束行，请调整后再绑定。";
  }

  if (message.includes("Line range exceeds script content")) {
    return "来源行号超出当前集剧本文本范围，请确认已发布交稿包里的行号。";
  }

  if (message.includes("Line range must start at line 1 or later") || message.includes("Line range must use integer line numbers")) {
    return "来源行号必须是从 1 开始的整数，请重新填写起止行。";
  }

  if (message.includes("Source excerpt cannot be empty")) {
    return "选中的来源段落为空，请选择包含剧本文本的行。";
  }

  if (message.includes("Delivery package episode not found")) {
    return "没有找到这一集的已发布剧本文本，请确认交稿包和集数后重试。";
  }

  if (message.includes("Delivery package episode must be confirmed")) {
    return "这一集未标记为实际变更，不能作为剧本来源绑定。";
  }

  if (message.includes("Source binding episode must intersect the asset lock record")) {
    return "这条资产记录不包含所选集数，请确认资产记录关联集数后再绑定。";
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
