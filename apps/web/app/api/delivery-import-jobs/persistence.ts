import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDeliveryPackageDraft, seedWorkspace } from "@aigc/domain";
import type { WordDeliveryIssue, WorkspaceState } from "@aigc/domain";
import type { DeliveryImportJobResponse } from "./service";

interface DeliveryImportJobStore {
  version: 1;
  results: DeliveryImportJobResponse[];
  workspace: WorkspaceState;
  deliveryParseIssuesByPackageId: Record<string, WordDeliveryIssue[]>;
}

export interface DeliveryImportWorkspaceSnapshot {
  state: WorkspaceState;
  deliveryParseIssuesByPackageId: Record<string, WordDeliveryIssue[]>;
}

const storePathEnvKey = "AIGC_DELIVERY_IMPORT_STORE_PATH";
const defaultStorePath = path.join(process.cwd(), ".local-data", "delivery-import-jobs.json");

export async function saveDeliveryImportJobResult(result: DeliveryImportJobResponse) {
  const store = await readDeliveryImportJobStore();
  const nextResults = [result, ...store.results.filter((item) => item.job.id !== result.job.id)].slice(0, 200);
  await writeDeliveryImportJobStore({ ...store, results: nextResults });
}

export async function saveDeliveryImportJobResultWithDraft(result: DeliveryImportJobResponse) {
  if (!result.ok) {
    await saveDeliveryImportJobResult(result);
    return result;
  }

  const store = await readDeliveryImportJobStore();
  const nextWorkspace = createDeliveryPackageDraft(store.workspace, result.draft);
  const deliveryPackage = nextWorkspace.deliveryPackages.at(-1);

  if (!deliveryPackage) {
    await saveDeliveryImportJobResult(result);
    return result;
  }

  const persistedResult: DeliveryImportJobResponse = {
    ...result,
    job: {
      ...result.job,
      deliveryPackageId: deliveryPackage.id
    }
  };
  const nextResults = [persistedResult, ...store.results.filter((item) => item.job.id !== result.job.id)].slice(0, 200);

  await writeDeliveryImportJobStore({
    ...store,
    results: nextResults,
    workspace: nextWorkspace,
    deliveryParseIssuesByPackageId: {
      ...store.deliveryParseIssuesByPackageId,
      [deliveryPackage.id]: result.issues
    }
  });

  return persistedResult;
}

export async function readDeliveryImportJobResult(jobId: string) {
  const store = await readDeliveryImportJobStore();
  return store.results.find((result) => result.job.id === jobId) ?? null;
}

export async function readDeliveryImportJobs(projectId?: string) {
  const store = await readDeliveryImportJobStore();
  return store.results
    .map((result) => result.job)
    .filter((job) => !projectId || job.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readDeliveryImportWorkspace(): Promise<DeliveryImportWorkspaceSnapshot> {
  const store = await readDeliveryImportJobStore();
  return {
    state: store.workspace,
    deliveryParseIssuesByPackageId: store.deliveryParseIssuesByPackageId
  };
}

export async function mutateDeliveryImportWorkspace(
  mutate: (state: WorkspaceState) => WorkspaceState
): Promise<DeliveryImportWorkspaceSnapshot> {
  const store = await readDeliveryImportJobStore();
  const nextWorkspace = mutate(store.workspace);

  await writeDeliveryImportJobStore({
    ...store,
    workspace: nextWorkspace
  });

  return {
    state: nextWorkspace,
    deliveryParseIssuesByPackageId: store.deliveryParseIssuesByPackageId
  };
}

async function readDeliveryImportJobStore(): Promise<DeliveryImportJobStore> {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ resolveDeliveryImportStorePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DeliveryImportJobStore>;

    if (parsed.version !== 1 || !Array.isArray(parsed.results)) {
      return emptyStore();
    }

    return {
      version: 1,
      results: parsed.results,
      workspace: parsed.workspace && typeof parsed.workspace === "object" ? parsed.workspace : seedWorkspace,
      deliveryParseIssuesByPackageId:
        parsed.deliveryParseIssuesByPackageId && typeof parsed.deliveryParseIssuesByPackageId === "object"
          ? parsed.deliveryParseIssuesByPackageId
          : {}
    };
  } catch {
    return emptyStore();
  }
}

async function writeDeliveryImportJobStore(store: DeliveryImportJobStore) {
  const filePath = resolveDeliveryImportStorePath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(filePath), { recursive: true });
  await writeFile(/* turbopackIgnore: true */ filePath, JSON.stringify(store, null, 2), "utf8");
}

function resolveDeliveryImportStorePath() {
  return process.env[storePathEnvKey] || defaultStorePath;
}

function emptyStore(): DeliveryImportJobStore {
  return { version: 1, results: [], workspace: seedWorkspace, deliveryParseIssuesByPackageId: {} };
}
