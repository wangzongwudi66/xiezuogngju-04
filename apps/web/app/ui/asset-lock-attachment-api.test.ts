import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAssetLockAttachments,
  formatAssetAttachmentError,
  uploadAssetLockAttachment
} from "./asset-lock-attachment-api";

describe("asset lock attachment API helper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists attachments for the selected asset lock record", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ attachments: [] }), {
        status: 200
      })
    );

    await expect(fetchAssetLockAttachments("record-1")).resolves.toEqual({ attachments: [] });
    expect(fetchMock).toHaveBeenCalledWith("/api/asset-lock-attachments?recordId=record-1");
  });

  it("uploads multipart attachment data with the current user id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment: {
            id: "attachment-1"
          }
        }),
        {
          status: 200
        }
      )
    );
    const file = new File([new Uint8Array([1, 2, 3])], "reference.png", { type: "image/png" });

    await uploadAssetLockAttachment({
      assetLockRecordId: "asset-lock-1",
      attachmentType: "reference",
      file,
      note: "正脸参考",
      uploadedByUserId: "user-writer"
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(fetchMock).toHaveBeenCalledWith("/api/asset-lock-attachments", expect.objectContaining({ method: "POST" }));
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("assetLockRecordId")).toBe("asset-lock-1");
    expect(form.get("uploadedByUserId")).toBe("user-writer");
    expect(form.get("attachmentType")).toBe("reference");
    expect(form.get("note")).toBe("正脸参考");
    expect(form.get("file")).toBe(file);
  });

  it("formats upload and list errors for the UI", () => {
    expect(formatAssetAttachmentError(new Error("asset_attachment_file_required"))).toBe("请选择要上传的附件文件。");
    expect(formatAssetAttachmentError(new Error("asset_attachment_file_type_invalid"))).toBe(
      "附件格式不支持。请上传 JPG、PNG、WEBP 或 PDF。"
    );
    expect(formatAssetAttachmentError(new Error("asset_attachment_file_too_large"))).toBe("附件超过 20MB，请压缩后再上传。");
    expect(formatAssetAttachmentError(new Error("asset_attachment_list_failed"))).toBe("资产附件列表加载失败，请稍后重试。");
  });
});
