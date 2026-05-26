import type { AssetLockRecord, ScriptSourceBinding } from "@aigc/domain";
import type { AssetLockActorRole } from "./asset-lock-workbench-data";

export type AssetSourceBindingDraft = {
  episodeNo: number;
  startLine: number;
  endLine: number;
};

export type AssetSourceBindingAccess = {
  canEdit: boolean;
  disabledReason: string;
  helperText: string;
};

export function groupSourceBindingsByRecord(bindings: ScriptSourceBinding[]) {
  return bindings.reduce<Record<string, ScriptSourceBinding[]>>((groups, binding) => {
    const group = groups[binding.assetLockRecordId] ?? [];
    group.push(binding);
    groups[binding.assetLockRecordId] = group;
    return groups;
  }, {});
}

export function getSourceBindingCountLabel(count: number) {
  return `已绑定 ${Math.max(0, count)} 段`;
}

export function getSourceBindingsForRecord(recordId: string | null | undefined, bindings: ScriptSourceBinding[]) {
  if (!recordId) {
    return [];
  }

  return bindings
    .filter((binding) => binding.assetLockRecordId === recordId)
    .sort((left, right) => left.episodeNo - right.episodeNo || left.startLine - right.startLine || left.endLine - right.endLine);
}

export function createDefaultSourceBindingDraft(record: Pick<AssetLockRecord, "episodeNos"> | null | undefined): AssetSourceBindingDraft {
  return {
    episodeNo: record?.episodeNos[0] ?? 1,
    startLine: 1,
    endLine: 1
  };
}

export function normalizeSourceBindingDraft(
  draft: AssetSourceBindingDraft,
  record: Pick<AssetLockRecord, "episodeNos"> | null | undefined
): AssetSourceBindingDraft {
  const episodeNos = record?.episodeNos ?? [];
  const episodeNo = episodeNos.includes(draft.episodeNo) ? draft.episodeNo : episodeNos[0] ?? draft.episodeNo;
  const startLine = Math.max(1, Math.trunc(draft.startLine || 1));
  const endLine = Math.max(startLine, Math.trunc(draft.endLine || startLine));

  return {
    episodeNo,
    startLine,
    endLine
  };
}

export function getSourceBindingAccess(input: {
  actorRole: AssetLockActorRole;
  isLocked: boolean;
  isBusy?: boolean;
}): AssetSourceBindingAccess {
  if (input.isLocked) {
    return {
      canEdit: false,
      disabledReason: "这条资产记录已定版，不能修改剧本来源绑定。",
      helperText: "已定版记录只保留来源快照供查看。"
    };
  }

  if (input.isBusy) {
    return {
      canEdit: false,
      disabledReason: "正在处理上一项来源绑定操作，请稍等。",
      helperText: "提交完成后会刷新当前记录的来源绑定。"
    };
  }

  if (input.actorRole === "creator") {
    return {
      canEdit: false,
      disabledReason: "创作者可查看来源绑定，不能修改，请联系统筹或主编剧。",
      helperText: "创作者只读；如来源段落有误，请在讨论里反馈给统筹或主编剧。"
    };
  }

  return {
    canEdit: true,
    disabledReason: "",
    helperText:
      input.actorRole === "writer"
        ? "编剧只能绑定自己负责集数内的来源段落，最终以服务端权限校验为准。"
        : "选择集数和行号后绑定，系统会从已发布交稿包生成来源快照。"
  };
}

export function formatSourceBindingRange(binding: Pick<ScriptSourceBinding, "episodeNo" | "startLine" | "endLine">) {
  return `第 ${binding.episodeNo} 集 · L${binding.startLine}-L${binding.endLine}`;
}
