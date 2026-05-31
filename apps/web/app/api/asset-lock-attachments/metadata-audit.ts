import { createHash } from "node:crypto";
import path from "node:path";

const defaultMaxReportItems = 1000;

const allowedAssetAttachmentFileTypes: Record<string, true> = {
  ".jpg": true,
  ".jpeg": true,
  ".png": true,
  ".webp": true,
  ".pdf": true
};

export type AssetAttachmentMetadataAuditReason =
  | "missing_object"
  | "read_failed"
  | "size_mismatch"
  | "checksum_missing"
  | "checksum_invalid_format"
  | "checksum_mismatch"
  | "unsafe_key"
  | "duplicate_storage_key"
  | "storage_key_missing"
  | "backfill_candidate"
  | "ambiguous_candidate_match";

export type AssetAttachmentMetadataAuditCandidateSource =
  | "persisted_storage_key"
  | "current_provider"
  | "bare_legacy"
  | "legacy_prefix";

export interface AssetAttachmentMetadataAuditRow {
  id: string;
  fileId: string;
  fileName: string;
  status: "active" | "deleted" | string;
  sizeBytes: number;
  storageKey?: string | null;
  checksumSha256?: string | null;
}

export interface AssetAttachmentMetadataAuditReadAdapter {
  makeKey(input: { fileId: string; extension: string }): string;
  get(input: { key: string }): Promise<Uint8Array | null>;
}

export interface AssetAttachmentMetadataAuditReportItem {
  attachmentIdHash: string;
  reasons: AssetAttachmentMetadataAuditReason[];
  keyHash?: string;
  candidateKeyHashes?: string[];
}

export interface AssetAttachmentMetadataAuditReport {
  generatedAt: string;
  counts: {
    inputRowCount: number;
    referencedRowCount: number;
    skippedRowCount: number;
    persistedStorageKeyRowCount: number;
    candidateStorageKeyRowCount: number;
    verifiedRowCount: number;
    readableRowCount: number;
  };
  statusCounts: Record<string, number>;
  reasonCounts: Record<AssetAttachmentMetadataAuditReason, number>;
  sizeTotals: {
    expectedSizeBytes: number;
    verifiedSizeBytes: number;
    missingExpectedSizeBytes: number;
    mismatchedExpectedSizeBytes: number;
    mismatchedActualSizeBytes: number;
  };
  items: AssetAttachmentMetadataAuditReportItem[];
  omittedItemCount: number;
}

export interface AssetAttachmentMetadataAuditCandidate {
  key: string;
  keyHash: string;
  source: AssetAttachmentMetadataAuditCandidateSource;
}

interface CandidateVerificationResult {
  candidate: AssetAttachmentMetadataAuditCandidate;
  bytes?: Uint8Array;
  checksumSha256?: string;
  actualSizeBytes?: number;
  safe: boolean;
  missing: boolean;
  readFailed: boolean;
  sizeMatched: boolean;
  checksumMatched: boolean;
}

export async function runAssetAttachmentMetadataAudit(input: {
  adapter: AssetAttachmentMetadataAuditReadAdapter;
  rows: AssetAttachmentMetadataAuditRow[];
  legacyPrefixes?: string[];
  maxItems?: number;
  now?: Date;
}): Promise<AssetAttachmentMetadataAuditReport> {
  const now = input.now ?? new Date();
  const maxItems = input.maxItems ?? defaultMaxReportItems;
  const report = createEmptyReport(now);
  const duplicateStorageKeys = findDuplicatePersistedStorageKeys(input.rows);

  for (const row of input.rows) {
    report.counts.inputRowCount += 1;
    report.statusCounts[row.status] = (report.statusCounts[row.status] ?? 0) + 1;

    if (!isReferencedMetadataStatus(row.status)) {
      report.counts.skippedRowCount += 1;
      continue;
    }

    await auditReferencedRow(report, {
      adapter: input.adapter,
      row,
      legacyPrefixes: input.legacyPrefixes ?? [],
      maxItems,
      hasDuplicateStorageKey: hasDuplicatePersistedStorageKey(duplicateStorageKeys, row)
    });
  }

  return report;
}

export function hashAssetAttachmentMetadataAuditValue(rawValue: string) {
  return createHash("sha256").update(rawValue).digest("hex");
}

