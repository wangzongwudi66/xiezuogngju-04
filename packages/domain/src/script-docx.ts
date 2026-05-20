import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { Buffer } from "node:buffer";

export const EPISODE_SCRIPT_DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface EpisodeScriptRevisionSourceInfo {
  deliveryPackageName?: string;
  deliveryPackageId?: string;
  version?: string;
  submittedBy?: string;
  submittedAt?: string | Date;
  note?: string;
}

export type EpisodeScriptRevisionSource = string | EpisodeScriptRevisionSourceInfo;

export interface EpisodeScriptDocxInput {
  projectName: string;
  episodeNumber: number | string;
  scriptTitle: string;
  body: string;
  revisionSource: EpisodeScriptRevisionSource;
}

export interface EpisodeScriptDocxFile {
  fileName: string;
  contentType: typeof EPISODE_SCRIPT_DOCX_CONTENT_TYPE;
  buffer: Buffer;
}

const NORMAL_FONT = "Microsoft YaHei";

export function buildEpisodeScriptDocxFileName(input: EpisodeScriptDocxInput): string {
  const episodeLabel = formatEpisodeNumber(input.episodeNumber);
  const name = `${input.projectName}-${episodeLabel}-${input.scriptTitle}`
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);

  return `${name || "episode-script"}.docx`;
}

export function buildEpisodeScriptDocxDocument(input: EpisodeScriptDocxInput): Document {
  assertDocxInput(input);

  const episodeLabel = formatEpisodeNumber(input.episodeNumber);
  const title = `${input.projectName} ${episodeLabel} 剧本`;
  const sourceLines = formatRevisionSource(input.revisionSource);

  return new Document({
    title,
    creator: "AIGC video collaboration tool",
    description: "Current episode script export",
    styles: {
      default: {
        document: {
          run: {
            font: NORMAL_FONT,
            size: 22
          }
        }
      }
    },
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            children: [new TextRun({ text: title, bold: true, size: 34, font: NORMAL_FONT })]
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 360 },
            children: [new TextRun({ text: input.scriptTitle.trim(), size: 24, font: NORMAL_FONT })]
          }),
          sectionHeading("项目信息"),
          infoLine("项目名", input.projectName),
          infoLine("集号", episodeLabel),
          infoLine("剧本标题", input.scriptTitle),
          sectionHeading("来源交稿包"),
          ...sourceLines.map((line) => infoLine(line.label, line.value)),
          sectionHeading("正文"),
          ...scriptBodyParagraphs(input.body)
        ]
      }
    ]
  });
}

export async function createEpisodeScriptDocxBuffer(input: EpisodeScriptDocxInput): Promise<Buffer> {
  return Packer.toBuffer(buildEpisodeScriptDocxDocument(input));
}

export async function createEpisodeScriptDocxBlob(input: EpisodeScriptDocxInput): Promise<Blob> {
  return Packer.toBlob(buildEpisodeScriptDocxDocument(input));
}

export async function createEpisodeScriptDocxFile(input: EpisodeScriptDocxInput): Promise<EpisodeScriptDocxFile> {
  return {
    fileName: buildEpisodeScriptDocxFileName(input),
    contentType: EPISODE_SCRIPT_DOCX_CONTENT_TYPE,
    buffer: await createEpisodeScriptDocxBuffer(input)
  };
}

function assertDocxInput(input: EpisodeScriptDocxInput): void {
  const requiredFields: Array<[string, string]> = [
    ["projectName", input.projectName],
    ["scriptTitle", input.scriptTitle],
    ["body", input.body]
  ];

  for (const [field, value] of requiredFields) {
    if (!value.trim()) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  if (typeof input.episodeNumber === "number" && (!Number.isFinite(input.episodeNumber) || input.episodeNumber <= 0)) {
    throw new Error("episodeNumber must be a positive number or a non-empty string");
  }

  if (typeof input.episodeNumber === "string" && !input.episodeNumber.trim()) {
    throw new Error("episodeNumber must be a positive number or a non-empty string");
  }
}

function formatEpisodeNumber(episodeNumber: number | string): string {
  if (typeof episodeNumber === "number") {
    return `第${String(episodeNumber).padStart(2, "0")}集`;
  }

  const trimmed = episodeNumber.trim();
  return trimmed.startsWith("第") ? trimmed : `第${trimmed}集`;
}

function formatRevisionSource(source: EpisodeScriptRevisionSource): Array<{ label: string; value: string }> {
  if (typeof source === "string") {
    return [{ label: "来源", value: source.trim() || "未填写" }];
  }

  const submittedAt =
    source.submittedAt instanceof Date ? source.submittedAt.toISOString() : source.submittedAt;

  const rows = [
    ["交稿包", source.deliveryPackageName],
    ["交稿包 ID", source.deliveryPackageId],
    ["修订版本", source.version],
    ["提交人", source.submittedBy],
    ["提交时间", submittedAt],
    ["备注", source.note]
  ] as const;

  const visibleRows = rows
    .filter(([, value]) => value !== undefined && String(value).trim().length > 0)
    .map(([label, value]) => ({ label, value: String(value).trim() }));

  return visibleRows.length > 0 ? visibleRows : [{ label: "来源", value: "未填写" }];
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text, bold: true, size: 26, font: NORMAL_FONT })]
  });
}

function infoLine(label: string, value: string | number): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: `${label}：`, bold: true, font: NORMAL_FONT }),
      new TextRun({ text: String(value).trim(), font: NORMAL_FONT })
    ]
  });
}

function scriptBodyParagraphs(body: string): Paragraph[] {
  return body.split(/\r?\n/).map(
    (line) =>
      new Paragraph({
        spacing: { after: line.trim() ? 120 : 80 },
        children: [new TextRun({ text: line, font: NORMAL_FONT })]
      })
  );
}
