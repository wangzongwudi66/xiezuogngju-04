import { describe, expect, it } from "vitest";
import { createScriptSourceBinding, extractScriptSourceExcerptSnapshot } from "./script-source-binding";
import type {
  AssetLockRecord,
  DeliveryPackage,
  DeliveryPackageEpisode,
  ScriptSourceBinding,
  WorkspaceState
} from "./types";

const publishedPackage: DeliveryPackage = {
  id: "delivery-1",
  projectId: "project-1",
  type: "range",
  title: "Episodes 1-2",
  declaredEpisodeFrom: 1,
  declaredEpisodeTo: 2,
  status: "published",
  uploadedByUserId: "user-writer",
  createdAt: "2026-05-01T00:00:00.000Z",
  publishedAt: "2026-05-02T00:00:00.000Z"
};

const packageEpisode: DeliveryPackageEpisode = {
  id: "delivery-episode-1",
  deliveryPackageId: "delivery-1",
  episodeNo: 1,
  title: "Episode 1",
  content: "Line 1\nMine map appears.\nLine 3",
  isConfirmedChange: true
};

const assetRecord: AssetLockRecord = {
  id: "asset-map",
  projectId: "project-1",
  deliveryPackageId: "delivery-1",
  episodeNos: [1, 2],
  assetName: "Mine Map",
  assetType: "prop",
  changeType: "new",
  writerConfirmation: "pending",
  productionConfirmation: "pending",
  risk: "normal",
  status: "draft",
  createdByUserId: "user-writer",
  createdAt: "2026-05-02T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z"
};

describe("script source binding", () => {
  it("creates a binding with a stable excerpt snapshot from a line range", () => {
    const binding = createScriptSourceBinding(
      buildState(),
      buildInput({ startLine: 2, endLine: 3 }),
      { id: "binding-1", createdAt: "2026-05-03T00:00:00.000Z" }
    );

    expect(binding).toEqual({
      id: "binding-1",
      projectId: "project-1",
      deliveryPackageId: "delivery-1",
      assetLockRecordId: "asset-map",
      episodeNo: 1,
      startLine: 2,
      endLine: 3,
      excerptSnapshot: "Mine map appears.\nLine 3",
      createdByUserId: "user-writer",
      createdAt: "2026-05-03T00:00:00.000Z"
    });
  });

  it("normalizes CRLF and LF content into the same excerpt snapshot", () => {
    expect(extractScriptSourceExcerptSnapshot("Line 1\nLine 2\nLine 3", 2, 3)).toBe("Line 2\nLine 3");
    expect(extractScriptSourceExcerptSnapshot("Line 1\r\nLine 2\r\nLine 3", 2, 3)).toBe("Line 2\nLine 3");
  });

  it("preserves selected range whitespace while using trim only for empty checks", () => {
    expect(extractScriptSourceExcerptSnapshot("Line 1\n  indented line  \n\nLine 4", 2, 4)).toBe(
      "  indented line  \n\nLine 4"
    );
  });

  it("rejects missing or mismatched project/package/record inputs", () => {
    expect(() => createScriptSourceBinding(buildState({ projects: [] }), buildInput())).toThrow("Project not found");
    expect(() => createScriptSourceBinding(buildState({ deliveryPackages: [] }), buildInput())).toThrow(
      "Delivery package not found"
    );
    expect(() =>
      createScriptSourceBinding(
        buildState({ deliveryPackages: [{ ...publishedPackage, projectId: "project-other" }] }),
        buildInput()
      )
    ).toThrow("Delivery package project mismatch");
    expect(() => createScriptSourceBinding(buildState({ assetLockRecords: [] }), buildInput())).toThrow(
      "Asset lock record not found"
    );
    expect(() =>
      createScriptSourceBinding(buildState({ assetLockRecords: [{ ...assetRecord, projectId: "project-other" }] }), buildInput())
    ).toThrow("Asset lock record project mismatch");
    expect(() =>
      createScriptSourceBinding(
        buildState({ assetLockRecords: [{ ...assetRecord, deliveryPackageId: "delivery-other" }] }),
        buildInput()
      )
    ).toThrow("Asset lock record package mismatch");
  });

  it("rejects unpublished packages and unconfirmed package episodes", () => {
    expect(() =>
      createScriptSourceBinding(buildState({ deliveryPackages: [{ ...publishedPackage, status: "pending_review" }] }), buildInput())
    ).toThrow("Delivery package must be published");
    expect(() =>
      createScriptSourceBinding(buildState({ deliveryPackageEpisodes: [{ ...packageEpisode, isConfirmedChange: false }] }), buildInput())
    ).toThrow("Delivery package episode must be confirmed");
  });

  it("rejects a source episode outside the asset record episode range", () => {
    expect(() => createScriptSourceBinding(buildState(), buildInput({ episodeNo: 3 }))).toThrow(
      "Source binding episode must intersect the asset lock record"
    );
  });

  it("rejects a missing package episode after record episode range passes", () => {
    expect(() => createScriptSourceBinding(buildState(), buildInput({ episodeNo: 2 }))).toThrow(
      "Delivery package episode not found"
    );
  });

  it("rejects invalid or empty line ranges", () => {
    expect(() => createScriptSourceBinding(buildState(), buildInput({ startLine: 1.5, endLine: 2 }))).toThrow(
      "Line range must use integer line numbers"
    );
    expect(() => createScriptSourceBinding(buildState(), buildInput({ startLine: 0, endLine: 1 }))).toThrow(
      "Line range must start at line 1 or later"
    );
    expect(() => createScriptSourceBinding(buildState(), buildInput({ startLine: 3, endLine: 2 }))).toThrow(
      "Line range start must be before or equal to end"
    );
    expect(() => createScriptSourceBinding(buildState(), buildInput({ startLine: 2, endLine: 4 }))).toThrow(
      "Line range exceeds script content"
    );
    expect(() =>
      createScriptSourceBinding(
        buildState({ deliveryPackageEpisodes: [{ ...packageEpisode, content: "Line 1\n   \nLine 3" }] }),
        buildInput({ startLine: 2, endLine: 2 })
      )
    ).toThrow("Source excerpt cannot be empty");
  });

  it("rejects exact duplicate bindings but allows overlapping ranges", () => {
    const existing = buildBinding({ startLine: 2, endLine: 2 });

    expect(() => createScriptSourceBinding(buildState({ scriptSourceBindings: [existing] }), buildInput({ startLine: 2, endLine: 2 }))).toThrow(
      "Script source binding already exists"
    );

    expect(
      createScriptSourceBinding(
        buildState({ scriptSourceBindings: [existing] }),
        buildInput({ startLine: 2, endLine: 3 }),
        { id: "binding-overlap", createdAt: "2026-05-03T00:00:00.000Z" }
      )
    ).toMatchObject({
      id: "binding-overlap",
      startLine: 2,
      endLine: 3
    });
  });

  it("rejects locked asset records", () => {
    expect(() =>
      createScriptSourceBinding(buildState({ assetLockRecords: [{ ...assetRecord, status: "locked" }] }), buildInput())
    ).toThrow("Locked asset lock records cannot change source bindings");
  });

  it("does not require legacy workspaces to include scriptSourceBindings", () => {
    const legacyState = buildState();
    delete legacyState.scriptSourceBindings;

    expect(createScriptSourceBinding(legacyState, buildInput(), { id: "binding-legacy" })).toMatchObject({
      id: "binding-legacy",
      excerptSnapshot: "Mine map appears."
    });
  });
});

