import { NextResponse } from "next/server";
import { requireWorkspaceRequestActor } from "../workspace-actor";
import { mutateDeliveryPackage } from "./service";
import type { DeliveryPackageMutationRequest } from "./service";

type DeliveryPackageRouteMutationRequest =
  | Extract<DeliveryPackageMutationRequest, { action: "update_confirmation" }>
  | Omit<Extract<DeliveryPackageMutationRequest, { action: "submit" }>, "actorUserId">
  | Omit<Extract<DeliveryPackageMutationRequest, { action: "publish" }>, "actorUserId">
  | Omit<Extract<DeliveryPackageMutationRequest, { action: "reject" }>, "actorUserId">;

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_delivery_package_request" }, { status: 400 });
  }

  const input = parseMutationRequest(body);

  if (!input) {
    return NextResponse.json({ error: "invalid_delivery_package_request" }, { status: 400 });
  }

  try {
    const actor = await requireWorkspaceRequestActor(request, "unauthenticated");
    return NextResponse.json(await mutateDeliveryPackage(withServerActor(input, actor.userId)));
  } catch (error) {
    if (error instanceof Error && error.message === "unauthenticated") {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    return NextResponse.json(
      {
        error: "delivery_package_mutation_failed",
        message: error instanceof Error ? error.message : "delivery package mutation failed"
      },
      { status: 400 }
    );
  }
}

function parseMutationRequest(body: unknown): DeliveryPackageRouteMutationRequest | null {
  if (!isRecord(body)) {
    return null;
  }

  const deliveryPackageId = readString(body.deliveryPackageId);

  if (!deliveryPackageId) {
    return null;
  }

  switch (body.action) {
    case "update_confirmation": {
      if (!Array.isArray(body.confirmedEpisodeNos) || !body.confirmedEpisodeNos.every(isEpisodeNo)) {
        return null;
      }

      return {
        action: body.action,
        deliveryPackageId,
        confirmedEpisodeNos: body.confirmedEpisodeNos
      };
    }
    case "submit":
    case "publish": {
      return {
        action: body.action,
        deliveryPackageId
      };
    }
    case "reject": {
      const rejectionReason = readString(body.rejectionReason);

      if (!rejectionReason) {
        return null;
      }

      return {
        action: body.action,
        deliveryPackageId,
        rejectionReason
      };
    }
    default:
      return null;
  }
}

function withServerActor(input: DeliveryPackageRouteMutationRequest, actorUserId: string): DeliveryPackageMutationRequest {
  switch (input.action) {
    case "update_confirmation":
      return input;
    case "submit":
    case "publish":
      return { ...input, actorUserId };
    case "reject":
      return { ...input, actorUserId };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isEpisodeNo(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
