import { NextResponse } from "next/server";
import { resolveWorkspaceRequestActor } from "../workspace-actor";
import { getAssetDecisionTimelineProjection } from "./service";
import type { AssetDecisionTimelineProjectionError } from "./service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = readSearchParam(searchParams, "projectId");
  const deliveryPackageId = readSearchParam(searchParams, "deliveryPackageId");
  const previousDeliveryPackageId = readSearchParam(searchParams, "previousDeliveryPackageId");

  if (!projectId || !deliveryPackageId) {
    return NextResponse.json({ ok: false, error: "invalid_asset_decision_timeline_request" }, { status: 400 });
  }

  const actor = await resolveWorkspaceRequestActor(request);
  const result = await getAssetDecisionTimelineProjection({
    projectId,
    deliveryPackageId,
    previousDeliveryPackageId,
    actor
  });

  return NextResponse.json(result, { status: result.ok ? 200 : statusForProjectionError(result.error) });
}

function readSearchParam(searchParams: URLSearchParams, key: string) {
  return searchParams.get(key)?.trim() || undefined;
}

function statusForProjectionError(error: AssetDecisionTimelineProjectionError) {
  switch (error) {
    case "unauthenticated":
      return 401;
    case "project_member_required":
      return 403;
    case "project_not_found":
    case "delivery_package_not_found":
    case "previous_delivery_package_not_found":
      return 404;
    case "delivery_package_not_published":
    case "previous_delivery_package_not_published":
      return 409;
    case "previous_delivery_package_not_before_current":
      return 409;
    case "delivery_package_project_mismatch":
    case "previous_delivery_package_project_mismatch":
      return 400;
  }
}
