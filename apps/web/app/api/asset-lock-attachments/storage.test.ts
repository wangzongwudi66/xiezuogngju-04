import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  AssetAttachmentStorageFileNotFoundError,
  createS3AssetAttachmentStorage,
  resolveAssetAttachmentStorage,
  resolveAssetAttachmentStorageProvider
} from "./storage";
import type { S3AssetAttachmentClient } from "./storage";

describe("asset attachment storage resolver", () => {
  it("defaults to local storage unless s3 is explicitly requested", () => {
    const storage = resolveAssetAttachmentStorage({});

    expect(resolveAssetAttachmentStorageProvider({})).toBe("local");
    expect(resolveAssetAttachmentStorageProvider({ ASSET_LOCK_ATTACHMENT_STORAGE_PROVIDER: "local" })).toBe("local");
    expect(storage.makeKey({ fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000", extension: ".PNG" })).toBe(
      "asset-att-123e4567-e89b-12d3-a456-426614174000.png"
    );
  });

  it("fails closed when s3 is enabled without a bucket", () => {
    expect(() => resolveAssetAttachmentStorage({ ASSET_LOCK_ATTACHMENT_STORAGE_PROVIDER: "s3" })).toThrow(
      "asset_attachment_storage_bucket_required"
    );
    expect(() => resolveAssetAttachmentStorageProvider({ ASSET_LOCK_ATTACHMENT_STORAGE_PROVIDER: "s3" })).toThrow(
      "asset_attachment_storage_bucket_required"
    );
  });

  it("uses an s3 object key derived from the existing file id and extension", async () => {
    const client = createMockS3Client();
    const storage = createS3AssetAttachmentStorage({ bucket: "asset-bucket", prefix: "tenant-a/assets", client });
    const key = storage.makeKey({ fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000", extension: ".PNG" });

    await storage.put({ key, bytes: new Uint8Array([1, 2, 3]), mime: "image/png" });
    const putCommand = client.send.mock.calls[0][0] as PutObjectCommand;

    expect(key).toBe("tenant-a/assets/asset-att-123e4567-e89b-12d3-a456-426614174000.png");
    expect(putCommand).toBeInstanceOf(PutObjectCommand);
    expect(putCommand.input).toEqual({
      Bucket: "asset-bucket",
      Key: "tenant-a/assets/asset-att-123e4567-e89b-12d3-a456-426614174000.png",
      Body: new Uint8Array([1, 2, 3]),
      ContentType: "image/png"
    });
  });

  it("downloads and deletes through the configured s3 object client", async () => {
    const client = createMockS3Client({ getBody: new Uint8Array([4, 5, 6]) });
    const storage = createS3AssetAttachmentStorage({ bucket: "asset-bucket", client });
    const key = storage.makeKey({ fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000", extension: ".png" });

    await expect(storage.get({ key })).resolves.toEqual(new Uint8Array([4, 5, 6]));
    await storage.delete({ key });

    const getCommand = client.send.mock.calls[0][0] as GetObjectCommand;
    const deleteCommand = client.send.mock.calls[1][0] as DeleteObjectCommand;
    expect(getCommand).toBeInstanceOf(GetObjectCommand);
    expect(deleteCommand).toBeInstanceOf(DeleteObjectCommand);
    expect(getCommand.input).toMatchObject({ Bucket: "asset-bucket", Key: key });
    expect(deleteCommand.input).toMatchObject({ Bucket: "asset-bucket", Key: key });
  });

  it("allows safe persisted s3 read keys outside the current prefix", async () => {
    const client = createMockS3Client({ getBody: new Uint8Array([7, 8, 9]) });
    const storage = createS3AssetAttachmentStorage({ bucket: "asset-bucket", prefix: "current-prefix", client });

    await expect(
      storage.get({ key: "legacy-prefix\\asset-att-123e4567-e89b-12d3-a456-426614174000.png" })
    ).resolves.toEqual(new Uint8Array([7, 8, 9]));

    const getCommand = client.send.mock.calls[0][0] as GetObjectCommand;
    expect(getCommand.input).toMatchObject({
      Bucket: "asset-bucket",
      Key: "legacy-prefix/asset-att-123e4567-e89b-12d3-a456-426614174000.png"
    });
  });

  it("keeps s3 writes and deletes constrained to the current prefix", async () => {
    const client = createMockS3Client();
    const storage = createS3AssetAttachmentStorage({ bucket: "asset-bucket", prefix: "current-prefix", client });
    const legacyKey = "legacy-prefix/asset-att-123e4567-e89b-12d3-a456-426614174000.png";

    await expect(storage.put({ key: legacyKey, bytes: new Uint8Array([1]), mime: "image/png" })).rejects.toThrow(
      "asset_attachment_storage_key_invalid"
    );
    await expect(storage.delete({ key: legacyKey })).rejects.toThrow("asset_attachment_storage_key_invalid");
    expect(client.send).not.toHaveBeenCalled();
  });

  it("rejects unsafe persisted s3 read keys", async () => {
    const storage = createS3AssetAttachmentStorage({ bucket: "asset-bucket", client: createMockS3Client() });
    const unsafeKeys = [
      "",
      "/asset-att-123e4567-e89b-12d3-a456-426614174000.png",
      "C:\\asset-att-123e4567-e89b-12d3-a456-426614174000.png",
      "legacy-prefix//asset-att-123e4567-e89b-12d3-a456-426614174000.png",
      "legacy-prefix/./asset-att-123e4567-e89b-12d3-a456-426614174000.png",
      "legacy-prefix/../asset-att-123e4567-e89b-12d3-a456-426614174000.png",
      "legacy-prefix/not-asset-att-123e4567-e89b-12d3-a456-426614174000.png",
      "legacy-prefix/asset-att-123e4567-e89b-12d3-a456-426614174000.txt"
    ];

    for (const key of unsafeKeys) {
      await expect(storage.get({ key })).rejects.toThrow("asset_attachment_storage_key_invalid");
    }
  });

  it("maps missing s3 objects to the stable storage file-not-found error", async () => {
    const client = createMockS3Client({
      getError: Object.assign(new Error("missing"), { name: "NoSuchKey" })
    });
    const storage = createS3AssetAttachmentStorage({ bucket: "asset-bucket", client });
    const key = storage.makeKey({ fileId: "asset-att-123e4567-e89b-12d3-a456-426614174000", extension: ".png" });

    await expect(storage.get({ key })).rejects.toBeInstanceOf(AssetAttachmentStorageFileNotFoundError);
  });
});

function createMockS3Client(input: { getBody?: Uint8Array; getError?: Error } = {}) {
  const client: S3AssetAttachmentClient = {
    send: vi.fn(async (command) => {
      if (command instanceof GetObjectCommand) {
        if (input.getError) {
          throw input.getError;
        }

        return { Body: input.getBody ?? new Uint8Array() };
      }

      return {};
    })
  };

  return client as S3AssetAttachmentClient & { send: ReturnType<typeof vi.fn> };
}
