import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bindAssetSource,
  fetchAssetLockRecords,
  formatAssetLockError,
  removeAssetSourceBinding
} from "./asset-lock-api";

describe("asset lock API helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists records and defaults legacy source bindings to an empty list", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        records: [],
        summary: {
          total: 0,
          pendingWriterCount: 0,
          pendingProductionCount: 0,
          disputedCount: 0,
          needsInfoCount: 0,
          readyToLockCount: 0,
          lockedCount: 0
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAssetLockRecords("project 1")).resolves.toMatchObject({
      records: [],
      sourceBindings: []
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/asset-lock-records?projectId=project%201");
  });

  it("posts bind_source selector fields", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        records: [],
        sourceBindings: [],
        summary: {},
        record: { id: "asset-lock-1" },
        sourceBinding: { id: "source-binding-1" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await bindAssetSource({
      assetLockRecordId: "asset-lock-1",
      deliveryPackageId: "delivery-1",
      episodeNo: 12,
      startLine: 4,
      endLine: 6
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/asset-lock-records",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "bind_source",
          assetLockRecordId: "asset-lock-1",
          deliveryPackageId: "delivery-1",
          episodeNo: 12,
          startLine: 4,
          endLine: 6
        })
      })
    );
  });

  it("posts remove_source_binding selector fields", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        records: [],
        sourceBindings: [],
        summary: {},
        record: { id: "asset-lock-1" },
        removedSourceBindingId: "source-binding-1"
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await removeAssetSourceBinding({ scriptSourceBindingId: "source-binding-1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/asset-lock-records",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "remove_source_binding",
          scriptSourceBindingId: "source-binding-1"
        })
      })
    );
  });

  it("formats source binding failures for the workbench", () => {
    expect(formatAssetLockError(new Error("asset_lock_action_forbidden"))).toBe("当前角色没有权限修改这条剧本来源绑定。");
    expect(formatAssetLockError(new Error("asset_lock_episode_scope_forbidden"))).toBe(
      "当前角色没有权限修改这条剧本来源绑定。"
    );
    expect(formatAssetLockError(new Error("Script source binding already exists"))).toBe("这段剧本来源已经绑定过了。");
    expect(formatAssetLockError(new Error("Line range exceeds script content"))).toBe(
      "剧本来源行号无效，请确认集数和起止行号。"
    );
  });
});