export function createAssetAttachmentMetadataAuditCandidates(input: {
  adapter: Pick<AssetAttachmentMetadataAuditReadAdapter, "makeKey">;
  row: AssetAttachmentMetadataAuditRow;
  legacyPrefixes?: string[];
}): AssetAttachmentMetadataAuditCandidate[] {
  const persistedStorageKey = input.row.storageKey?.trim();

  if (persistedStorageKey) {
    return [createCandidate(normalizeAuditKey(persistedStorageKey), "persisted_storage_key")];
  }

  const extension = path.extname(input.row.fileName);
  const bareLegacyKey = `${input.row.fileId}${extension}`;
  const candidates = [
    createCandidate(
      normalizeAuditKey(input.adapter.makeKey({ fileId: input.row.fileId, extension })),
      "current_provider"
    ),
    createCandidate(normalizeAuditKey(bareLegacyKey), "bare_legacy"),
    ...normalizeLegacyPrefixes(input.legacyPrefixes ?? []).map((legacyPrefix) =>
      createCandidate(normalizeAuditKey(`${legacyPrefix}/${bareLegacyKey}`), "legacy_prefix")
    )
  ];

  return uniqueCandidatesByKey(candidates);
}

function createCandidate(
  key: string,
  source: AssetAttachmentMetadataAuditCandidateSource
): AssetAttachmentMetadataAuditCandidate {
  return {
    key,
    keyHash: hashAssetAttachmentMetadataAuditValue(key),
    source
  };
}

function uniqueCandidatesByKey(candidates: AssetAttachmentMetadataAuditCandidate[]) {
  const seenKeys = new Set<string>();
  const uniqueCandidates: AssetAttachmentMetadataAuditCandidate[] = [];

  for (const candidate of candidates) {
    if (seenKeys.has(candidate.key)) {
      continue;
    }

    seenKeys.add(candidate.key);
    uniqueCandidates.push(candidate);
  }

  return uniqueCandidates;
}

async function auditReferencedRow(
  report: AssetAttachmentMetadataAuditReport,
  input: {
    adapter: AssetAttachmentMetadataAuditReadAdapter;
    row: AssetAttachmentMetadataAuditRow;
    legacyPrefixes: string[];
    maxItems: number;
    hasDuplicateStorageKey: boolean;
  }
) {
  const { row } = input;
  const attachmentIdHash = hashAssetAttachmentMetadataAuditValue(row.id);
  const hasPersistedStorageKey = Boolean(row.storageKey?.trim());
  const candidates = createAssetAttachmentMetadataAuditCandidates({
    adapter: input.adapter,
    row,
    legacyPrefixes: input.legacyPrefixes
  });
  const expectedSizeBytes = row.sizeBytes;
  const checksumSha256 = row.checksumSha256?.trim() || undefined;
  const checksumState = resolveChecksumState(checksumSha256);

  report.counts.referencedRowCount += 1;
  report.sizeTotals.expectedSizeBytes += expectedSizeBytes;

  if (hasPersistedStorageKey) {
    report.counts.persistedStorageKeyRowCount += 1;
  } else {
    report.counts.candidateStorageKeyRowCount += 1;
  }

  if (input.hasDuplicateStorageKey) {
    addFinding(report, input.maxItems, {
      attachmentIdHash,
      reasons: ["duplicate_storage_key"],
      keyHash: candidates[0]?.keyHash
    });
  }

  if (checksumState === "missing") {
    addFinding(report, input.maxItems, {
      attachmentIdHash,
      reasons: ["checksum_missing"],
      candidateKeyHashes: candidates.map((candidate) => candidate.keyHash)
    });
  } else if (checksumState === "invalid") {
    addFinding(report, input.maxItems, {
      attachmentIdHash,
      reasons: ["checksum_invalid_format"],
      candidateKeyHashes: candidates.map((candidate) => candidate.keyHash)
    });
  }

  const verificationResults = await verifyCandidates(input.adapter, {
    candidates,
    expectedSizeBytes,
    checksumSha256: checksumState === "valid" ? checksumSha256 : undefined
  });
  const matchedCandidates = verificationResults.filter((result) => isCandidateMatch(result));
  const readableResults = verificationResults.filter((result) => result.bytes);

  addCandidateFailureFindings(report, input.maxItems, {
    attachmentIdHash,
    row,
    results: verificationResults
  });

  if (readableResults.length > 0) {
    report.counts.readableRowCount += 1;
  }

  if (matchedCandidates.length > 1) {
    addFinding(report, input.maxItems, {
      attachmentIdHash,
      reasons: ["ambiguous_candidate_match"],
      candidateKeyHashes: matchedCandidates.map((result) => result.candidate.keyHash)
    });
    return;
  }

  if (matchedCandidates.length !== 1) {
    if (verificationResults.some((result) => result.missing) && readableResults.length === 0) {
      report.sizeTotals.missingExpectedSizeBytes += expectedSizeBytes;
      addFinding(report, input.maxItems, {
        attachmentIdHash,
        reasons: ["missing_object"],
        candidateKeyHashes: candidates.map((candidate) => candidate.keyHash)
      });
    }

    return;
  }

  const [matchedCandidate] = matchedCandidates;

  if (!hasPersistedStorageKey) {
    addFinding(report, input.maxItems, {
      attachmentIdHash,
      reasons: ["storage_key_missing", "backfill_candidate"],
      keyHash: matchedCandidate.candidate.keyHash,
      candidateKeyHashes: candidates.map((candidate) => candidate.keyHash)
    });
  }

  if (checksumState === "missing") {
    addFinding(report, input.maxItems, {
      attachmentIdHash,
      reasons: ["backfill_candidate"],
      keyHash: matchedCandidate.candidate.keyHash
    });
  }

  if (checksumState === "valid" && matchedCandidate.checksumMatched) {
    report.counts.verifiedRowCount += 1;
    report.sizeTotals.verifiedSizeBytes += expectedSizeBytes;
  }
}