function buildInput(patch: Partial<Parameters<typeof createScriptSourceBinding>[1]> = {}) {
  return {
    projectId: "project-1",
    deliveryPackageId: "delivery-1",
    assetLockRecordId: "asset-map",
    episodeNo: 1,
    startLine: 2,
    endLine: 2,
    createdByUserId: "user-writer",
    ...patch
  };
}

function buildBinding(patch: Partial<ScriptSourceBinding> = {}): ScriptSourceBinding {
  return {
    id: "binding-existing",
    projectId: "project-1",
    deliveryPackageId: "delivery-1",
    assetLockRecordId: "asset-map",
    episodeNo: 1,
    startLine: 2,
    endLine: 2,
    excerptSnapshot: "Mine map appears.",
    createdByUserId: "user-writer",
    createdAt: "2026-05-03T00:00:00.000Z",
    ...patch
  };
}

function buildState(patch: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    currentUserId: "user-writer",
    users: [],
    projects: [
      {
        id: "project-1",
        name: "Project One",
        code: "P1",
        episodeCount: 3,
        status: "active",
        createdAt: "2026-05-01T00:00:00.000Z"
      }
    ],
    members: [],
    memberPermissions: [],
    episodes: [],
    assignments: [],
    assetLockRecords: [assetRecord],
    assetAttachments: [],
    scriptSourceBindings: [],
    deliveryPackages: [publishedPackage],
    deliveryPackageEpisodes: [packageEpisode],
    episodeRevisions: [],
    episodeCurrents: [],
    notifications: [],
    ...patch
  };
}
