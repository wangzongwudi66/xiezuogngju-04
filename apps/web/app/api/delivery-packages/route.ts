import { NextResponse } from "next/server";
import { mutateDeliveryPackage } from "./service";
import type { DeliveryPackageMutationRequest } from "./service";

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
    return NextResponse.json(await mutateDeliveryPackage(input));
  } catch (error) {
    return NextResponse.json(
      {
        error: "delivery_package_mutation_failed",
        message: error instanceof Error ? error.message : "delivery package mutation failed"
      },
      { status: 400 }
    );
  }
}

function parseMutationRequest(body: unknown): DeliveryPackageMutationRequest | null {
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
      const actorUserId = readString(body.actorUserId);

      if (!actorUserId) {
        return null;
      }

      return {
        action: body.action,
        deliveryPackageId,
        actorUserId
      };
    }
    case "reject": {
      const actorUserId = readString(body.actorUserId);
      const rejectionReason = readString(body.rejectionReason);

      if (!actorUserId || !rejectionReason) {
        return null;
      }

      return {
        action: body.action,
        deliveryPackageId,
        actorUserId,
        rejectionReason
      };
    }
    default:
      return null;
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