async function verifyCandidates(
  adapter: AssetAttachmentMetadataAuditReadAdapter,
  input: {
    candidates: AssetAttachmentMetadataAuditCandidate[];
    expectedSizeBytes: number;
    checksumSha256?: string;
  }
) {
  const results: CandidateVerificationResult[] = [];

  for (const candidate of input.candidates) {
    if (!isSafeAssetAttachmentStorageReadKey(candidate.key)) {
      results.push(createCandidateResult(candidate, { safe: false }));
      continue;
    }

    let bytes: Uint8Array | null;

    try {
      bytes = await adapter.get({ key: candidate.key });
    } catch {
      results.push(createCandidateResult(candidate, { safe: true, readFailed: true }));
      continue;
    }

    if (!bytes) {
      results.push(createCandidateResult(candidate, { safe: true, missing: true }));
      continue;
    }

    const checksumSha256 = sha256Hex(bytes);
    const sizeMatched = bytes.byteLength === input.expectedSizeBytes;
    const checksumMatched = input.checksumSha256 ? checksumSha256 === input.checksumSha256 : true;

    results.push(
      createCandidateResult(candidate, {
        safe: true,
        bytes,
        checksumSha256,
        actualSizeBytes: bytes.byteLength,
        sizeMatched,
        checksumMatched
      })
    );
  }

  return results;
}

function createCandidateResult(
  candidate: AssetAttachmentMetadataAuditCandidate,
  input: Partial<Omit<CandidateVerificationResult, "candidate">>
): CandidateVerificationResult {
  return {
    candidate,
    safe: true,
    missing: false,
    readFailed: false,
    sizeMatched: false,
    checksumMatched: false,
    ...input
  };
}

function addCandidateFailureFindings(
  report: AssetAttachmentMetadataAuditReport,
  maxItems: number,
  input: {
    attachmentIdHash: string;
    row: AssetAttachmentMetadataAuditRow;
    results: CandidateVerificationResult[];
  }
) {
  let recordedSizeMismatch = false;

  for (const result of input.results) {
    if (!result.safe) {
      addFinding(report, maxItems, {
        attachmentIdHash: input.attachmentIdHash,
        reasons: ["unsafe_key"],
        keyHash: result.candidate.keyHash
      });
      continue;
    }

    if (result.readFailed) {
      addFinding(report, maxItems, {
        attachmentIdHash: input.attachmentIdHash,
        reasons: ["read_failed"],
        keyHash: result.candidate.keyHash
      });
      continue;
    }

    if (result.bytes && !result.sizeMatched) {
      if (!recordedSizeMismatch) {
        report.sizeTotals.mismatchedExpectedSizeBytes += input.row.sizeBytes;
        recordedSizeMismatch = true;
      }

      report.sizeTotals.mismatchedActualSizeBytes += result.actualSizeBytes ?? 0;
      addFinding(report, maxItems, {
        attachmentIdHash: input.attachmentIdHash,
        reasons: ["size_mismatch"],
        keyHash: result.candidate.keyHash
      });
      continue;
    }

    if (result.bytes && result.sizeMatched && !result.checksumMatched) {
      addFinding(report, maxItems, {
        attachmentIdHash: input.attachmentIdHash,
        reasons: ["checksum_mismatch"],
        keyHash: result.candidate.keyHash
      });
    }
  }
}

