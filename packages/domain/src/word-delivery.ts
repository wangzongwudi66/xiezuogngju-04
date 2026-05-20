export interface EpisodeRange {
  from: number;
  to: number;
}

export type WordDeliverySourceKind = "text" | "docx";

export type WordDeliveryIssueCode =
  | "docx_document_xml_missing"
  | "docx_inflate_failed"
  | "docx_zip_invalid"
  | "duplicate_episode_boundary"
  | "empty_episode_content"
  | "episode_boundary_not_found"
  | "episode_out_of_declared_range"
  | "invalid_declared_range"
  | "missing_episode_in_declared_range"
  | "preface_ignored"
  | "scene_heading_format";

export interface WordDeliveryIssue {
  code: WordDeliveryIssueCode;
  severity: "error" | "warning";
  message: string;
  remedy?: string;
  episodeNo?: number;
  line?: number;
  value?: string;
}

export interface ParsedWordEpisode {
  episodeNo: number;
  title: string;
  content: string;
  warnings: WordDeliveryIssue[];
}

export interface WordDeliveryParseOptions {
  declaredRange?: string | EpisodeRange;
  fileName?: string;
}

export interface WordDeliveryParseSuccess {
  ok: true;
  source: WordDeliverySourceKind;
  declaredRange?: EpisodeRange;
  episodes: ParsedWordEpisode[];
  warnings: WordDeliveryIssue[];
  errors: [];
}

export interface WordDeliveryParseFailure {
  ok: false;
  source: WordDeliverySourceKind;
  declaredRange?: EpisodeRange;
  episodes: [];
  warnings: WordDeliveryIssue[];
  errors: WordDeliveryIssue[];
  remedies: string[];
}

export type WordDeliveryParseResult = WordDeliveryParseSuccess | WordDeliveryParseFailure;

interface EpisodeDraft {
  episodeNo: number;
  title: string;
  boundaryLine: number;
  contentLines: Array<{ line: number; text: string }>;
  warnings: WordDeliveryIssue[];
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

const episodeBoundaryPattern = /第\s*(\d+)\s*集/;
const sceneHeadingPattern = /^场\s*\d+\s*-\s*\d+\s+.+?\s+(日|夜|晨|午|白天|晚上|傍晚|黄昏|清晨|黎明|凌晨)\s+(内|外|内外)\s*$/;

export async function parseWordDelivery(
  source: string | ArrayBuffer | Uint8Array | Blob,
  options: WordDeliveryParseOptions = {}
): Promise<WordDeliveryParseResult> {
  if (typeof source === "string") {
    return parseWordDeliveryText(source, options);
  }

  return parseWordDeliveryDocx(source, options);
}

export function parseWordDeliveryText(
  text: string,
  options: WordDeliveryParseOptions = {}
): WordDeliveryParseResult {
  const { range, warning } = resolveDeclaredRange(options.declaredRange);
  const warnings: WordDeliveryIssue[] = warning ? [warning] : [];
  const lines = normalizeText(text).split("\n");
  const drafts: EpisodeDraft[] = [];
  let current: EpisodeDraft | null = null;
  let prefaceLine: number | undefined;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const boundaryMatch = line.match(episodeBoundaryPattern);

    if (boundaryMatch) {
      if (current) {
        drafts.push(current);
      }

      current = {
        episodeNo: Number(boundaryMatch[1]),
        title: parseEpisodeTitle(line, boundaryMatch),
        boundaryLine: lineNo,
        contentLines: [],
        warnings: []
      };
      return;
    }

    if (current) {
      current.contentLines.push({ line: lineNo, text: line });
      return;
    }

    if (line.trim() && prefaceLine === undefined) {
      prefaceLine = lineNo;
    }
  });

  if (current) {
    drafts.push(current);
  }

  if (prefaceLine !== undefined) {
    warnings.push({
      code: "preface_ignored",
      severity: "warning",
      line: prefaceLine,
      message: "集边界前存在正文，已作为前置信息忽略。",
      remedy: "如需导入，请把这部分内容移动到某一集的“第 N 集”标题之后。"
    });
  }

  if (drafts.length === 0) {
    return {
      ok: false,
      source: "text",
      declaredRange: range,
      episodes: [],
      warnings,
      errors: [
        {
          code: "episode_boundary_not_found",
          severity: "error",
          message: "未找到符合“第\\s*(\\d+)\\s*集”的集边界，无法按集切段。",
          remedy: "请把每集标题改成“第 1 集”“第 2 集”这类格式后重试。"
        }
      ],
      remedies: [
        "确认 Word 正文里有“第 1 集”这类标题。",
        "如果标题在表格或图片里，请先转成可复制文本。",
        "可以先粘贴纯文本预览，让 UI 显示识别到的边界。"
      ]
    };
  }

  applyDuplicateWarnings(drafts);
  const episodes = drafts.map((draft) => finalizeEpisode(draft, range));
  warnings.push(...buildRangeWarnings(episodes, range));

  return {
    ok: true,
    source: "text",
    declaredRange: range,
    episodes,
    warnings,
    errors: []
  };
}

