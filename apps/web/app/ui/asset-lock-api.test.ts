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
    const cases = [
      {
        message: "Script source binding already exists",
        copy: "这段剧本来源已经绑定过了，请选择不同的行号或先移除原绑定。"
      },
      {
        message: "Line range exceeds script content",
        copy: "来源行号超出当前集剧本文本范围，请确认已发布交稿包里的行号。"
      },
      {
        message: "Line range start must be before or equal to end",
        copy: "来源起始行不能大于结束行，请调整后再绑定。"
      },
      {
        message: "Line range must start at line 1 or later",
        copy: "来源行号必须是从 1 开始的整数，请重新填写起止行。"
      },
      {
        message: "Line range must use integer line numbers",
        copy: "来源行号必须是从 1 开始的整数，请重新填写起止行。"
      },
      {
        message: "Source excerpt cannot be empty",
        copy: "选中的来源段落为空，请选择包含剧本文本的行。"
      },
      {
        message: "Delivery package episode not found",
        copy: "没有找到这一集的已发布剧本文本，请确认交稿包和集数后重试。"
      },
      {
        message: "Delivery package episode must be confirmed",
        copy: "这一集未标记为实际变更，不能作为剧本来源绑定。"
      },
      {
        message: "Source binding episode must intersect the asset lock record",
        copy: "这条资产记录不包含所选集数，请确认资产记录关联集数后再绑定。"
      },
      {
        message: "Locked asset lock records cannot change source bindings",
        copy: "这条资产记录已定版，不能修改剧本来源绑定。"
      },
      {
        message: "asset_lock_action_forbidden",
        context: { action: "bind_source" as const },
        copy: "当前账号没有修改剧本来源绑定的权限，请联系统筹或主编剧处理。"
      },
      {
        message: "asset_lock_project_member_required",
        context: { action: "bind_source" as const },
        copy: "当前账号不在这个项目中，不能修改剧本来源绑定。"
      },
      {
        message: "asset_lock_unauthenticated",
        context: { action: "bind_source" as const },
        copy: "请先登录后再修改剧本来源绑定。"
      },
      {
        message: "asset_lock_episode_scope_forbidden",
        context: { action: "remove_source_binding" as const },
        copy: "编剧只能修改自己负责集数内的剧本来源绑定，请切换到负责集数或联系统筹、主编剧。"
      },
      {
        message: "script_source_binding_not_found",
        copy: "没有找到这段来源绑定，请刷新后重试。"
      }
    ];

    for (const item of cases) {
      expect(formatAssetLockError(new Error(item.message), item.context)).toBe(item.copy);
    }
  });

  it("keeps generic asset lock permission errors out of source binding copy without action context", () => {
    expect(formatAssetLockError(new Error("asset_lock_action_forbidden"))).toBe("");
    expect(formatAssetLockError(new Error("asset_lock_episode_scope_forbidden"))).toBe("");
  });
});
