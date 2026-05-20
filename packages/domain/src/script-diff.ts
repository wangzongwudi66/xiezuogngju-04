export type ScriptDiffGranularity = "paragraph" | "line";

export interface ScriptDiffBlock {
  id: string;
  granularity: ScriptDiffGranularity;
  oldIndex: number | null;
  newIndex: number | null;
  text: string;
}

export interface ScriptDiffChangedBlock {
  id: string;
  granularity: ScriptDiffGranularity;
  oldIndex: number;
  newIndex: number;
  oldText: string;
  newText: string;
}

export interface ScriptDiffSummary {
  hasChanges: boolean;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  totalChanges: number;
  headline: string;
  details: string[];
}

export interface ScriptDiffResult {
  added: ScriptDiffBlock[];
  removed: ScriptDiffBlock[];
  changed: ScriptDiffChangedBlock[];
  summary: ScriptDiffSummary;
}

interface ScriptUnit {
  index: number;
  text: string;
  comparableText: string;
}

interface LcsMatch {
  oldIndex: number;
  newIndex: number;
}

export function diffEpisodeScript(oldContent: string, newContent: string): ScriptDiffResult {
  const granularity = chooseGranularity(oldContent, newContent);
  const oldUnits = splitScript(oldContent, granularity);
  const newUnits = splitScript(newContent, granularity);
  const matches = findLcsMatches(oldUnits, newUnits);

  const added: ScriptDiffBlock[] = [];
  const removed: ScriptDiffBlock[] = [];
  const changed: ScriptDiffChangedBlock[] = [];

  let oldCursor = 0;
  let newCursor = 0;

  for (const match of [...matches, { oldIndex: oldUnits.length, newIndex: newUnits.length }]) {
    const oldGap = oldUnits.slice(oldCursor, match.oldIndex);
    const newGap = newUnits.slice(newCursor, match.newIndex);

    const gapChanges = pairChangedUnits(oldGap, newGap);

    for (const item of gapChanges.changed) {
      changed.push({
        id: `changed-${item.oldUnit.index}-${item.newUnit.index}`,
        granularity,
        oldIndex: item.oldUnit.index,
        newIndex: item.newUnit.index,
        oldText: item.oldUnit.text,
        newText: item.newUnit.text
      });
    }

    for (const oldUnit of gapChanges.removed) {
      removed.push({
        id: `removed-${oldUnit.index}`,
        granularity,
        oldIndex: oldUnit.index,
        newIndex: null,
        text: oldUnit.text
      });
    }

    for (const newUnit of gapChanges.added) {
      added.push({
        id: `added-${newUnit.index}`,
        granularity,
        oldIndex: null,
        newIndex: newUnit.index,
        text: newUnit.text
      });
    }

    oldCursor = match.oldIndex + 1;
    newCursor = match.newIndex + 1;
  }

  return {
    added,
    removed,
    changed,
    summary: summarizeScriptDiff({ added, removed, changed }, granularity)
  };
}

function chooseGranularity(oldContent: string, newContent: string): ScriptDiffGranularity {
  return hasParagraphBreak(oldContent) || hasParagraphBreak(newContent) ? "paragraph" : "line";
}

function hasParagraphBreak(content: string) {
  return /\n\s*\n/.test(normalizeNewlines(content));
}

function splitScript(content: string, granularity: ScriptDiffGranularity): ScriptUnit[] {
  const normalizedContent = normalizeNewlines(content).trim();

  if (!normalizedContent) {
    return [];
  }

  const parts =
    granularity === "paragraph"
      ? normalizedContent.split(/\n\s*\n+/)
      : normalizedContent.split("\n");

  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((text, index) => ({
      index: index + 1,
      text,
      comparableText: normalizeComparableText(text)
    }));
}

function findLcsMatches(oldUnits: ScriptUnit[], newUnits: ScriptUnit[]): LcsMatch[] {
  const dp: number[][] = Array.from({ length: oldUnits.length + 1 }, () => Array(newUnits.length + 1).fill(0));

  for (let oldIndex = oldUnits.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newUnits.length - 1; newIndex >= 0; newIndex -= 1) {
      if (oldUnits[oldIndex].comparableText === newUnits[newIndex].comparableText) {
        dp[oldIndex][newIndex] = dp[oldIndex + 1][newIndex + 1] + 1;
      } else {
        dp[oldIndex][newIndex] = Math.max(dp[oldIndex + 1][newIndex], dp[oldIndex][newIndex + 1]);
      }
    }
  }

  const matches: LcsMatch[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldUnits.length && newIndex < newUnits.length) {
    if (oldUnits[oldIndex].comparableText === newUnits[newIndex].comparableText) {
      matches.push({ oldIndex, newIndex });
      oldIndex += 1;
      newIndex += 1;
    } else if (dp[oldIndex + 1][newIndex] >= dp[oldIndex][newIndex + 1]) {
      oldIndex += 1;
    } else {
      newIndex += 1;
    }
  }

  return matches;
}

