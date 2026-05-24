import type { DeliveryPackageStatus, ProjectRole } from "@aigc/domain";

export function canReviewDeliveryRole(primaryRole: ProjectRole) {
  return primaryRole === "owner" || primaryRole === "coordinator";
}

export function canCreateDeliveryRole(primaryRole: ProjectRole) {
  return primaryRole === "head_writer" || canReviewDeliveryRole(primaryRole);
}

export function canSubmitDeliveryRole(primaryRole: ProjectRole) {
  return primaryRole === "head_writer";
}

export function canAccessDeliveryRole(primaryRole: ProjectRole) {
  return primaryRole === "writer" || primaryRole === "head_writer" || canReviewDeliveryRole(primaryRole);
}

export function canAccessAssetWorkflowRole(primaryRole: ProjectRole) {
  return primaryRole === "creator" || canAccessDeliveryRole(primaryRole);
}

export function filterProjectItems<T extends { projectId: string }>(items: T[], projectId: string) {
  return items.filter((item) => item.projectId === projectId);
}

export function selectDefaultDeliveryPackageId(
  deliveryPackages: Array<{ id: string; status: DeliveryPackageStatus }>,
  primaryRole: ProjectRole,
  selectedDeliveryPackageId: string | null
) {
  if (selectedDeliveryPackageId && deliveryPackages.some((deliveryPackage) => deliveryPackage.id === selectedDeliveryPackageId)) {
    return selectedDeliveryPackageId;
  }

  if (canReviewDeliveryRole(primaryRole)) {
    return deliveryPackages.find((deliveryPackage) => deliveryPackage.status === "pending_review")?.id ?? deliveryPackages[0]?.id ?? null;
  }

  return deliveryPackages[0]?.id ?? null;
}

export function selectAssetTimelineDeliveryPackageId(
  deliveryPackages: Array<{ id: string; status: DeliveryPackageStatus; createdAt: string; publishedAt?: string }>
) {
  return (
    [...deliveryPackages]
      .filter((deliveryPackage) => deliveryPackage.status === "published")
      .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt))[0]?.id ?? undefined
  );
}
