import type { ScriptSourceBinding, ScriptSourceBindingInput, WorkspaceState } from "./types";

export interface CreateScriptSourceBindingOptions {
  id?: string;
  createdAt?: string;
}

export function createScriptSourceBinding(
  state: WorkspaceState,
  input: ScriptSourceBindingInput,
  options: CreateScriptSourceBindingOptions = {}
): ScriptSourceBinding {
  const project = state.projects.find((item) => item.id === input.projectId);

  if (!project) {
    throw new Error("Project not found");
  }

  const deliveryPackage = state.deliveryPackages.find((item) => item.id === input.deliveryPackageId);

  if (!deliveryPackage) {
    throw new Error("Delivery package not found");
  }

  if (deliveryPackage.projectId !== input.projectId) {
    throw new Error("Delivery package project mismatch");
  }

  if (deliveryPackage.status !== "published") {
    throw new Error("Delivery package must be published");
  }

  const record = (state.assetLockRecords ?? []).find((item) => item.id === input.assetLockRecordId);

  if (!record) {
    throw new Error("Asset lock record not found");
  }

  if (record.projectId !== input.projectId) {
    throw new Error("Asset lock record project mismatch");
  }

  if (record.deliveryPackageId !== input.deliveryPackageId) {
    throw new Error("Asset lock record package mismatch");
  }

  if (record.status === "locked") {
    throw new Error("Locked asset lock records cannot change source bindings");
  }

  if (!record.episodeNos.includes(input.episodeNo)) {
    throw new Error("Source binding episode must intersect the asset lock record");
  }

  const packageEpisode = state.deliveryPackageEpisodes.find(
    (item) => item.deliveryPackageId === input.deliveryPackageId && item.episodeNo === input.episodeNo
  );

  if (!packageEpisode) {
    throw new Error("Delivery package episode not found");
  }

  if (!packageEpisode.isConfirmedChange) {
    throw new Error("Delivery package episode must be confirmed");
  }

  const excerptSnapshot = extractScriptSourceExcerptSnapshot(packageEpisode.content, input.startLine, input.endLine);

  const isDuplicate = (state.scriptSourceBindings ?? []).some(
    (binding) =>
      binding.assetLockRecordId === input.assetLockRecordId &&
      binding.deliveryPackageId === input.deliveryPackageId &&
      binding.episodeNo === input.episodeNo &&
      binding.startLine === input.startLine &&
      binding.endLine === input.endLine
  );

  if (isDuplicate) {
    throw new Error("Script source binding already exists");
  }

  return {
    id: options.id ?? createScriptSourceBindingId(input),
    projectId: input.projectId,
    deliveryPackageId: input.deliveryPackageId,
    assetLockRecordId: input.assetLockRecordId,
    episodeNo: input.episodeNo,
    startLine: input.startLine,
    endLine: input.endLine,
    excerptSnapshot,
    createdByUserId: input.createdByUserId,
    createdAt: options.createdAt ?? new Date().toISOString()
  };
}

export function extractScriptSourceExcerptSnapshot(content: string, startLine: number, endLine: number): string {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    throw new Error("Line range must use integer line numbers");
  }

  if (startLine < 1 || endLine < 1) {
    throw new Error("Line range must start at line 1 or later");
  }

  if (startLine > endLine) {
    throw new Error("Line range start must be before or equal to end");
  }

  const lines = splitScriptLines(content);

  if (endLine > lines.length) {
    throw new Error("Line range exceeds script content");
  }

  const excerptSnapshot = lines.slice(startLine - 1, endLine).join("\n");

  if (!excerptSnapshot.trim()) {
    throw new Error("Source excerpt cannot be empty");
  }

  return excerptSnapshot;
}

function splitScriptLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function createScriptSourceBindingId(input: ScriptSourceBindingInput): string {
  return `script-source-binding-${input.assetLockRecordId}-ep${input.episodeNo}-l${input.startLine}-${input.endLine}`;
}
