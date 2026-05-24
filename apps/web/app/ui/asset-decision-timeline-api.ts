import type { AssetDecisionTimelineProjectionResponse } from "../api/asset-decision-timeline/service";

export interface FetchAssetDecisionTimelineProjectionInput {
  projectId: string;
  deliveryPackageId: string;
  previousDeliveryPackageId?: string;
}

export type AssetDecisionTimelineApiResponse =
  | AssetDecisionTimelineProjectionResponse
  | {
      ok: false;
      error: "asset_decision_timeline_request_failed";
    };

export async function fetchAssetDecisionTimelineProjection(
  input: FetchAssetDecisionTimelineProjectionInput
): Promise<AssetDecisionTimelineApiResponse> {
  const params = new URLSearchParams({
    projectId: input.projectId,
    deliveryPackageId: input.deliveryPackageId
  });

  if (input.previousDeliveryPackageId) {
    params.set("previousDeliveryPackageId", input.previousDeliveryPackageId);
  }

  const response = await fetch(`/api/asset-decision-timeline?${params.toString()}`);
  const payload = await readJsonSafely(response);

  if (isAssetDecisionTimelineApiResponse(payload)) {
    return payload;
  }

  return {
    ok: false,
    error: "asset_decision_timeline_request_failed"
  };
}

export function formatAssetDecisionTimelineError(error: AssetDecisionTimelineApiResponse | unknown) {
  const code = readErrorCode(error);

  switch (code) {
    case "unauthenticated":
      return "请先登录后再查看真实资产决策轨道。";
    case "project_member_required":
      return "当前账号没有查看该项目资产决策轨道的权限。";
    case "delivery_package_not_found":
    case "project_not_found":
      return "没有找到对应项目或交稿包，已显示 Demo 数据。";
    case "delivery_package_not_published":
      return "当前交稿包尚未发布，已显示 Demo 数据。";
    case "previous_delivery_package_not_before_current":
    case "previous_delivery_package_not_found":
    case "previous_delivery_package_project_mismatch":
    case "previous_delivery_package_not_published":
      return "上一版交稿包不可用于对比，已显示当前版投影或 Demo 数据。";
    case "delivery_package_project_mismatch":
    case "asset_decision_timeline_request_failed":
      return "真实资产决策轨道加载失败，已显示 Demo 数据。";
    default:
      return "";
  }
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isAssetDecisionTimelineApiResponse(value: unknown): value is AssetDecisionTimelineApiResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (record.ok === true) {
    return Boolean(record.projection && typeof record.projection === "object");
  }

  return record.ok === false && typeof record.error === "string";
}

function readErrorCode(error: AssetDecisionTimelineApiResponse | unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return "";
  }

  const record = error as Record<string, unknown>;
  return record.ok === false && typeof record.error === "string" ? record.error : "";
}
