import {
  parseDeclaredEpisodeRange,
  parseWordDeliveryText
} from "@aigc/domain";
import type {
  DeliveryPackageDraftInput,
  DeliveryPackageType,
  EpisodeRange,
  WordDeliveryParseResult,
  WordDeliveryIssue
} from "@aigc/domain";

export interface TextDeliveryDraftBuildInput {
  projectId: string;
  uploadedByUserId: string;
  rawText: string;
  declaredRangeText: string;
  sourceFileName?: string;
}

export interface ParsedDeliveryDraftBuildInput {
  projectId: string;
  uploadedByUserId: string;
  sourceFileName: string;
  parsed: Extract<WordDeliveryParseResult, { ok: true }>;
}

export type TextDeliveryDraftBuildResult =
  | {
      ok: true;
      draft: DeliveryPackageDraftInput;
      issues: WordDeliveryIssue[];
      requestedRange?: EpisodeRange;
    }
  | {
      ok: false;
      issues: WordDeliveryIssue[];
      remedies: string[];
      requestedRange?: EpisodeRange;
    };

export function buildTextDeliveryPackageDraft(input: TextDeliveryDraftBuildInput): TextDeliveryDraftBuildResult {
  const declaredRangeText = input.declaredRangeText.trim();
  const requestedRange = parseDeclaredEpisodeRange(declaredRangeText);
  const parsed = parseWordDeliveryText(input.rawText, {
    declaredRange: declaredRangeText || undefined
  });

  if (!parsed.ok) {
    return {
      ok: false,
      issues: [...parsed.warnings, ...parsed.errors],
      remedies: parsed.remedies,
      requestedRange
    };
  }

  return buildDeliveryPackageDraftFromParsed({
    projectId: input.projectId,
    uploadedByUserId: input.uploadedByUserId,
    sourceFileName: input.sourceFileName ?? "pasted-word-text.txt",
    parsed
  });
}

export function buildDeliveryPackageDraftFromParsed(input: ParsedDeliveryDraftBuildInput): Extract<TextDeliveryDraftBuildResult, { ok: true }> {
  const { parsed } = input;
  const episodeNos = parsed.episodes.map((episode) => episode.episodeNo);
  const actualFrom = Math.min(...episodeNos);
  const actualTo = Math.max(...episodeNos);
  const declaredRange = parsed.declaredRange;
  const declaredRangeCoversContent =
    declaredRange !== undefined && actualFrom >= declaredRange.from && actualTo <= declaredRange.to;
  const effectiveRange = declaredRangeCoversContent ? declaredRange : { from: actualFrom, to: actualTo };
  const type: DeliveryPackageType = effectiveRange.from === effectiveRange.to ? "single_replace" : "range";
  const sourceLabel = parsed.source === "docx" ? "Word 解析" : "文本解析";
  const issues = collectTextParseIssues(parsed);

  return {
    ok: true,
    requestedRange: declaredRange,
    issues,
    draft: {
      projectId: input.projectId,
      uploadedByUserId: input.uploadedByUserId,
      type,
      declaredEpisodeFrom: effectiveRange.from,
      declaredEpisodeTo: effectiveRange.to,
      sourceFileName: input.sourceFileName,
      title:
        type === "single_replace"
          ? `${sourceLabel}：第 ${effectiveRange.from} 集单集替换`
          : `${sourceLabel}：第 ${effectiveRange.from}-${effectiveRange.to} 集交稿`,
      episodes: parsed.episodes.map((episode) => ({
        episodeNo: episode.episodeNo,
        title: episode.title,
        content: episode.content
      })),
      confirmedEpisodeNos: episodeNos
    }
  };
}

function collectTextParseIssues(parsed: Extract<WordDeliveryParseResult, { ok: true }>) {
  return [
    ...parsed.warnings,
    ...parsed.episodes.flatMap((episode) => episode.warnings)
  ];
}
