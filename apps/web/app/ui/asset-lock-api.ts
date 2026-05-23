import type { AssetLockRecordMutationRequest, AssetLockRecordSummary } from "../api/asset-lock-records/service";
import type { AssetLockRecord } from "@aigc/domain";

export type AssetLockRecordListResponse = {
  records: AssetLockRecord[];
  summary: AssetLockRecordSummary;
};

export type AssetLockRecordMutationInput = AssetLockRecordMutationRequest;

export type AssetLockCreateDraft = Omit<Extract<AssetLockRecordMutationRequest, { action: "create" }>, "action" | "projectId" | "createdByUserId">;

export type { AssetLockRecordSummary };

export async function fetchAssetLockRecords(projectId: string): Promise<AssetLockRecordListResponse> {
  const response = await fetch(`/api/asset-lock-records?projectId=${encodeURIComponent(projectId)}`);

  if (!response.ok) {
    throw new Error(await readAssetLockApiError(response, "asset_lock_records_request_failed"));
  }

  return (await response.json()) as AssetLockRecordListResponse;
}

export async function mutateAssetLockRecord(input: AssetLockRecordMutationInput): Promise<AssetLockRecordListResponse> {
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

  return (await response.json()) as AssetLockRecordListResponse;
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
