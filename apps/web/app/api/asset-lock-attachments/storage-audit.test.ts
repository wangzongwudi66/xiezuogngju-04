import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  createLocalAssetAttachmentStorageAuditAdapter,
  createS3AssetAttachmentStorageAuditAdapter
} from "./storage-audit";
import type { S3AssetAttachmentAuditClient } from "./storage-audit";

describe("asset attachment storage audit adapters", () => {
  it("lists local attachment files with size and mtime", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "asset-attachment-audit-"));
    const firstMtime = new Date("2026-05-30T08:00:00.000Z");
    const secondMtime = new Date("2026-05-29T08:00:00.000Z");

    try {
      await writeFile(path.join(dir, "asset-att-123e4567-e89b-12d3-a456-426614174000.png"), Buffer.from([1, 2, 3]));
      await mkdir(path.join(dir, "nested"));
      await writeFile(path.join(dir, "nested", "asset-att-123e4567-e89b-12d3-a456-426614174001.pdf"), Buffer.from([4, 5]));
      await utimes(path.join(dir, "asset-att-123e4567-e89b-12d3-a456-426614174000.png"), firstMtime, firstMtime);
      await utimes(path.join(dir, "nested", "asset-att-123e4567-e89b-12d3-a456-426614174001.pdf"), secondMtime, secondMtime);

      const adapter = createLocalAssetAttachmentStorageAuditAdapter({ dir });
      const objects = await collect(adapter.listObjects());

      expect(objects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "asset-att-123e4567-e89b-12d3-a456-426614174000.png",
            sizeBytes: 3,
            lastModified: firstMtime
          }),
          expect.objectContaining({
            key: "nested/asset-att-123e4567-e89b-12d3-a456-426614174001.pdf",
            sizeBytes: 2,
            lastModified: secondMtime
          })
        ])
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists s3 attachment objects with ListObjectsV2 pagination", async () => {
    const firstMtime = new Date("2026-05-30T08:00:00.000Z");
    const client: S3AssetAttachmentAuditClient = {
      send: vi.fn(async (command) => {
        if (!(command instanceof ListObjectsV2Command)) {
          throw new Error("unexpected_command");
        }

        if (!command.input.ContinuationToken) {
          return {
            $metadata: {},
            IsTruncated: true,
            NextContinuationToken: "page-2",
            Contents: [
              {
                Key: "safe-prefix/asset-att-123e4567-e89b-12d3-a456-426614174000.png",
                Size: 3,
                LastModified: firstMtime
              }
            ]
          } satisfies ListObjectsV2CommandOutput;
        }

        return {
          $metadata: {},
          IsTruncated: false,
          Contents: [
            {
              Key: "safe-prefix/asset-att-123e4567-e89b-12d3-a456-426614174001.pdf",
              Size: 2
            },
            {
              Size: 999
            }
          ]
        } satisfies ListObjectsV2CommandOutput;
      })
    };
    const adapter = createS3AssetAttachmentStorageAuditAdapter({
      bucket: "private-bucket",
      prefix: "safe-prefix",
      client
    });

    const objects = await collect(adapter.listObjects());
    const send = client.send as ReturnType<typeof vi.fn>;
    const firstCommand = send.mock.calls[0][0] as ListObjectsV2Command;
    const secondCommand = send.mock.calls[1][0] as ListObjectsV2Command;

    expect(objects).toEqual([
      {
        key: "safe-prefix/asset-att-123e4567-e89b-12d3-a456-426614174000.png",
        sizeBytes: 3,
        lastModified: firstMtime
      },
      {
        key: "safe-prefix/asset-att-123e4567-e89b-12d3-a456-426614174001.pdf",
        sizeBytes: 2
      }
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(firstCommand.input).toMatchObject({
      Bucket: "private-bucket",
      Prefix: "safe-prefix/"
    });
    expect(firstCommand.input).not.toHaveProperty("ContinuationToken");
    expect(secondCommand.input).toMatchObject({
      Bucket: "private-bucket",
      Prefix: "safe-prefix/",
      ContinuationToken: "page-2"
    });
  });

  it("does not leak bucket, endpoint, or raw key details in s3 list errors", async () => {
    const client: S3AssetAttachmentAuditClient = {
      send: vi.fn(async () => {
        throw new Error("private-bucket https://s3.example.invalid safe-prefix/raw-object.png");
      })
    };
    const adapter = createS3AssetAttachmentStorageAuditAdapter({
      bucket: "private-bucket",
      prefix: "safe-prefix",
      client
    });

    let message = "";

    try {
      await collect(adapter.listObjects());
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("asset_attachment_s3_audit_list_failed");
    expect(message).not.toContain("private-bucket");
    expect(message).not.toContain("https://s3.example.invalid");
    expect(message).not.toContain("safe-prefix/raw-object.png");
  });
});

async function collect<T>(iterable: AsyncIterable<T>) {
  const values: T[] = [];

  for await (const value of iterable) {
    values.push(value);
  }

  return values;
}
