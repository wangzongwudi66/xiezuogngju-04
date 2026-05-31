import { createHash } from "node:crypto";
import {
  createAssetAttachmentMetadataAuditCandidates,
  hashAssetAttachmentMetadataAuditValue,
  isSafeAssetAttachmentStorageReadKey,
  isValidAssetAttachmentChecksumSha256,
  type AssetAttachmentMetadataAuditCandidate,
  type AssetAttachmentMetadataAuditReadAdapter,
  type AssetAttachmentMetadataAuditRow
} from "./metadata-audit";

const defaultMaxReportItems = 1000;

export type AssetAttachmentStorageBackfillSkipReason =
  | "ambiguous_candidate_match"
  | "missing_object"
  | "read_failed"
  | "size_mismatch"
  | "checksum_mismatch"
  | "checksum_invalid_format"
  | "unsafe_key"
  | "duplicate_storage_key"
  | "duplicate_target_key";

export interface AssetAttachmentStorageBackfillWrite {
  row: AssetAttachmentMetadataAuditRow;
  targetStorageKey: string;
  targetChecksumSha256: string;
}

export interface AssetAttachmentStorageBackfillReportItem {
  attachmentIdHash: string;
  reasons: AssetAttachmentStorageBackfillSkipReason[];
  keyHash?: string;
  candidateKeyHashes?: string[];
}

export interface AssetAttachmentStorageBackfillPlan {
  generatedAt: string;
  counts: {
    inputRowCount: number;
    referencedRowCount: number;
    incompleteMetadataRowCount: number;
    writableRowCount: number;
    skippedRowCount: number;
    storageKeyWriteCount: number;
    checksumWriteCount: number;
  };
  reasonCounts: Record<AssetAttachmentStorageBackfillSkipReason, number>;
  items: AssetAttachmentStorageBackfillReportItem[];
  omittedItemCount: number;
  writes: AssetAttachmentStorageBackfillWrite[];
}

interface CandidateVerificationResult {
  candidate: AssetAttachmentMetadataAuditCandidate;
  checksumSha256?: string;
  actualSizeBytes?: number;
  safe: boolean;
  missing: boolean;
  readFailed: boolean;
  sizeMatched: boolean;
  checksumMatched: boolean;
}

export async function buildAssetAttachmentStorageBackfillPlan(input: {
  adapter: AssetAttachmentMetadataAuditReadAdapter;
  rows: AssetAttachmentMetadataAuditRow[];
  legacyPrefixes?: string[];
  maxItems?: number;
  now?: Date;
}): Promise<AssetAttachmentStorageBackfillPlan> {
  const plan = createEmptyPlan(input.now ?? new Date());
  const maxItems = input.maxItems ?? defaultMaxReportItems;
  const persistedStorageKeys = mapPersistedStorageKeyOwners(input.rows);
  const provisionalWrites: AssetAttachmentStorageBackfillWrite[] = [];

  for (const row of input.rows) {
    plan.counts.inputRowCount += 1;

    if (!isReferencedMetadataStatus(row.status)) {
      continue;
    }

    plan.counts.referencedRowCount += 1;

    if (!needsStorageMetadataBackfill(row)) {
      continue;
    }

    plan.counts.incompleteMetadataRowCount += 1;

    const evaluated = await evaluateBackfillRow({
      adapter: input.adapter,
      row,
      legacyPrefixes: input.legacyPrefixes ?? [],
      persistedStorageKeys
    });

    if (evaluated.write) {
      provisionalWrites.push(evaluated.write);
      continue;
    }

    addFinding(plan, maxItems, evaluated.item);
  }

  for (const write of rejectDuplicateTargetKeys(provisionalWrites, plan, maxItems)) {
    plan.writes.push(write);
    plan.counts.writableRowCount += 1;

    if (write.row.storageKey == null) {
      plan.counts.storageKeyWriteCount += 1;
    }

    if (write.row.checksumSha256 == null) {
      plan.counts.checksumWriteCount += 1;
    }
  }

  return plan;
}

