import { selectPrimaryRole } from "@aigc/domain";
import type { WorkspaceState } from "@aigc/domain";
import { buildAssetTimelineProjection } from "../../asset-decision-timeline/projection";
import type { RoleScopedAssetTimelineViewModel } from "../../ui/asset-decision-timeline-data";
import { resolveAssetLockRecordRepository } from "../asset-lock-records/repository";
import type { WorkspaceRequestActor } from "../workspace-actor";

export type AssetDecisionTimelineProjectionError =
  | "unauthenticated"
  | "project_not_found"
  | "project_member_required"
  | "delivery_package_not_found"
  | "delivery_package_project_mismatch"
  | "delivery_package_not_published"
  | "previous_delivery_package_not_found"
  | "previous_delivery_package_project_mismatch"
  | "previous_delivery_package_not_published"
  | "previous_delivery_package_not_before_current";

export interface AssetDecisionTimelineProjectionRequest {
  projectId: string;
  deliveryPackageId: string;
  previousDeliveryPackageId?: string;
  actor: WorkspaceRequestActor | null;
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
  const snapshot = await resolveAssetLockRecordRepository().read();
  const state: WorkspaceState = {
    ...snapshot.state,
    assetLockRecords: snapshot.assetLockRecords,
    scriptSourceBindings: snapshot.scriptSourceBindings
  };

  return buildAssetDecisionTimelineProjectionFromWorkspace(state, input);
}

export function buildAssetDecisionTimelineProjectionFromWorkspace(
  state: WorkspaceState,
  input: AssetDecisionTimelineProjectionRequest
): AssetDecisionTimelineProjectionResponse {
  const viewerUserId = input.actor?.userId;

  if (!viewerUserId || !state.users.some((user) => user.id === viewerUserId)) {
    return { ok: false, error: "unauthenticated" };
  }

  if (!state.projects.some((project) => project.id === input.projectId)) {
    return { ok: false, error: "project_not_found" };
  }

  const isProjectMember = state.members.some((member) => member.projectId === input.projectId && member.userId === viewerUserId);

  if (!isProjectMember) {
    return { ok: false, error: "project_member_required" };
  }

  const viewerRole = selectPrimaryRole(state, viewerUserId, input.projectId);

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

  if (previousPackage && !isPreviousPackageBeforeCurrent(previousPackage.publishedAt, deliveryPackage.publishedAt)) {
    return { ok: false, error: "previous_delivery_package_not_before_current" };
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
      scriptSourceBindings: state.scriptSourceBindings ?? [],
      previousAssetLockRecords: state.assetLockRecords ?? []
    })
  };
}

function isPreviousPackageBeforeCurrent(previousPublishedAt?: string, currentPublishedAt?: string) {
  return Boolean(previousPublishedAt && currentPublishedAt && previousPublishedAt < currentPublishedAt);
}
