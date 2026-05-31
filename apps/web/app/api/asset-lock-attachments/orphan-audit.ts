import { createHash } from "node:crypto";
import path from "node:path";
import type { AssetAttachmentStorageAuditAdapter, AssetAttachmentStorageAuditObject } from "./storage-audit";

const defaultGracePeriodMs = 24 * 60 * 60 * 1000;
const defaultMaxReportItems = 1000;

export type AssetAttachmentAuditReason = "orphan_candidate" | "young" | "unknown_age";

export interface AssetAttachmentReferencedRow {
  fileId: string;
  fileName: string;
  status: "active" | "deleted" | string;
  storageKey?: string | null;
}

export interface AssetAttachmentOrphanAuditReportItem {
  keyHash: string;
  sizeBytes: number;
  reason: AssetAttachmentAuditReason;
  ageMs?: number;
  ageBucket?: string;
}

export interface AssetAttachmentOrphanAuditReport {
  generatedAt: string;
  gracePeriodMs: number;
  counts: {
    providerObjectCount: number;
    referencedKeyCount: number;
    referencedObjectCount: number;
    unreferencedObjectCount: number;
    orphanCandidateCount: number;
    youngObjectCount: number;
    unknownAgeObjectCount: number;
    omittedItemCount: number;
  };
  totalSizeBytes: number;
  reasonCounts: Record<AssetAttachmentAuditReason, number>;
  ageBuckets: Record<string, number>;
  items: AssetAttachmentOrphanAuditReportItem[];
}

export async function runAssetAttachmentOrphanAudit(input: {
  adapter: AssetAttachmentStorageAuditAdapter;
  referencedRows: AssetAttachmentReferencedRow[];
  gracePeriodMs?: number;
  maxItems?: number;
  now?: Date;
}): Promise<AssetAttachmentOrphanAuditReport> {
  const now = input.now ?? new Date();
  const gracePeriodMs = input.gracePeriodMs ?? defaultGracePeriodMs;
  const maxItems = input.maxItems ?? defaultMaxReportItems;
  const referencedKeys = createAssetAttachmentReferencedKeySet(input.referencedRows);
  const report = createEmptyReport({ now, gracePeriodMs });

  report.counts.referencedKeyCount = referencedKeys.size;

  for await (const object of input.adapter.listObjects()) {
    report.counts.providerObjectCount += 1;

    if (referencedKeys.has(normalizeAuditKey(object.key))) {
      report.counts.referencedObjectCount += 1;
      continue;
    }

    report.counts.unreferencedObjectCount += 1;
    addUnreferencedObjectToReport(report, object, { now, gracePeriodMs, maxItems });
  }

  return report;
}

export function createAssetAttachmentReferencedKeySet(rows: AssetAttachmentReferencedRow[]): ReadonlySet<string> {
  const keys = new Set<string>();

  for (const row of rows) {
    if (row.status !== "active" && row.status !== "deleted") {
      continue;
    }

    keys.add(resolveReferencedStorageKey(row));
  }

  return keys;
}

export function hashAssetAttachmentAuditKey(rawKey: string) {
  return createHash("sha256").update(rawKey).digest("hex");
}

function addUnreferencedObjectToReport(
  report: AssetAttachmentOrphanAuditReport,
  object: AssetAttachmentStorageAuditObject,
  input: { now: Date; gracePeriodMs: number; maxItems: number }
) {
  const sizeBytes = Math.max(0, object.sizeBytes);

  if (!object.lastModified) {
    report.counts.unknownAgeObjectCount += 1;
    report.reasonCounts.unknown_age += 1;
    addReportItem(report, input.maxItems, {
      keyHash: hashAssetAttachmentAuditKey(object.key),
      sizeBytes,
      reason: "unknown_age"
    });
    return;
  }

  const ageMs = Math.max(0, input.now.getTime() - object.lastModified.getTime());
  const ageBucket = getAgeBucket(ageMs);
  report.ageBuckets[ageBucket] = (report.ageBuckets[ageBucket] ?? 0) + 1;

  if (ageMs < input.gracePeriodMs) {
    report.counts.youngObjectCount += 1;
    report.reasonCounts.young += 1;
    addReportItem(report, input.maxItems, {
      keyHash: hashAssetAttachmentAuditKey(object.key),
      sizeBytes,
      reason: "young",
      ageMs,
      ageBucket
    });
    return;
  }

  report.counts.orphanCandidateCount += 1;
  report.reasonCounts.orphan_candidate += 1;
  report.totalSizeBytes += sizeBytes;
  addReportItem(report, input.maxItems, {
    keyHash: hashAssetAttachmentAuditKey(object.key),
    sizeBytes,
    reason: "orphan_candidate",
    ageMs,
    ageBucket
  });
}

function addReportItem(
  report: AssetAttachmentOrphanAuditReport,
  maxItems: number,
  item: AssetAttachmentOrphanAuditReportItem
) {
  if (report.items.length >= maxItems) {
    report.counts.omittedItemCount += 1;
    return;
  }

  report.items.push(item);
}

function resolveReferencedStorageKey(row: AssetAttachmentReferencedRow) {
  const storageKey = row.storageKey?.trim();

  if (storageKey) {
    return normalizeAuditKey(storageKey);
  }

  return normalizeAuditKey(`${row.fileId}${path.extname(row.fileName)}`);
}

function normalizeAuditKey(key: string) {
  return key.trim().replace(/\\/g, "/");
}

function getAgeBucket(ageMs: number) {
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;

  if (ageMs < hourMs) {
    return "lt_1h";
  }

  if (ageMs < dayMs) {
    return "1h_24h";
  }

  if (ageMs < 7 * dayMs) {
    return "1d_7d";
  }

  return "gte_7d";
}

function createEmptyReport(input: { now: Date; gracePeriodMs: number }): AssetAttachmentOrphanAuditReport {
  return {
    generatedAt: input.now.toISOString(),
    gracePeriodMs: input.gracePeriodMs,
    counts: {
      providerObjectCount: 0,
      referencedKeyCount: 0,
      referencedObjectCount: 0,
      unreferencedObjectCount: 0,
      orphanCandidateCount: 0,
      youngObjectCount: 0,
      unknownAgeObjectCount: 0,
      omittedItemCount: 0
    },
    totalSizeBytes: 0,
    reasonCounts: {
      orphan_candidate: 0,
      young: 0,
      unknown_age: 0
    },
    ageBuckets: {},
    items: []
  };
}
