import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import {
  createEpisodeScriptDocxBlob,
  createEpisodeScriptDocxFile,
  EPISODE_SCRIPT_DOCX_CONTENT_TYPE
} from "./script-docx";

const sampleInput = {
  projectName: "金城矿山",
  episodeNumber: 3,
  scriptTitle: "追光",
  body: "场 1-1 矿山外 日 外\n林岚穿过扬尘，看见远处亮起的信号灯。\n\n她停下脚步。",
  revisionSource: {
    deliveryPackageName: "编剧交稿包 M2-2026-05-19",
    deliveryPackageId: "delivery-003",
    version: "v2",
    submittedBy: "周编剧",
    submittedAt: "2026-05-19 20:30",
    note: "当前集生效版本"
  }
};

describe("episode script docx export", () => {
  it("creates a downloadable docx buffer with file metadata", async () => {
    const file = await createEpisodeScriptDocxFile(sampleInput);

    expect(file.fileName).toBe("金城矿山-第03集-追光.docx");
    expect(file.contentType).toBe(EPISODE_SCRIPT_DOCX_CONTENT_TYPE);
    expect(Buffer.isBuffer(file.buffer)).toBe(true);
    expect(file.buffer.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(file.buffer.byteLength).toBeGreaterThan(5_000);
  });

  it("can return a Blob for browser-style download handlers", async () => {
    const blob = await createEpisodeScriptDocxBlob(sampleInput);

    expect(blob.type).toBe(EPISODE_SCRIPT_DOCX_CONTENT_TYPE);
    expect(blob.size).toBeGreaterThan(5_000);
  });

  it("rejects empty required script fields", async () => {
    await expect(createEpisodeScriptDocxFile({ ...sampleInput, body: " " })).rejects.toThrow(
      "Missing required field: body"
    );
  });
});
