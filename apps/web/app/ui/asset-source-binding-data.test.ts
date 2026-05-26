import { describe, expect, it } from "vitest";
import {
  createDefaultSourceBindingDraft,
  formatSourceBindingRange,
  getSourceBindingAccess,
  getSourceBindingsForRecord,
  groupSourceBindingsByRecord,
  normalizeSourceBindingDraft
} from "./asset-source-binding-data";
import type { AssetLockRecord, ScriptSourceBinding } from "@aigc/domain";

describe("asset source binding data helpers", () => {
  it("groups and sorts bindings by asset lock record", () => {
    const bindings = [
      buildBinding({ id: "binding-2", assetLockRecordId: "record-1", episodeNo: 12, startLine: 8 }),
      buildBinding({ id: "binding-3", assetLockRecordId: "record-2", episodeNo: 11, startLine: 1 }),
      buildBinding({ id: "binding-1", assetLockRecordId: "record-1", episodeNo: 12, startLine: 2 })
    ];

    expect(groupSourceBindingsByRecord(bindings)).toMatchObject({
      "record-1": [{ id: "binding-2" }, { id: "binding-1" }],
      "record-2": [{ id: "binding-3" }]
    });
    expect(getSourceBindingsForRecord("record-1", bindings).map((binding) => binding.id)).toEqual(["binding-1", "binding-2"]);
  });

  it("builds and normalizes line range drafts", () => {
    const record = buildRecord({ episodeNos: [10, 12] });

    expect(createDefaultSourceBindingDraft(record)).toEqual({
      episodeNo: 10,
      startLine: 1,
      endLine: 1
    });
    expect(normalizeSourceBindingDraft({ episodeNo: 99, startLine: 4.8, endLine: 2 }, record)).toEqual({
      episodeNo: 10,
      startLine: 4,
      endLine: 4
    });
  });

  it("describes edit access by role and locked state", () => {
    expect(getSourceBindingAccess({ actorRole: "coordinator", isLocked: false })).toMatchObject({ canEdit: true });
    expect(getSourceBindingAccess({ actorRole: "head_writer", isLocked: false })).toMatchObject({ canEdit: true });
    expect(getSourceBindingAccess({ actorRole: "writer", isLocked: false }).helperText).toContain("自己负责集数");
    expect(getSourceBindingAccess({ actorRole: "creator", isLocked: false })).toMatchObject({
      canEdit: false,
      disabledReason: "创作者可查看来源绑定，不能修改，请联系统筹或主编剧。"
    });
    expect(getSourceBindingAccess({ actorRole: "owner", isLocked: true })).toMatchObject({
      canEdit: false,
      disabledReason: "这条资产记录已定版，不能修改剧本来源绑定。"
    });
  });

  it("keeps locked source binding access read-only with snapshot copy", () => {
    const actorRoles = ["owner", "coordinator", "head_writer", "writer", "creator"] as const;

    for (const actorRole of actorRoles) {
      expect(getSourceBindingAccess({ actorRole, isBusy: actorRole === "owner", isLocked: true })).toEqual({
        canEdit: false,
        disabledReason: "这条资产记录已定版，不能修改剧本来源绑定。",
        helperText: "已定版记录只保留来源快照供查看。"
      });
    }
  });

  it("formats binding ranges for display", () => {
    expect(formatSourceBindingRange(buildBinding({ episodeNo: 5, startLine: 12, endLine: 14 }))).toBe("第 5 集 · L12-L14");
  });
});

function buildBinding(patch: Partial<ScriptSourceBinding> = {}): ScriptSourceBinding {
  return {
    id: "binding-1",
    projectId: "project-1",
    deliveryPackageId: "delivery-1",
    assetLockRecordId: "record-1",
    episodeNo: 10,
    startLine: 1,
    endLine: 1,
    excerptSnapshot: "杜衡把地图压在灯下。",
    createdByUserId: "user-writer",
    createdAt: "2026-05-25T00:00:00.000Z",
    ...patch
  };
}

function buildRecord(patch: Partial<AssetLockRecord> = {}): AssetLockRecord {
  return {
    id: "record-1",
    projectId: "project-1",
    deliveryPackageId: "delivery-1",
    episodeNos: [10],
    assetName: "旧矿区手绘图",
    assetType: "prop",
    changeType: "new",
    writerConfirmation: "pending",
    productionConfirmation: "pending",
    risk: "normal",
    status: "draft",
    createdByUserId: "user-writer",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...patch
  };
}
