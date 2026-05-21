import {
  publishDeliveryPackage,
  rejectDeliveryPackage,
  submitDeliveryPackageForReview,
  updateDeliveryPackageConfirmation
} from "@aigc/domain";
import type { WorkspaceState } from "@aigc/domain";
import { mutateDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";

export type DeliveryPackageMutationRequest =
  | {
      action: "update_confirmation";
      deliveryPackageId: string;
      confirmedEpisodeNos: number[];
    }
  | {
      action: "submit";
      deliveryPackageId: string;
      actorUserId: string;
    }
  | {
      action: "publish";
      deliveryPackageId: string;
      actorUserId: string;
    }
  | {
      action: "reject";
      deliveryPackageId: string;
      actorUserId: string;
      rejectionReason: string;
    };

export async function mutateDeliveryPackage(input: DeliveryPackageMutationRequest) {
  return mutateDeliveryImportWorkspace((state) => applyDeliveryPackageMutation(state, input));
}

function applyDeliveryPackageMutation(state: WorkspaceState, input: DeliveryPackageMutationRequest) {
  switch (input.action) {
    case "update_confirmation":
      return updateDeliveryPackageConfirmation(state, {
        deliveryPackageId: input.deliveryPackageId,
        confirmedEpisodeNos: input.confirmedEpisodeNos
      });
    case "submit":
      return submitDeliveryPackageForReview(state, input.deliveryPackageId, input.actorUserId);
    case "publish":
      return publishDeliveryPackage(state, input.deliveryPackageId, input.actorUserId);
    case "reject":
      return rejectDeliveryPackage(state, input.deliveryPackageId, input.actorUserId, input.rejectionReason);
  }
}
