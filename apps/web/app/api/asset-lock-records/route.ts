import { NextResponse } from "next/server";
import { listAssetLockRecords, mutateAssetLockRecord } from "./service";
import type { AssetLockRecordMutationRequest } from "./service";
import type { AssetChangeType, AssetRiskLevel, AssetType } from "@aigc/domain";

const assetTypes: AssetType[] = ["character", "scene", "prop", "vehicle", "effect"];
const changeTypes: AssetChangeType[] = ["new", "modified", "removed", "reused"];
const riskLevels: AssetRiskLevel[] = ["normal", "attention", "high"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    return NextResponse.json(await listAssetLockRecords(searchParams.get("projectId") ?? undefined));
  } catch (error) {
    return assetLockErrorResponse(error, "asset_lock_records_request_failed");
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_asset_lock_record_request" }, { status: 400 });
  }

  const input = parseMutationRequest(body);

  if (!input) {
    return NextResponse.json({ error: "invalid_asset_lock_record_request" }, { status: 400 });
  }

  try {
    return NextResponse.json(await mutateAssetLockRecord(input));
  } catch (error) {
    return assetLockErrorResponse(error, "asset_lock_record_mutation_failed");
  }
}

function parseMutationRequest(body: unknown): AssetLockRecordMutationRequest | null {
  if (!isRecord(body)) {
    return null;
  }

  switch (body.action) {
    case "create": {
      const projectId = readString(body.projectId);
      const deliveryPackageId = readString(body.deliveryPackageId);
      const assetName = readString(body.assetName);
      const assetType = readAssetType(body.assetType);
      const changeType = readChangeType(body.changeType);
      const parsedRisk = body.risk === undefined ? undefined : readRiskLevel(body.risk);

      if (
        !projectId ||
        !deliveryPackageId ||
        !Array.isArray(body.episodeNos) ||
        !body.episodeNos.every(isEpisodeNo) ||
        !assetName ||
        !assetType ||
        !changeType ||
        (body.risk !== undefined && !parsedRisk)
      ) {
        return null;
      }

      const risk = parsedRisk ?? undefined;

      return {
        action: body.action,
        projectId,
        deliveryPackageId,
        episodeNos: body.episodeNos,
        assetName,
        assetType,
        changeType,
        risk,
        writerNote: readOptionalString(body.writerNote),
        productionNote: readOptionalString(body.productionNote)
      };
    }
    case "writer_confirm":
    case "production_confirm": {
      const assetLockRecordId = readString(body.assetLockRecordId);

      if (!assetLockRecordId) {
        return null;
      }

      return {
        action: body.action,
        assetLockRecordId,
        note: readOptionalString(body.note)
      };
    }
    case "needs_info": {
      const assetLockRecordId = readString(body.assetLockRecordId);
      const missingInfo = readString(body.missingInfo);

      if (!assetLockRecordId || !missingInfo) {
        return null;
      }

      return {
        action: body.action,
        assetLockRecordId,
        missingInfo
      };
    }
    case "dispute": {
      const assetLockRecordId = readString(body.assetLockRecordId);
      const disputeReason = readString(body.disputeReason);

      if (!assetLockRecordId || !disputeReason) {
        return null;
      }

      return {
        action: body.action,
        assetLockRecordId,
        disputeReason
      };
    }
    case "final_lock": {
      const assetLockRecordId = readString(body.assetLockRecordId);

      if (!assetLockRecordId) {
        return null;
      }

      return {
        action: body.action,
        assetLockRecordId
      };
    }
    case "prepare_demo": {
      const projectId = readString(body.projectId);

      if (!projectId) {
        return null;
      }

      return {
        action: body.action,
        projectId
      };
    }
    case "generate_from_package": {
      const projectId = readString(body.projectId);
      const deliveryPackageId = readString(body.deliveryPackageId);

      if (!projectId || !deliveryPackageId) {
        return null;
      }

      return {
        action: body.action,
        projectId,
        deliveryPackageId
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

function readOptionalString(value: unknown) {
  const text = readString(value);
  return text || undefined;
}

function isEpisodeNo(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function readAssetType(value: unknown): AssetType | null {
  return typeof value === "string" && assetTypes.includes(value as AssetType) ? (value as AssetType) : null;
}

function readChangeType(value: unknown): AssetChangeType | null {
  return typeof value === "string" && changeTypes.includes(value as AssetChangeType) ? (value as AssetChangeType) : null;
}

function readRiskLevel(value: unknown): AssetRiskLevel | null {
  return typeof value === "string" && riskLevels.includes(value as AssetRiskLevel) ? (value as AssetRiskLevel) : null;
}

function assetLockErrorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status =
    message === "asset_lock_unauthenticated"
      ? 401
      : message === "asset_lock_project_member_required" ||
          message === "asset_lock_action_forbidden" ||
          message === "asset_lock_episode_scope_forbidden"
        ? 403
        : 400;

  return NextResponse.json(
    {
      error: fallback,
      message
    },
    { status }
  );
}