async function evaluateBackfillRow(input: {
  adapter: AssetAttachmentMetadataAuditReadAdapter;
  row: AssetAttachmentMetadataAuditRow;
  legacyPrefixes: string[];
  persistedStorageKeys: ReadonlyMap<string, ReadonlySet<string>>;
}): Promise<
  | { write: AssetAttachmentStorageBackfillWrite; item?: never }
  | { write?: never; item: AssetAttachmentStorageBackfillReportItem }
> {
  const candidates = createAssetAttachmentMetadataAuditCandidates({
    adapter: input.adapter,
    row: input.row,
    legacyPrefixes: input.legacyPrefixes
  });
  const attachmentIdHash = hashAssetAttachmentMetadataAuditValue(input.row.id);
  const candidateKeyHashes = candidates.map((candidate) => candidate.keyHash);
  const existingChecksum = input.row.checksumSha256?.trim() || undefined;

  if (existingChecksum && !isValidAssetAttachmentChecksumSha256(existingChecksum)) {
    return {
      item: {
        attachmentIdHash,
        reasons: ["checksum_invalid_format"],
        candidateKeyHashes
      }
    };
  }

  const results = await verifyBackfillCandidates(input.adapter, {
    candidates,
    expectedSizeBytes: input.row.sizeBytes,
    checksumSha256: existingChecksum
  });
  const firstFailureReason = resolveFirstFailureReason(results);

  if (firstFailureReason) {
    return {
      item: {
        attachmentIdHash,
        reasons: [firstFailureReason],
        candidateKeyHashes
      }
    };
  }

  const verifiedResults = results.filter((result) => result.checksumSha256 && result.sizeMatched && result.checksumMatched);

  if (verifiedResults.length > 1) {
    return {
      item: {
        attachmentIdHash,
        reasons: ["ambiguous_candidate_match"],
        candidateKeyHashes: verifiedResults.map((result) => result.candidate.keyHash)
      }
    };
  }

  if (verifiedResults.length !== 1) {
    return {
      item: {
        attachmentIdHash,
        reasons: ["missing_object"],
        candidateKeyHashes
      }
    };
  }

  const [verified] = verifiedResults;
  const targetStorageKey = verified.candidate.key;
  const targetChecksumSha256 = verified.checksumSha256;

  if (!targetChecksumSha256 || !isValidAssetAttachmentChecksumSha256(targetChecksumSha256)) {
    return {
      item: {
        attachmentIdHash,
        reasons: ["checksum_invalid_format"],
        keyHash: verified.candidate.keyHash
      }
    };
  }

  if (!isSafeAssetAttachmentStorageReadKey(targetStorageKey)) {
    return {
      item: {
        attachmentIdHash,
        reasons: ["unsafe_key"],
        keyHash: verified.candidate.keyHash
      }
    };
  }

  const duplicatePersistedOwners = input.persistedStorageKeys.get(normalizeStorageBackfillKey(targetStorageKey));

  if (duplicatePersistedOwners && (duplicatePersistedOwners.size > 1 || !duplicatePersistedOwners.has(input.row.id))) {
    return {
      item: {
        attachmentIdHash,
        reasons: ["duplicate_storage_key"],
        keyHash: verified.candidate.keyHash
      }
    };
  }

  return {
    write: {
      row: input.row,
      targetStorageKey,
      targetChecksumSha256
    }
  };
}

