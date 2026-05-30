import {
  publishDeliveryPackage,
  rejectDeliveryPackage,
  submitDeliveryPackageForReview,
  updateDeliveryPackageConfirmation
} from "@aigc/domain";
import type { DeliveryPackage, DeliveryPackageEpisode, Episode, WorkspaceState } from "@aigc/domain";
import { isAssetLockRecordDbRepositoryEnabled } from "../asset-lock-records/db-mode";
import { getDeliveryImportWorkspace } from "../delivery-import-jobs/service";
import { mutateDeliveryImportWorkspace } from "../delivery-import-jobs/persistence";
import {
  publishDbDeliveryPackage,
  updateDbDeliveryPackage,
  updateDbDeliveryPackageEpisodeConfirmations,
  type PublishDbDeliveryPackageDelta
} from "./db-repository";

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
  const previousSnapshot = await getDeliveryImportWorkspace();
  const nextState = applyDeliveryPackageMutation(previousSnapshot.state, input);

  if (input.action === "update_confirmation") {
    await updateDbDeliveryPackageEpisodeConfirmations(
      input.deliveryPackageId,
      findMutatedDeliveryPackageEpisodes(nextState, input.deliveryPackageId)
    );
  } else if (input.action === "publish") {
    await publishDbDeliveryPackage(computePublishDelta(previousSnapshot.state, nextState, input.deliveryPackageId));
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

function computePublishDelta(
  previousState: WorkspaceState,
  nextState: WorkspaceState,
  deliveryPackageId: string
): PublishDbDeliveryPackageDelta {
  const previousRevisionIds = new Set(previousState.episodeRevisions.map((revision) => revision.id));
  const episodeRevisions = nextState.episodeRevisions.filter(
    (revision) => revision.deliveryPackageId === deliveryPackageId && !previousRevisionIds.has(revision.id)
  );
  const newRevisionIds = new Set(episodeRevisions.map((revision) => revision.id));
  const previousNotificationIds = new Set(previousState.notifications.map((notification) => notification.id));
  const previousEpisodesById = new Map(previousState.episodes.map((episode) => [episode.id, episode]));

  return {
    deliveryPackage: findMutatedDeliveryPackage(nextState, deliveryPackageId),
    episodeRevisions,
    episodeCurrents: nextState.episodeCurrents.filter((current) => newRevisionIds.has(current.currentRevisionId)),
    notifications: nextState.notifications.filter((notification) => !previousNotificationIds.has(notification.id)),
    episodes: nextState.episodes
      .filter((episode) => hasPublishEpisodeChange(previousEpisodesById.get(episode.id), episode))
      .map((episode) => ({
        id: episode.id,
        productionStatus: episode.productionStatus,
        hasUnreadKeyChange: episode.hasUnreadKeyChange
      }))
  };
}

function hasPublishEpisodeChange(previous: Episode | undefined, next: Episode) {
  return (
    Boolean(previous) &&
    (previous?.productionStatus !== next.productionStatus || previous?.hasUnreadKeyChange !== next.hasUnreadKeyChange)
  );
}
