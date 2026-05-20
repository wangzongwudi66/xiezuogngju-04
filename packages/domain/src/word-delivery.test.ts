import { describe, expect, it } from "vitest";
import {
  parseDeclaredEpisodeRange,
  parseWordDeliveryDocx,
  parseWordDeliveryText
} from "./word-delivery";

describe("Word delivery episode parser", () => {
  it("splits plain text into episodes and reports scene heading warnings", () => {
    const result = parseWordDeliveryText(
      [
        "项目说明：本批次为试投。",
        "第 1 集 矿山来信",
        "场 1-1 金城矿山 日 外",
        "矿车停在山口。",
        "场 一 金城矿山",
        "第2集",
        "场 2-1 调度室 夜 内",
        "电话响起。"
      ].join("\n"),
      { declaredRange: "1-2" }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.episodes).toHaveLength(2);
    expect(result.episodes[0]).toMatchObject({
      episodeNo: 1,
      title: "矿山来信",
      content: expect.stringContaining("矿车停在山口。")
    });
    expect(result.episodes[1]).toMatchObject({
      episodeNo: 2,
      title: "第2集"
    });
    expect(result.warnings.some((warning) => warning.code === "preface_ignored")).toBe(true);
    expect(result.episodes[0].warnings).toContainEqual(
      expect.objectContaining({
        code: "scene_heading_format",
        line: 5
      })
    );
  });

  it("returns UI-usable remedies when episode boundaries are missing", () => {
    const result = parseWordDeliveryText("场 1-1 金城矿山 日 外\n没有集标题的正文");

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.errors[0]).toMatchObject({
      code: "episode_boundary_not_found",
      severity: "error"
    });
    expect(result.remedies).toContain("确认 Word 正文里有“第 1 集”这类标题。");
  });

  it("validates declared ranges without discarding parsed episodes", () => {
    const result = parseWordDeliveryText("第 1 集\n正文\n第 3 集\n正文", { declaredRange: "1-2" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.episodes.map((episode) => episode.episodeNo)).toEqual([1, 3]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "missing_episode_in_declared_range",
        value: "2"
      })
    );
    expect(result.episodes[1].warnings).toContainEqual(
      expect.objectContaining({
        code: "episode_out_of_declared_range",
        episodeNo: 3
      })
    );
  });

  it("parses stored docx document.xml into episode segments", async () => {
    const xml = [
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
      paragraph("第 1 集 金城矿山"),
      paragraph("场 1-1 金城矿山 日 外"),
      paragraph("矿灯一盏盏亮起。"),
      "</w:body></w:document>"
    ].join("");

    const result = await parseWordDeliveryDocx(createStoredDocx("word/document.xml", xml), {
      declaredRange: "1-1"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.source).toBe("docx");
    expect(result.episodes).toEqual([
      expect.objectContaining({
        episodeNo: 1,
        title: "金城矿山",
        content: expect.stringContaining("矿灯一盏盏亮起。")
      })
    ]);
  });

  it("accepts common declared range forms", () => {
    expect(parseDeclaredEpisodeRange("1-10")).toEqual({ from: 1, to: 10 });
    expect(parseDeclaredEpisodeRange("第 1 至 20 集")).toEqual({ from: 1, to: 20 });
    expect(parseDeclaredEpisodeRange("20-1")).toBeUndefined();
  });
});

function paragraph(text: string) {
  return `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
}

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createStoredDocx(path: string, content: string) {
  const encoder = new TextEncoder();
  const fileName = encoder.encode(path);
  const payload = encoder.encode(content);
  const localHeader = bytes(
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(payload.length),
    u32(payload.length),
    u16(fileName.length),
    u16(0),
    fileName,
    payload
  );
  const centralDirectory = bytes(
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(payload.length),
    u32(payload.length),
    u16(fileName.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    fileName
  );
  const endOfCentralDirectory = bytes(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(centralDirectory.length),
    u32(localHeader.length),
    u16(0)
  );

  return bytes(localHeader, centralDirectory, endOfCentralDirectory);
}

function bytes(...chunks: Uint8Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });

  return output;
}

function u16(value: number) {
  const output = new Uint8Array(2);
  new DataView(output.buffer).setUint16(0, value, true);
  return output;
}

function u32(value: number) {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, true);
  return output;
}
