import type { WordDeliveryIssue, WorkspaceState } from "@aigc/domain";

export const M2_WORKSPACE_PERSISTENCE_KEY = "aigc-collab-tool:m2-workspace:v1";

export interface DeliveryImportJob {
  id: string;
  projectId: string;
  source: "docx" | "text";
  status: "processing" | "success" | "failed";
  fileName: string;
  declaredRangeText: string;
  createdAt: string;
  completedAt?: string;
  deliveryPackageId?: string;
  issueCount?: number;
  errorText?: string;
}

export interface M2WorkspacePersistenceSnapshot {
  deliveryImportJobs: DeliveryImportJob[];
  deliveryParseIssuesByPackageId: Record<string, WordDeliveryIssue[]>;
  state: WorkspaceState;
}

interface StoredM2WorkspacePersistenceSnapshot extends M2WorkspacePersistenceSnapshot {
  version: 1;
}

export function readM2WorkspacePersistence(): M2WorkspacePersistenceSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return decodeM2WorkspacePersistence(window.localStorage.getItem(M2_WORKSPACE_PERSISTENCE_KEY));
  } catch {
    return null;
  }
}

export function writeM2WorkspacePersistence(snapshot: M2WorkspacePersistenceSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(M2_WORKSPACE_PERSISTENCE_KEY, encodeM2WorkspacePersistence(snapshot));
  } catch {
    // Persistence is a prototype convenience; full in-memory behavior should keep working if storage is blocked.
  }
}

export function clearM2WorkspacePersistence() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(M2_WORKSPACE_PERSISTENCE_KEY);
  } catch {
    // Ignore blocked storage in the local prototype.
  }
}

export function encodeM2WorkspacePersistence(snapshot: M2WorkspacePersistenceSnapshot) {
  return JSON.stringify({
    version: 1,
    state: snapshot.state,
    deliveryImportJobs: snapshot.deliveryImportJobs,
    deliveryParseIssuesByPackageId: snapshot.deliveryParseIssuesByPackageId
  } satisfies StoredM2WorkspacePersistenceSnapshot);
}

export function decodeM2WorkspacePersistence(raw: string | null): M2WorkspacePersistenceSnapshot | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredM2WorkspacePersistenceSnapshot>;

    if (parsed.version !== 1 || !parsed.state || typeof parsed.state !== "object") {
      return null;
    }

    return {
      state: parsed.state,
      deliveryImportJobs: Array.isArray(parsed.deliveryImportJobs) ? parsed.deliveryImportJobs : [],
      deliveryParseIssuesByPackageId:
        parsed.deliveryParseIssuesByPackageId && typeof parsed.deliveryParseIssuesByPackageId === "object"
          ? parsed.deliveryParseIssuesByPackageId
          : {}
    };
  } catch {
    return null;
  }
}
