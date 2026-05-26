import { describe, expect, it, vi } from "vitest";
import { triggerAssetAttachmentDownload, type AssetAttachmentDownloadTarget } from "./asset-lock-attachment-download";

describe("asset lock attachment browser download helper", () => {
  it("triggers a Blob download with a temporary anchor and revokes the object URL", () => {
    const { appendChild, click, createObjectURL, link, remove, revokeObjectURL, target } = createDownloadTarget();
    const blob = new Blob(["attachment"]);

    triggerAssetAttachmentDownload(blob, "asset.png", target);

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(target.document.createElement).toHaveBeenCalledWith("a");
    expect(link.href).toBe("blob:asset-attachment");
    expect(link.download).toBe("asset.png");
    expect(link.style.display).toBe("none");
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:asset-attachment");
  });

  it("still removes the temporary anchor and revokes the object URL when click fails", () => {
    const click = vi.fn(() => {
      throw new Error("download_blocked");
    });
    const { remove, revokeObjectURL, target } = createDownloadTarget({ click });

    expect(() => triggerAssetAttachmentDownload(new Blob(["attachment"]), "asset.png", target)).toThrow("download_blocked");
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:asset-attachment");
  });
});

function createDownloadTarget(options: { click?: () => void } = {}) {
  const click = vi.fn(options.click ?? (() => undefined));
  const remove = vi.fn();
  const link = {
    download: "",
    href: "",
    remove,
    click,
    style: {
      display: ""
    }
  };
  const appendChild = vi.fn();
  const createElement = vi.fn(() => link);
  const createObjectURL = vi.fn(() => "blob:asset-attachment");
  const revokeObjectURL = vi.fn();
  const target = {
    document: {
      body: {
        appendChild
      },
      createElement
    },
    URL: {
      createObjectURL,
      revokeObjectURL
    }
  } as unknown as AssetAttachmentDownloadTarget;

  return {
    appendChild,
    click,
    createObjectURL,
    link,
    remove,
    revokeObjectURL,
    target
  };
}