function pairChangedUnits(oldGap: ScriptUnit[], newGap: ScriptUnit[]) {
  if (oldGap.length === 0 || newGap.length === 0) {
    return {
      changed: [],
      removed: oldGap,
      added: newGap
    };
  }

  if (oldGap.length === newGap.length) {
    return {
      changed: oldGap.map((oldUnit, index) => ({ oldUnit, newUnit: newGap[index] })),
      removed: [],
      added: []
    };
  }

  const oldRemaining = [...oldGap];
  const newRemaining = [...newGap];
  const changed: Array<{ oldUnit: ScriptUnit; newUnit: ScriptUnit }> = [];

  while (oldRemaining.length > 0 && newRemaining.length > 0) {
    const best = findBestChangedPair(oldRemaining, newRemaining);

    if (!best || best.score < 0.35) {
      break;
    }

    changed.push({
      oldUnit: oldRemaining[best.oldOffset],
      newUnit: newRemaining[best.newOffset]
    });
    oldRemaining.splice(best.oldOffset, 1);
    newRemaining.splice(best.newOffset, 1);
  }

  return {
    changed: changed.sort((a, b) => a.oldUnit.index - b.oldUnit.index || a.newUnit.index - b.newUnit.index),
    removed: oldRemaining,
    added: newRemaining
  };
}

function findBestChangedPair(oldUnits: ScriptUnit[], newUnits: ScriptUnit[]) {
  let best: { oldOffset: number; newOffset: number; score: number } | null = null;

  for (let oldOffset = 0; oldOffset < oldUnits.length; oldOffset += 1) {
    for (let newOffset = 0; newOffset < newUnits.length; newOffset += 1) {
      const score = similarityScore(oldUnits[oldOffset].comparableText, newUnits[newOffset].comparableText);

      if (!best || score > best.score) {
        best = { oldOffset, newOffset, score };
      }
    }
  }

  return best;
}

function similarityScore(a: string, b: string) {
  const aTokens = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));

  if (aTokens.size === 0 && bTokens.size === 0) {
    return 1;
  }

  const intersectionSize = Array.from(aTokens).filter((token) => bTokens.has(token)).length;
  return (2 * intersectionSize) / (aTokens.size + bTokens.size);
}

function summarizeScriptDiff(
  diff: Pick<ScriptDiffResult, "added" | "removed" | "changed">,
  granularity: ScriptDiffGranularity
): ScriptDiffSummary {
  const totalChanges = diff.added.length + diff.removed.length + diff.changed.length;
  const unitName = granularity === "paragraph" ? "段" : "行";

  if (totalChanges === 0) {
    return {
      hasChanges: false,
      addedCount: 0,
      removedCount: 0,
      changedCount: 0,
      totalChanges: 0,
      headline: "本集暂无新改动",
      details: ["剧本文本与上一版一致。"]
    };
  }

  const details = [
    ...diff.changed.map(
      (item) => `修改第 ${item.oldIndex} ${unitName}：${preview(item.oldText)} -> ${preview(item.newText)}`
    ),
    ...diff.added.map((item) => `新增第 ${item.newIndex} ${unitName}：${preview(item.text)}`),
    ...diff.removed.map((item) => `删除第 ${item.oldIndex} ${unitName}：${preview(item.text)}`)
  ];

  return {
    hasChanges: true,
    addedCount: diff.added.length,
    removedCount: diff.removed.length,
    changedCount: diff.changed.length,
    totalChanges,
    headline: `本集有新改动：新增 ${diff.added.length} ${unitName}，删除 ${diff.removed.length} ${unitName}，修改 ${diff.changed.length} ${unitName}。`,
    details
  };
}

function normalizeNewlines(content: string) {
  return content.replace(/\r\n?/g, "\n");
}

function normalizeComparableText(content: string) {
  return content.replace(/\s+/g, " ").trim();
}

function preview(content: string) {
  const compact = normalizeComparableText(content);
  return compact.length > 42 ? `${compact.slice(0, 42)}...` : compact;
}