export async function parseWordDeliveryDocx(
  source: ArrayBuffer | Uint8Array | Blob,
  options: WordDeliveryParseOptions = {}
): Promise<WordDeliveryParseResult> {
  const { range, warning } = resolveDeclaredRange(options.declaredRange);

  try {
    const bytes = await toUint8Array(source);
    const documentXml = await extractDocumentXml(bytes);
    const text = extractTextFromDocumentXml(documentXml);
    const parsed = parseWordDeliveryText(text, options);

    return {
      ...parsed,
      source: "docx"
    } as WordDeliveryParseResult;
  } catch (error) {
    const issue = toDocxIssue(error);
    return {
      ok: false,
      source: "docx",
      declaredRange: range,
      episodes: [],
      warnings: warning ? [warning] : [],
      errors: [issue],
      remedies: [
        "确认上传的是 .docx 文件，而不是旧版 .doc 或 PDF。",
        "如果文档受保护或内容在图片里，请先另存为普通 .docx 或粘贴纯文本。",
        "UI 可保留文件并允许用户改用纯文本导入。"
      ]
    };
  }
}

export function parseDeclaredEpisodeRange(value?: string | EpisodeRange): EpisodeRange | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value !== "string") {
    return isValidRange(value.from, value.to) ? { from: value.from, to: value.to } : undefined;
  }

  const match = value.trim().match(/^第?\s*(\d+)\s*(?:-|~|至|到)\s*(\d+)\s*集?$/);
  if (!match) {
    return undefined;
  }

  const from = Number(match[1]);
  const to = Number(match[2]);
  return isValidRange(from, to) ? { from, to } : undefined;
}

function resolveDeclaredRange(value?: string | EpisodeRange) {
  const range = parseDeclaredEpisodeRange(value);

  if (!value || range) {
    return { range };
  }

  return {
    range,
    warning: {
      code: "invalid_declared_range",
      severity: "warning",
      value: typeof value === "string" ? value : `${value.from}-${value.to}`,
      message: "声明范围格式无法识别，已继续解析正文。",
      remedy: "请使用 1-10 或 1-20 这类范围格式。"
    } satisfies WordDeliveryIssue
  };
}

function normalizeText(text: string) {
  return text.replace(/\r\n?/g, "\n");
}

function parseEpisodeTitle(line: string, match: RegExpMatchArray) {
  const boundaryEnd = (match.index ?? 0) + match[0].length;
  const suffix = line.slice(boundaryEnd).replace(/^[\s:：\-—、.]+/, "").trim();
  return suffix || line.trim();
}

function finalizeEpisode(draft: EpisodeDraft, range?: EpisodeRange): ParsedWordEpisode {
  const content = draft.contentLines.map((line) => line.text).join("\n").trim();
  const warnings = [...draft.warnings];

  if (!content) {
    warnings.push({
      code: "empty_episode_content",
      severity: "warning",
      episodeNo: draft.episodeNo,
      line: draft.boundaryLine,
      message: `第 ${draft.episodeNo} 集没有可导入正文。`,
      remedy: "请检查该集标题后是否有正文，或是否被下一集标题提前截断。"
    });
  }

  if (range && (draft.episodeNo < range.from || draft.episodeNo > range.to)) {
    warnings.push({
      code: "episode_out_of_declared_range",
      severity: "warning",
      episodeNo: draft.episodeNo,
      line: draft.boundaryLine,
      message: `第 ${draft.episodeNo} 集不在声明范围 ${range.from}-${range.to} 内。`,
      remedy: "确认声明范围是否填错，或把这集拆到正确批次。"
    });
  }

  draft.contentLines.forEach((line) => {
    const trimmed = line.text.trim();
    if (trimmed.startsWith("场") && !sceneHeadingPattern.test(trimmed)) {
      warnings.push({
        code: "scene_heading_format",
        severity: "warning",
        episodeNo: draft.episodeNo,
        line: line.line,
        value: trimmed,
        message: "场标题格式可能不规范，P0 仅提示不阻断导入。",
        remedy: "建议使用“场 1-1 金城矿山 日 外”这类格式。"
      });
    }
  });

  return {
    episodeNo: draft.episodeNo,
    title: draft.title,
    content,
    warnings
  };
}