async function verifyBackfillCandidates(
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
      results.push(createCandidateResult(candidate, { readFailed: true }));
      continue;
    }

    if (!bytes) {
      results.push(createCandidateResult(candidate, { missing: true }));
      continue;
    }

    const checksumSha256 = sha256Hex(bytes);
    const sizeMatched = bytes.byteLength === input.expectedSizeBytes;
    const checksumMatched = input.checksumSha256 ? checksumSha256 === input.checksumSha256 : true;

    results.push(
      createCandidateResult(candidate, {
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

function resolveFirstFailureReason(
  results: CandidateVerificationResult[]
): AssetAttachmentStorageBackfillSkipReason | undefined {
  if (results.some((result) => !result.safe)) {
    return "unsafe_key";
  }

  if (results.some((result) => result.readFailed)) {
    return "read_failed";
  }

  if (results.some((result) => result.actualSizeBytes !== undefined && !result.sizeMatched)) {
    return "size_mismatch";
  }

  if (results.some((result) => result.actualSizeBytes !== undefined && result.sizeMatched && !result.checksumMatched)) {
    return "checksum_mismatch";
  }

  return undefined;
}

function rejectDuplicateTargetKeys(
  writes: AssetAttachmentStorageBackfillWrite[],
  plan: AssetAttachmentStorageBackfillPlan,
  maxItems: number
) {
  const targetKeyCounts = new Map<string, number>();

  for (const write of writes) {
    const normalizedKey = normalizeStorageBackfillKey(write.targetStorageKey);
    targetKeyCounts.set(normalizedKey, (targetKeyCounts.get(normalizedKey) ?? 0) + 1);
  }

  return writes.filter((write) => {
    if ((targetKeyCounts.get(normalizeStorageBackfillKey(write.targetStorageKey)) ?? 0) === 1) {
      return true;
    }

    addFinding(plan, maxItems, {
      attachmentIdHash: hashAssetAttachmentMetadataAuditValue(write.row.id),
      reasons: ["duplicate_target_key"],
      keyHash: hashAssetAttachmentMetadataAuditValue(write.targetStorageKey)
    });
    return false;
  });
}

function addFinding(
  plan: AssetAttachmentStorageBackfillPlan,
  maxItems: number,
  item: AssetAttachmentStorageBackfillReportItem
) {
  plan.counts.skippedRowCount += 1;

  for (const reason of item.reasons) {
    plan.reasonCounts[reason] += 1;
  }

  if (plan.items.length >= maxItems) {
    plan.omittedItemCount += 1;
    return;
  }

  plan.items.push(item);
}

function mapPersistedStorageKeyOwners(rows: AssetAttachmentMetadataAuditRow[]) {
  const owners = new Map<string, Set<string>>();

  for (const row of rows) {
    if (!isReferencedMetadataStatus(row.status)) {
      continue;
    }

    const storageKey = row.storageKey?.trim();

    if (!storageKey) {
      continue;
    }

    const normalizedKey = normalizeStorageBackfillKey(storageKey);
    const existing = owners.get(normalizedKey) ?? new Set<string>();
    existing.add(row.id);
    owners.set(normalizedKey, existing);
  }

  return owners;
}

function needsStorageMetadataBackfill(row: AssetAttachmentMetadataAuditRow) {
  return row.storageKey == null || row.checksumSha256 == null;
}

function isReferencedMetadataStatus(status: string) {
  return status === "active" || status === "deleted";
}

function normalizeStorageBackfillKey(key: string) {
  return key.trim().replace(/\\/g, "/");
}

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function createEmptyPlan(now: Date): AssetAttachmentStorageBackfillPlan {
  return {
    generatedAt: now.toISOString(),
    counts: {
      inputRowCount: 0,
      referencedRowCount: 0,
      incompleteMetadataRowCount: 0,
      writableRowCount: 0,
      skippedRowCount: 0,
      storageKeyWriteCount: 0,
      checksumWriteCount: 0
    },
    reasonCounts: {
      ambiguous_candidate_match: 0,
      missing_object: 0,
      read_failed: 0,
      size_mismatch: 0,
      checksum_mismatch: 0,
      checksum_invalid_format: 0,
      unsafe_key: 0,
      duplicate_storage_key: 0,
      duplicate_target_key: 0
    },
    items: [],
    omittedItemCount: 0,
    writes: []
  };
}
