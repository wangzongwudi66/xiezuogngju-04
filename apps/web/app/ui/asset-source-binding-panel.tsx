"use client";

import { BookOpenCheck, Link2Off } from "lucide-react";
import type { ChangeEvent, FormEvent } from "react";
import type { AssetLockRecord, ScriptSourceBinding } from "@aigc/domain";
import type { AssetLockActorRole } from "./asset-lock-workbench-data";
import {
  formatSourceBindingRange,
  getSourceBindingAccess,
  normalizeSourceBindingDraft
} from "./asset-source-binding-data";
import type { AssetSourceBindingDraft } from "./asset-source-binding-data";

export function AssetSourceBindingPanel({
  actorRole,
  bindingError,
  bindingSuccess,
  bindings,
  draft,
  isBusy,
  isLocked,
  onBind,
  onDraftChange,
  onRemove,
  record
}: {
  actorRole: AssetLockActorRole;
  bindingError: string | null;
  bindingSuccess: string | null;
  bindings: ScriptSourceBinding[];
  draft: AssetSourceBindingDraft;
  isBusy: boolean;
  isLocked: boolean;
  onBind: () => void;
  onDraftChange: (draft: AssetSourceBindingDraft) => void;
  onRemove: (scriptSourceBindingId: string) => void;
  record: AssetLockRecord;
}) {
  const access = getSourceBindingAccess({ actorRole, isBusy, isLocked });
  const normalizedDraft = normalizeSourceBindingDraft(draft, record);
  const canSubmit = access.canEdit && !isBusy;

  function updateDraft(patch: Partial<AssetSourceBindingDraft>) {
    onDraftChange(
      normalizeSourceBindingDraft(
        {
          ...normalizedDraft,
          ...patch
        },
        record
      )
    );
  }

  function handleNumberChange(key: keyof AssetSourceBindingDraft) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      updateDraft({ [key]: Number(event.target.value) } as Partial<AssetSourceBindingDraft>);
    };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) {
      onBind();
    }
  }

  return (
    <div className="asset-attachment-panel asset-source-binding-panel">
      <div className="asset-attachment-head">
        <div>
          <BookOpenCheck size={15} />
          <strong>剧本来源绑定</strong>
        </div>
        <span>{bindings.length ? `${bindings.length} 段已绑定` : "未绑定"}</span>
      </div>

      {bindings.length === 0 ? (
        <p className="asset-attachment-empty">当前资产记录还没有显式来源绑定，资产轨道会先使用资产名匹配作为参考。</p>
      ) : (
        <div className="asset-attachment-list">
          {bindings.map((binding) => (
            <article key={binding.id}>
              <div>
                <strong>{formatSourceBindingRange(binding)}</strong>
                <span>由 {binding.createdByUserId} 绑定</span>
              </div>
              <p>{binding.excerptSnapshot}</p>
              <button
                className="secondary-button compact"
                disabled={!access.canEdit}
                onClick={() => onRemove(binding.id)}
                title={access.canEdit ? "移除这段来源绑定。" : access.disabledReason}
                type="button"
              >
                <Link2Off size={14} />
                移除
              </button>
            </article>
          ))}
        </div>
      )}

      <form className="asset-attachment-form" onSubmit={handleSubmit}>
        <p className={access.canEdit ? "inline-help" : "inline-warning"}>{access.helperText}</p>
        {access.disabledReason ? <p className="inline-help">{access.disabledReason}</p> : null}
        <label>
          集数
          <select disabled={!access.canEdit} value={normalizedDraft.episodeNo} onChange={handleNumberChange("episodeNo")}>
            {record.episodeNos.map((episodeNo) => (
              <option key={episodeNo} value={episodeNo}>
                第 {episodeNo} 集
              </option>
            ))}
          </select>
        </label>
        <label>
          起始行
          <input
            disabled={!access.canEdit}
            min={1}
            onChange={handleNumberChange("startLine")}
            type="number"
            value={normalizedDraft.startLine}
          />
        </label>
        <label>
          结束行
          <input
            disabled={!access.canEdit}
            min={normalizedDraft.startLine}
            onChange={handleNumberChange("endLine")}
            type="number"
            value={normalizedDraft.endLine}
          />
        </label>
        {bindingError ? <p className="inline-warning">{bindingError}</p> : null}
        {bindingSuccess ? <p className="inline-help">{bindingSuccess}</p> : null}
        <button className="secondary-button" disabled={!canSubmit} type="submit">
          <BookOpenCheck size={15} />
          {isBusy ? "绑定中..." : "绑定来源段落"}
        </button>
      </form>
    </div>
  );
}
