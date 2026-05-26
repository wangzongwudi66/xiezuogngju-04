import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteAssetLockAttachment,
  downloadAssetLockAttachment,
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

  it("downloads attachment blobs and reads file metadata from response headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "Content-Disposition": "attachment; filename=\"fallback.png\"; filename*=UTF-8''asset%20%E5%8F%82%E8%80%83.png",
          "Content-Length": "3",
          "Content-Type": "image/png"
        }
      })
    );

    const result = await downloadAssetLockAttachment("attachment/1");

    expect(fetchMock).toHaveBeenCalledWith("/api/asset-lock-attachments/attachment%2F1");
    expect(result.fileName).toBe("asset 参考.png");
    expect(result.mime).toBe("image/png");
    expect(result.size).toBe(3);
    await expect(result.blob.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer);
  });

  it("soft deletes an attachment by id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          attachment: {
            id: "attachment-1",
            status: "deleted"
          }
        }),
        {
          status: 200
        }
      )
    );

    await expect(deleteAssetLockAttachment("attachment-1")).resolves.toEqual({
      attachment: {
        id: "attachment-1",
        status: "deleted"
      }
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/asset-lock-attachments/attachment-1", { method: "DELETE" });
  });

  it("maps helper failures from API error payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "asset_attachment_delete_forbidden" }), {
        status: 403
      })
    );

    await expect(deleteAssetLockAttachment("attachment-1")).rejects.toThrow("asset_attachment_delete_forbidden");
  });

  it("formats upload and list errors for the UI", () => {
    expect(formatAssetAttachmentError(new Error("asset_attachment_file_required"))).toBe("请选择要上传的附件文件。");
    expect(formatAssetAttachmentError(new Error("asset_attachment_file_type_invalid"))).toBe(
      "附件格式不支持。请上传 JPG、PNG、WEBP 或 PDF。"
    );
    expect(formatAssetAttachmentError(new Error("asset_attachment_file_too_large"))).toBe("附件超过 20MB，请压缩后再上传。");
    expect(formatAssetAttachmentError(new Error("asset_attachment_list_failed"))).toBe("资产附件列表加载失败，请稍后重试。");
    expect(formatAssetAttachmentError(new Error("asset_attachment_download_failed"))).toBe("资产附件下载失败，请稍后重试。");
    expect(formatAssetAttachmentError(new Error("asset_attachment_delete_failed"))).toBe("资产附件删除失败，请检查记录状态和当前用户权限后重试。");
    expect(formatAssetAttachmentError(new Error("asset_attachment_delete_forbidden"))).toBe("当前账号无权删除该资产附件。");
    expect(formatAssetAttachmentError(new Error("asset_attachment_locked_record_delete_forbidden"))).toBe("资产已定版，附件不能删除。");
    expect(formatAssetAttachmentError(new Error("asset_attachment_not_found"))).toBe("资产附件不存在或已失效。");
    expect(formatAssetAttachmentError(new TypeError("Failed to fetch"))).toBe("资产附件操作失败，请稍后重试。");
    expect(formatAssetAttachmentError(new Error("fetch failed"))).toBe("资产附件操作失败，请稍后重试。");
    expect(formatAssetAttachmentError(new Error("NetworkError when attempting to fetch resource."))).toBe(
      "资产附件操作失败，请稍后重试。"
    );
  });
});
