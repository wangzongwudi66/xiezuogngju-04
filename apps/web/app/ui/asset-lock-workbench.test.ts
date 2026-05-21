import { describe, expect, it } from "vitest";
import {
  filterAssetChanges,
  getMockAssetChanges,
  getNextAssetLockOwner,
  summarizeAssetLock
} from "./asset-lock-workbench-data";

describe("asset lock workbench data helpers", () => {
  it("filters asset changes by episode, type, status, owner and risk", () => {
    const items = getMockAssetChanges();
    const filtered = filterAssetChanges(items, {
      episode: "5",
      owner: "沈制作 A",
      risk: "high",
      status: "disputed",
      type: "effect"
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.assetName).toBe("井底粉尘爆闪");
  });

  it("blocks final lock when any side still has pending, disputed, or missing-info items", () => {
    const summary = summarizeAssetLock(getMockAssetChanges());

    expect(summary.canLock).toBe(false);
    expect(summary.writerPendingCount).toBeGreaterThan(0);
    expect(summary.productionPendingCount).toBeGreaterThan(0);
    expect(summary.disputeCount).toBe(1);
    expect(summary.needsInfoCount).toBe(1);
  });

  it("allows final lock only after writer and production are confirmed and blockers are gone", () => {
    const readyItems = getMockAssetChanges().map((item) => ({
      ...item,
      productionConfirmation: "confirmed" as const,
      reviewStatus: "ready_to_lock" as const,
      risk: "normal" as const,
      writerConfirmation: "confirmed" as const
    }));
    const summary = summarizeAssetLock(readyItems);

    expect(summary.canLock).toBe(true);
    expect(getNextAssetLockOwner(readyItems)).toBe("统筹定版");
  });

  it("routes the next owner to coordination before ordinary pending confirmations when there is a dispute", () => {
    expect(getNextAssetLockOwner(getMockAssetChanges())).toBe("统筹协调争议项");
  });
});
