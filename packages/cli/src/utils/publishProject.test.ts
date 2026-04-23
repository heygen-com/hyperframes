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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
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
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads the archive and returns the stable project URL", async () => {
    const dir = makeProjectDir();
    try {
      writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");
      writeFileSync(join(dir, "styles.css"), "body {}", "utf-8");

      const result = await publishProjectArchive(dir);

      expect(getPublishApiBaseUrl()).toBe("https://api2.heygen.com");
      expect(result).toMatchObject({
        projectId: "hfp_123",
        url: "https://hyperframes.dev/p/hfp_123",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
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
});
