import {
  publishDeliveryPackage,
  rejectDeliveryPackage,
  submitDeliveryPackageForReview,
  updateDeliveryPackageConfirmation
} from "@aigc/domain";
import type { DeliveryPackage, DeliveryPackageEpisode, WorkspaceState } from "@aigc/domain";
import { isAssetLockRecordDbRepositoryEnabled } from "../asset-lock-records/db-mode";
import { getDeliveryImportWorkspace } from "../delivery-import-jobs/service";
import { mutateDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import { updateDbDeliveryPackage, updateDbDeliveryPackageEpisodeConfirmations } from "./db-repository";

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
  if (isAssetLockRecordDbRepositoryEnabled()) {
    return mutateDeliveryPackageInDb(input);
  }

  return mutateDeliveryImportWorkspace((state) => applyDeliveryPackageMutation(state, input));
}

async function mutateDeliveryPackageInDb(input: DeliveryPackageMutationRequest) {
  if (input.action === "publish") {
    throw new Error("delivery_package_db_mutation_not_supported:publish");
  }

  const previousSnapshot = await getDeliveryImportWorkspace();
  const nextState = applyDeliveryPackageMutation(previousSnapshot.state, input);

  if (input.action === "update_confirmation") {
    await updateDbDeliveryPackageEpisodeConfirmations(
      input.deliveryPackageId,
      findMutatedDeliveryPackageEpisodes(nextState, input.deliveryPackageId)
    );
  } else {
    await updateDbDeliveryPackage(findMutatedDeliveryPackage(nextState, input.deliveryPackageId));
  }

  return getDeliveryImportWorkspace();
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

function findMutatedDeliveryPackage(state: WorkspaceState, deliveryPackageId: string): DeliveryPackage {
  const deliveryPackage = state.deliveryPackages.find((item) => item.id === deliveryPackageId);

  if (!deliveryPackage) {
    throw new Error("delivery_package_not_found");
  }

  return deliveryPackage;
}

function findMutatedDeliveryPackageEpisodes(state: WorkspaceState, deliveryPackageId: string): DeliveryPackageEpisode[] {
  return state.deliveryPackageEpisodes.filter((item) => item.deliveryPackageId === deliveryPackageId);
}