function applyDuplicateWarnings(drafts: EpisodeDraft[]) {
  const counts = new Map<number, number>();
  drafts.forEach((draft) => counts.set(draft.episodeNo, (counts.get(draft.episodeNo) ?? 0) + 1));

  drafts.forEach((draft) => {
    if ((counts.get(draft.episodeNo) ?? 0) > 1) {
      draft.warnings.push({
        code: "duplicate_episode_boundary",
        severity: "warning",
        episodeNo: draft.episodeNo,
        line: draft.boundaryLine,
        message: `第 ${draft.episodeNo} 集出现了多个边界。`,
        remedy: "请确认是否重复粘贴，或把重复标题改成正确集数。"
      });
    }
  });
}

function buildRangeWarnings(episodes: ParsedWordEpisode[], range?: EpisodeRange): WordDeliveryIssue[] {
  if (!range) {
    return [];
  }

  const found = new Set(episodes.map((episode) => episode.episodeNo));
  const missing: number[] = [];

  for (let episodeNo = range.from; episodeNo <= range.to; episodeNo += 1) {
    if (!found.has(episodeNo)) {
      missing.push(episodeNo);
    }
  }

  if (missing.length === 0) {
    return [];
  }

  return [
    {
      code: "missing_episode_in_declared_range",
      severity: "warning",
      value: missing.join(","),
      message: `声明范围 ${range.from}-${range.to} 中缺少 ${missing.join(", ")} 集。`,
      remedy: "请确认 Word 是否漏集，或调整本次导入的声明范围。"
    }
  ];
}

function isValidRange(from: number, to: number) {
  return Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from;
}

async function toUint8Array(source: ArrayBuffer | Uint8Array | Blob): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    return source;
  }

  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }

  return new Uint8Array(await source.arrayBuffer());
}

async function extractDocumentXml(bytes: Uint8Array) {
  const entries = readZipEntries(bytes);
  const documentEntry = entries.find((entry) => entry.name === "word/document.xml");

  if (!documentEntry) {
    throw new Error("docx_document_xml_missing");
  }

  const payload = getZipEntryPayload(bytes, documentEntry);

  if (documentEntry.method === 0) {
    return new TextDecoder().decode(payload);
  }

  if (documentEntry.method !== 8) {
    throw new Error("docx_inflate_failed");
  }

  try {
    const inflated = await inflateRaw(payload);
    return new TextDecoder().decode(inflated);
  } catch {
    throw new Error("docx_inflate_failed");
  }
}

function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) {
    throw new Error("docx_zip_invalid");
  }

  const view = dataView(bytes);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("docx_zip_invalid");
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));

    entries.push({ name, method, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function getZipEntryPayload(bytes: Uint8Array, entry: ZipEntry) {
  const view = dataView(bytes);
  const offset = entry.localHeaderOffset;

  if (view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error("docx_zip_invalid");
  }

  const fileNameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const payloadStart = offset + 30 + fileNameLength + extraLength;
  return bytes.slice(payloadStart, payloadStart + entry.compressedSize);
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);
  const view = dataView(bytes);

  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }

  return -1;
}

async function inflateRaw(bytes: Uint8Array) {
  const payload = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(payload).set(bytes);
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function extractTextFromDocumentXml(xml: string) {
  const paragraphs = Array.from(xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)).map((paragraph) =>
    extractParagraphText(paragraph[0])
  );

  if (paragraphs.length > 0) {
    return paragraphs.join("\n");
  }

  return decodeXmlEntities(xml.replace(/<[^>]+>/g, " "));
}

function extractParagraphText(paragraphXml: string) {
  const pieces = Array.from(
    paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g)
  );

  return pieces
    .map((piece) => {
      if (piece[0].startsWith("<w:tab")) {
        return "\t";
      }

      if (piece[0].startsWith("<w:br")) {
        return "\n";
      }

      return decodeXmlEntities(piece[1] ?? "");
    })
    .join("");
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function toDocxIssue(error: unknown): WordDeliveryIssue {
  const message = error instanceof Error ? error.message : "";

  if (message === "docx_document_xml_missing") {
    return {
      code: "docx_document_xml_missing",
      severity: "error",
      message: "DOCX 中缺少 word/document.xml，无法读取正文。",
      remedy: "请确认文件是有效的 Word .docx，或让用户另存为新的 .docx 后重试。"
    };
  }

  if (message === "docx_inflate_failed") {
    return {
      code: "docx_inflate_failed",
      severity: "error",
      message: "DOCX 正文解压失败。",
      remedy: "请尝试另存为未加密的 .docx，或改用纯文本导入。"
    };
  }

  return {
    code: "docx_zip_invalid",
    severity: "error",
    message: "文件不是可识别的 .docx 压缩包。",
    remedy: "请上传 .docx 文件；旧版 .doc、PDF 或图片文档需要先转换。"
  };
}

function dataView(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
