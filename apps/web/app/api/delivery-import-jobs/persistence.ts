import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DeliveryImportJobResponse } from "./service";

interface DeliveryImportJobStore {
  version: 1;
  results: DeliveryImportJobResponse[];
}

const storePathEnvKey = "AIGC_DELIVERY_IMPORT_STORE_PATH";
const defaultStorePath = ".local-data/delivery-import-jobs.json";

export async function saveDeliveryImportJobResult(result: DeliveryImportJobResponse) {
  const store = await readDeliveryImportJobStore();
  const nextResults = [result, ...store.results.filter((item) => item.job.id !== result.job.id)].slice(0, 200);
  await writeDeliveryImportJobStore({ version: 1, results: nextResults });
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

async function readDeliveryImportJobStore(): Promise<DeliveryImportJobStore> {
  try {
    const raw = await readFile(resolveDeliveryImportStorePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DeliveryImportJobStore>;

    if (parsed.version !== 1 || !Array.isArray(parsed.results)) {
      return emptyStore();
    }

    return { version: 1, results: parsed.results };
  } catch {
    return emptyStore();
  }
}

async function writeDeliveryImportJobStore(store: DeliveryImportJobStore) {
  const filePath = resolveDeliveryImportStorePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
}

function resolveDeliveryImportStorePath() {
  return process.env[storePathEnvKey] || defaultStorePath;
}

function emptyStore(): DeliveryImportJobStore {
  return { version: 1, results: [] };
}
