export type AssetAttachmentDownloadTarget = {
  document: Pick<Document, "createElement"> & {
    body: Pick<HTMLElement, "appendChild">;
  };
  URL: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
};

export function triggerAssetAttachmentDownload(
  blob: Blob,
  fileName: string,
  target: AssetAttachmentDownloadTarget = globalThis as typeof globalThis & AssetAttachmentDownloadTarget
) {
  const objectUrl = target.URL.createObjectURL(blob);

  try {
    const link = target.document.createElement("a");
    link.href = objectUrl;
    link.download = fileName || "attachment";
    link.style.display = "none";
    target.document.body.appendChild(link);

    try {
      link.click();
    } finally {
      link.remove();
    }
  } finally {
    target.URL.revokeObjectURL(objectUrl);
  }
}
