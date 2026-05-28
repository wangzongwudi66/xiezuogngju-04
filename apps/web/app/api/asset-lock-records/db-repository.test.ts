import type { AssetLockRecord } from "@aigc/domain";
import { describe, expect, it } from "vitest";
import {
  mapAssetLockRecordRows,
  mapAssetLockRecordToDbRows,
  mapScriptSourceBindingRows,
  type AssetLockRecordDbEpisodeRow,
  type AssetLockRecordDbRecordRow,
  type ScriptSourceBindingDbRow
} from "./db-repository";

describe("asset lock record DB repository mappers", () => {
  it("maps DB record and episode rows into domain records", () => {
    const recordRows: AssetLockRecordDbRecordRow[] = [
      {
        id: "asset-lock-1",
        projectId: "project-jincheng",
        deliveryPackageId: "delivery-1",
        assetName: "Mine Lift",
        assetNameKey: "mine lift",
        assetType: "scene",
        changeType: "new",
        writerConfirmation: "pending",
        writerConfirmedByUserId: null,
        writerConfirmedAt: null,
        writerNote: "writer note",
        productionConfirmation: "pending",
        productionConfirmedByUserId: null,
        productionConfirmedAt: null,
        productionNote: null,
        risk: "attention",
        status: "draft",
        missingInfo: null,
        disputeReason: null,
        finalLockedByUserId: null,
        finalLockedAt: null,
        createdByUserId: "user-head-writer",
        createdAt: "2026-05-29T00:00:00.000Z",
        updatedAt: "2026-05-29T00:00:00.000Z"
      }
    ];
    const episodeRows: AssetLockRecordDbEpisodeRow[] = [
      {
        assetLockRecordId: "asset-lock-1",
        episodeNo: 2,
        createdAt: "2026-05-29T00:00:00.000Z"
      },
      {
        assetLockRecordId: "asset-lock-1",
        episodeNo: 1,
        createdAt: "2026-05-29T00:00:00.000Z"
      }
    ];

    const records = mapAssetLockRecordRows(recordRows, episodeRows);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "asset-lock-1",
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-1",
      episodeNos: [1, 2],
      assetName: "Mine Lift",
      assetType: "scene",
      changeType: "new",
      writerConfirmation: "pending",
      writerNote: "writer note",
      productionConfirmation: "pending",
      risk: "attention",
      status: "draft",
      createdByUserId: "user-head-writer"
    });
    expect(records[0]?.productionNote).toBeUndefined();
  });

  it("maps a domain record into explicit DB insert rows", () => {
    const record: AssetLockRecord = {
      id: "asset-lock-1",
      projectId: "project-jincheng",
      deliveryPackageId: "delivery-1",
      episodeNos: [1, 2],
      assetName: "  Mine   Lift  ",
      assetType: "scene",
      changeType: "new",
      writerConfirmation: "pending",
      writerNote: "writer note",
      productionConfirmation: "pending",
      risk: "attention",
      status: "draft",
      createdByUserId: "user-head-writer",
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z"
    };

    const rows = mapAssetLockRecordToDbRows(record);

    expect(rows.record).toMatchObject({
      id: "asset-lock-1",
      assetName: "  Mine   Lift  ",
      assetNameKey: "mine lift",
      writerNote: "writer note",
      productionNote: null
    });
    expect(rows.episodes).toEqual([
      {
        assetLockRecordId: "asset-lock-1",
        episodeNo: 1,
        createdAt: "2026-05-29T00:00:00.000Z"
      },
      {
        assetLockRecordId: "asset-lock-1",
        episodeNo: 2,
        createdAt: "2026-05-29T00:00:00.000Z"
      }
    ]);
  });

  it("maps DB script source binding rows into domain bindings", () => {
    const bindingRows: ScriptSourceBindingDbRow[] = [
      {
        id: "source-binding-1",
        projectId: "project-jincheng",
        deliveryPackageId: "delivery-1",
        assetLockRecordId: "asset-lock-1",
        episodeNo: 2,
        startLine: 4,
        endLine: 6,
        excerptSnapshot: "Mine lift source excerpt",
        createdByUserId: "user-head-writer",
        createdAt: "2026-05-29T00:00:00.000Z"
      }
    ];

    const bindings = mapScriptSourceBindingRows(bindingRows);

    expect(bindings).toEqual([
      {
        id: "source-binding-1",
        projectId: "project-jincheng",
        deliveryPackageId: "delivery-1",
        assetLockRecordId: "asset-lock-1",
        episodeNo: 2,
        startLine: 4,
        endLine: 6,
        excerptSnapshot: "Mine lift source excerpt",
        createdByUserId: "user-head-writer",
        createdAt: "2026-05-29T00:00:00.000Z"
      }
    ]);
  });
});
