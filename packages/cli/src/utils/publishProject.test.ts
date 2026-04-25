import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPublishArchive,
  getPublishApiBaseUrl,
  publishProjectArchive,
} from "./publishProject.js";

function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), "hf-publish-"));
}

describe("createPublishArchive", () => {
  it("packages the project and skips hidden files and node_modules", () => {
    const dir = makeProjectDir();
    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "assets/logo.svg"), "<svg />", "utf-8");
      mkdirSync(join(dir, ".git"));
      writeFileSync(join(dir, ".env"), "SECRET=1", "utf-8");
      mkdirSync(join(dir, "node_modules"));
      writeFileSync(join(dir, "node_modules/ignored.js"), "console.log('ignore')", "utf-8");

      const archive = createPublishArchive(dir);

      expect(archive.fileCount).toBe(2);
      expect(archive.buffer.byteLength).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("publishProjectArchive", () => {
  beforeEach(() => {
    vi.stubEnv("HYPERFRAMES_PUBLISHED_PROJECTS_API_URL", "");
    vi.stubEnv("HEYGEN_API_URL", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uploads through the staged publish flow and returns the stable project URL", async () => {
    const dir = makeProjectDir();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              upload_url:
                "https://s3.example.com/upload?X-Amz-SignedHeaders=content-length;content-type;host;x-amz-server-side-encryption",
              upload_key: "ephemeral_store/hyperframes/project_uploads/upload-1/demo.zip",
              upload_headers: {
                "content-type": "application/zip",
                "x-amz-server-side-encryption": "AES256",
              },
              content_type: "application/zip",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              project_id: "hfp_123",
              title: "demo",
              file_count: 2,
              url: "https://hyperframes.dev/p/hfp_123",
              claim_token: "claim-token",
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");
      writeFileSync(join(dir, "styles.css"), "body {}", "utf-8");

      const result = await publishProjectArchive(dir);

      expect(getPublishApiBaseUrl()).toBe("https://api2.heygen.com");
      expect(result).toMatchObject({
        projectId: "hfp_123",
        url: "https://hyperframes.dev/p/hfp_123",
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "https://api2.heygen.com/v1/hyperframes/projects/publish/upload",
        expect.objectContaining({
          method: "POST",
          headers: { "content-type": "application/json", heygen_route: "canary" },
          signal: expect.any(AbortSignal),
        }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://s3.example.com/upload?X-Amz-SignedHeaders=content-length;content-type;host;x-amz-server-side-encryption",
        expect.objectContaining({
          method: "PUT",
          headers: {
            "content-length": expect.any(String),
            "content-type": "application/zip",
            "x-amz-server-side-encryption": "AES256",
          },
          signal: expect.any(AbortSignal),
        }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "https://api2.heygen.com/v1/hyperframes/projects/publish/complete",
        expect.objectContaining({
          method: "POST",
          headers: { "content-type": "application/json", heygen_route: "canary" },
          signal: expect.any(AbortSignal),
        }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the legacy multipart endpoint when staged publish is not deployed", async () => {
    const dir = makeProjectDir();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              project_id: "hfp_123",
              title: "demo",
              file_count: 2,
              url: "https://hyperframes.dev/p/hfp_123",
              claim_token: "claim-token",
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");

      const result = await publishProjectArchive(dir);

      expect(result.projectId).toBe("hfp_123");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://api2.heygen.com/v1/hyperframes/projects/publish",
        expect.objectContaining({
          method: "POST",
          headers: { heygen_route: "canary" },
          signal: expect.any(AbortSignal),
        }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not fall back to multipart when a staged S3 upload fails", async () => {
    const dir = makeProjectDir();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              upload_url: "https://s3.example.com/upload",
              upload_key: "ephemeral_store/hyperframes/project_uploads/upload-1/demo.zip",
              upload_headers: {
                "content-type": "application/zip",
                "x-amz-server-side-encryption": "AES256",
              },
              content_type: "application/zip",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("denied", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");

      await expect(publishProjectArchive(dir)).rejects.toThrow("Failed to upload project archive");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
