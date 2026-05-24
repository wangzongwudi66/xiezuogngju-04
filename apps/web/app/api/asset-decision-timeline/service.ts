import type { ProjectRole, WorkspaceState } from "@aigc/domain";
import { buildAssetTimelineProjection } from "../../asset-decision-timeline/projection";
import type { RoleScopedAssetTimelineViewModel } from "../../ui/asset-decision-timeline-data";
import { readDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";

export type AssetDecisionTimelineProjectionError =
  | "unauthenticated"
  | "project_not_found"
  | "project_member_required"
  | "delivery_package_not_found"
  | "delivery_package_project_mismatch"
  | "delivery_package_not_published"
  | "previous_delivery_package_not_found"
  | "previous_delivery_package_project_mismatch"
  | "previous_delivery_package_not_published";

export interface AssetDecisionTimelineProjectionRequest {
  projectId: string;
  deliveryPackageId: string;
  previousDeliveryPackageId?: string;
}

export type AssetDecisionTimelineProjectionResponse =
  | {
      ok: true;
      projection: RoleScopedAssetTimelineViewModel;
    }
  | {
      ok: false;
      error: AssetDecisionTimelineProjectionError;
    };

export async function getAssetDecisionTimelineProjection(
  input: AssetDecisionTimelineProjectionRequest
): Promise<AssetDecisionTimelineProjectionResponse> {
  const snapshot = await readDeliveryImportWorkspace();

  return buildAssetDecisionTimelineProjectionFromWorkspace(snapshot.state, input);
}

export function buildAssetDecisionTimelineProjectionFromWorkspace(
  state: WorkspaceState,
  input: AssetDecisionTimelineProjectionRequest
): AssetDecisionTimelineProjectionResponse {
  const viewerUserId = state.currentUserId;

  if (!viewerUserId) {
    return { ok: false, error: "unauthenticated" };
  }

  if (!state.projects.some((project) => project.id === input.projectId)) {
    return { ok: false, error: "project_not_found" };
  }

  const viewerRole = selectProjectRole(state, input.projectId, viewerUserId);

  if (!viewerRole) {
    return { ok: false, error: "project_member_required" };
  }

  const deliveryPackage = state.deliveryPackages.find((item) => item.id === input.deliveryPackageId);

  if (!deliveryPackage) {
    return { ok: false, error: "delivery_package_not_found" };
  }

  if (deliveryPackage.projectId !== input.projectId) {
    return { ok: false, error: "delivery_package_project_mismatch" };
  }

  if (deliveryPackage.status !== "published") {
    return { ok: false, error: "delivery_package_not_published" };
  }

  const previousPackage = input.previousDeliveryPackageId
    ? state.deliveryPackages.find((item) => item.id === input.previousDeliveryPackageId)
    : undefined;

  if (input.previousDeliveryPackageId && !previousPackage) {
    return { ok: false, error: "previous_delivery_package_not_found" };
  }

  if (previousPackage?.projectId !== undefined && previousPackage.projectId !== input.projectId) {
    return { ok: false, error: "previous_delivery_package_project_mismatch" };
  }

  if (previousPackage && previousPackage.status !== "published") {
    return { ok: false, error: "previous_delivery_package_not_published" };
  }

  return {
    ok: true,
    projection: buildAssetTimelineProjection({
      projectId: input.projectId,
      deliveryPackageId: input.deliveryPackageId,
      previousDeliveryPackageId: input.previousDeliveryPackageId,
      viewerRole,
      viewerUserId,
      assetLockRecords: state.assetLockRecords ?? [],
      deliveryPackageEpisodes: state.deliveryPackageEpisodes,
      episodes: state.episodes,
      assignments: state.assignments,
      previousAssetLockRecords: state.assetLockRecords ?? []
    })
  };
}

function selectProjectRole(state: WorkspaceState, projectId: string, userId: string): ProjectRole | undefined {
  return state.members.find((member) => member.projectId === projectId && member.userId === userId)?.role;
}