function addFinding(
  report: AssetAttachmentMetadataAuditReport,
  maxItems: number,
  item: AssetAttachmentMetadataAuditReportItem
) {
  for (const reason of item.reasons) {
    report.reasonCounts[reason] += 1;
  }

  if (report.items.length >= maxItems) {
    report.omittedItemCount += 1;
    return;
  }

  report.items.push(item);
}

function findDuplicatePersistedStorageKeys(rows: AssetAttachmentMetadataAuditRow[]) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (!isReferencedMetadataStatus(row.status)) {
      continue;
    }

    const storageKey = row.storageKey?.trim();

    if (!storageKey) {
      continue;
    }

    const normalizedKey = normalizeAuditKey(storageKey);
    counts.set(normalizedKey, (counts.get(normalizedKey) ?? 0) + 1);
  }

  return counts;
}

function hasDuplicatePersistedStorageKey(counts: ReadonlyMap<string, number>, row: AssetAttachmentMetadataAuditRow) {
  const storageKey = row.storageKey?.trim();

  if (!storageKey) {
    return false;
  }

  return (counts.get(normalizeAuditKey(storageKey)) ?? 0) > 1;
}

function isCandidateMatch(result: CandidateVerificationResult) {
  return Boolean(result.bytes && result.sizeMatched && result.checksumMatched);
}

function resolveChecksumState(checksumSha256: string | undefined): "missing" | "invalid" | "valid" {
  if (!checksumSha256) {
    return "missing";
  }

  return isValidAssetAttachmentChecksumSha256(checksumSha256) ? "valid" : "invalid";
}

function isReferencedMetadataStatus(status: string) {
  return status === "active" || status === "deleted";
}

export function isSafeAssetAttachmentStorageReadKey(key: string) {
  try {
    const normalizedKey = normalizeStorageReadKey(key);
    const segments = normalizedKey.split("/");
    const fileName = segments.at(-1);

    if (!fileName) {
      return false;
    }

    const extension = path.posix.extname(fileName);
    const fileId = fileName.slice(0, -extension.length);

    return `${assertAssetAttachmentFileId(fileId)}${assertSafeExtension(extension)}` === fileName;
  } catch {
    return false;
  }
}

function normalizeStorageReadKey(key: string) {
  const trimmed = key.trim();
  const normalized = trimmed.replace(/\\/g, "/");

  if (!trimmed || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(trimmed)) {
    throw new Error("asset_attachment_storage_key_invalid");
  }

  if (normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("asset_attachment_storage_key_invalid");
  }

  return normalized;
}

function assertAssetAttachmentFileId(fileId: string) {
  if (!/^asset-att-[a-f0-9-]{36}$/i.test(fileId)) {
    throw new Error("asset_attachment_file_id_invalid");
  }

  return fileId;
}

function assertSafeExtension(extension: string) {
  const normalized = extension.toLowerCase();

  if (!allowedAssetAttachmentFileTypes[normalized]) {
    throw new Error("asset_attachment_file_type_invalid");
  }

  return normalized;
}

function normalizeLegacyPrefixes(legacyPrefixes: string[]) {
  return legacyPrefixes
    .map((legacyPrefix) => normalizeAuditKey(legacyPrefix).replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
}

function normalizeAuditKey(key: string) {
  return key.trim().replace(/\\/g, "/");
}

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isValidAssetAttachmentChecksumSha256(checksumSha256: string) {
  return /^[a-f0-9]{64}$/.test(checksumSha256);
}

function createEmptyReport(now: Date): AssetAttachmentMetadataAuditReport {
  return {
    generatedAt: now.toISOString(),
    counts: {
      inputRowCount: 0,
      referencedRowCount: 0,
      skippedRowCount: 0,
      persistedStorageKeyRowCount: 0,
      candidateStorageKeyRowCount: 0,
      verifiedRowCount: 0,
      readableRowCount: 0
    },
    statusCounts: {},
    reasonCounts: {
      missing_object: 0,
      read_failed: 0,
      size_mismatch: 0,
      checksum_missing: 0,
      checksum_invalid_format: 0,
      checksum_mismatch: 0,
      unsafe_key: 0,
      duplicate_storage_key: 0,
      storage_key_missing: 0,
      backfill_candidate: 0,
      ambiguous_candidate_match: 0
    },
    sizeTotals: {
      expectedSizeBytes: 0,
      verifiedSizeBytes: 0,
      missingExpectedSizeBytes: 0,
      mismatchedExpectedSizeBytes: 0,
      mismatchedActualSizeBytes: 0
    },
    items: [],
    omittedItemCount: 0
  };
}
