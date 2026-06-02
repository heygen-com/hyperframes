import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import AdmZip from "adm-zip";

import {
  createPublishArchive,
  getPublishApiBaseUrl,
  localizeExternalAssets,
  publishProjectArchive,
  uploadTimeoutMs,
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

describe("localizeExternalAssets", () => {
  it("copies external src/href assets and rewrites HTML paths", () => {
    const projectDir = makeProjectDir();
    const extDir = mkdtempSync(join(tmpdir(), "hf-ext-"));
    try {
      writeFileSync(join(extDir, "logo.png"), "PNG_DATA", "utf-8");
      const relToExt = relative(projectDir, join(extDir, "logo.png")).replaceAll("\\", "/");

      const html = `<html><body><img src="${relToExt}"></body></html>`;
      const files = new Map<string, Buffer>();
      files.set("index.html", Buffer.from(html, "utf-8"));

      const count = localizeExternalAssets(projectDir, files);

      expect(count).toBe(1);
      const rewrittenHtml = files.get("index.html")!.toString("utf-8");
      expect(rewrittenHtml).not.toContain(relToExt);
      expect(rewrittenHtml).toContain("_ext/");

      const extEntries = [...files.keys()].filter((k) => k.startsWith("_ext/"));
      expect(extEntries).toHaveLength(1);
      expect(files.get(extEntries[0]!)!.toString("utf-8")).toBe("PNG_DATA");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(extDir, { recursive: true, force: true });
    }
  });

  it("rewrites CSS url() in <style> blocks", () => {
    const projectDir = makeProjectDir();
    const extDir = mkdtempSync(join(tmpdir(), "hf-ext-"));
    try {
      writeFileSync(join(extDir, "bg.jpg"), "JPEG_DATA", "utf-8");
      const relToExt = relative(projectDir, join(extDir, "bg.jpg")).replaceAll("\\", "/");

      const html = `<html><head><style>body { background: url("${relToExt}"); }</style></head></html>`;
      const files = new Map<string, Buffer>();
      files.set("index.html", Buffer.from(html, "utf-8"));

      const count = localizeExternalAssets(projectDir, files);

      expect(count).toBe(1);
      const rewrittenHtml = files.get("index.html")!.toString("utf-8");
      expect(rewrittenHtml).toContain("url(");
      expect(rewrittenHtml).toContain("_ext/");
      expect(rewrittenHtml).not.toContain(relToExt);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(extDir, { recursive: true, force: true });
    }
  });

  it("rewrites url() in standalone CSS files", () => {
    const projectDir = makeProjectDir();
    const extDir = mkdtempSync(join(tmpdir(), "hf-ext-"));
    try {
      writeFileSync(join(extDir, "font.woff2"), "FONT_DATA", "utf-8");
      const relToExt = relative(projectDir, join(extDir, "font.woff2")).replaceAll("\\", "/");

      const css = `@font-face { src: url("${relToExt}"); }`;
      const files = new Map<string, Buffer>();
      files.set("index.html", Buffer.from("<html></html>", "utf-8"));
      files.set("styles.css", Buffer.from(css, "utf-8"));

      const count = localizeExternalAssets(projectDir, files);

      expect(count).toBe(1);
      const rewrittenCss = files.get("styles.css")!.toString("utf-8");
      expect(rewrittenCss).toContain("_ext/");
      expect(rewrittenCss).not.toContain(relToExt);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(extDir, { recursive: true, force: true });
    }
  });

  it("leaves internal assets unchanged", () => {
    const projectDir = makeProjectDir();
    try {
      mkdirSync(join(projectDir, "assets"));
      writeFileSync(join(projectDir, "assets", "logo.svg"), "<svg/>", "utf-8");
      const html = `<html><body><img src="assets/logo.svg"></body></html>`;
      const files = new Map<string, Buffer>();
      files.set("index.html", Buffer.from(html, "utf-8"));
      files.set("assets/logo.svg", Buffer.from("<svg/>", "utf-8"));

      const count = localizeExternalAssets(projectDir, files);

      expect(count).toBe(0);
      const rewrittenHtml = files.get("index.html")!.toString("utf-8");
      expect(rewrittenHtml).toContain('src="assets/logo.svg"');
      expect([...files.keys()].filter((k) => k.startsWith("_ext/"))).toHaveLength(0);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("leaves remote URLs unchanged", () => {
    const projectDir = makeProjectDir();
    try {
      const html = `<html><body><img src="https://cdn.example.com/logo.png"><video src="http://cdn.example.com/vid.mp4"></video></body></html>`;
      const files = new Map<string, Buffer>();
      files.set("index.html", Buffer.from(html, "utf-8"));

      const count = localizeExternalAssets(projectDir, files);

      expect(count).toBe(0);
      const rewrittenHtml = files.get("index.html")!.toString("utf-8");
      expect(rewrittenHtml).toContain("https://cdn.example.com/logo.png");
      expect(rewrittenHtml).toContain("http://cdn.example.com/vid.mp4");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("deduplicates: same external asset referenced from multiple files", () => {
    const projectDir = makeProjectDir();
    const extDir = mkdtempSync(join(tmpdir(), "hf-ext-"));
    try {
      writeFileSync(join(extDir, "shared.png"), "SHARED", "utf-8");
      const relToExt = relative(projectDir, join(extDir, "shared.png")).replaceAll("\\", "/");

      const files = new Map<string, Buffer>();
      files.set(
        "index.html",
        Buffer.from(`<html><body><img src="${relToExt}"></body></html>`, "utf-8"),
      );
      mkdirSync(join(projectDir, "compositions"));
      files.set(
        "compositions/scene.html",
        Buffer.from(`<html><body><img src="../${relToExt}"></body></html>`, "utf-8"),
      );

      const count = localizeExternalAssets(projectDir, files);

      expect(count).toBe(1);
      const extEntries = [...files.keys()].filter((k) => k.startsWith("_ext/"));
      expect(extEntries).toHaveLength(1);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(extDir, { recursive: true, force: true });
    }
  });

  it("handles sub-composition HTML with external refs", () => {
    const projectDir = makeProjectDir();
    const extDir = mkdtempSync(join(tmpdir(), "hf-ext-"));
    try {
      mkdirSync(join(projectDir, "compositions"));
      writeFileSync(join(extDir, "overlay.png"), "OVERLAY", "utf-8");
      const relFromComps = relative(
        join(projectDir, "compositions"),
        join(extDir, "overlay.png"),
      ).replaceAll("\\", "/");

      const files = new Map<string, Buffer>();
      files.set("index.html", Buffer.from("<html></html>", "utf-8"));
      files.set(
        "compositions/scene.html",
        Buffer.from(`<html><body><img src="${relFromComps}"></body></html>`, "utf-8"),
      );

      const count = localizeExternalAssets(projectDir, files);

      expect(count).toBe(1);
      const rewritten = files.get("compositions/scene.html")!.toString("utf-8");
      expect(rewritten).toContain("_ext/");
      expect(rewritten).not.toContain(relFromComps);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(extDir, { recursive: true, force: true });
    }
  });

  it("no-op when no external assets exist", () => {
    const projectDir = makeProjectDir();
    try {
      const html = `<html><body><p>Hello</p></body></html>`;
      const files = new Map<string, Buffer>();
      files.set("index.html", Buffer.from(html, "utf-8"));

      const count = localizeExternalAssets(projectDir, files);

      expect(count).toBe(0);
      expect(files.size).toBe(1);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("skips references to non-existent external files", () => {
    const projectDir = makeProjectDir();
    try {
      const html = `<html><body><img src="../nonexistent/file.png"></body></html>`;
      const files = new Map<string, Buffer>();
      files.set("index.html", Buffer.from(html, "utf-8"));

      const count = localizeExternalAssets(projectDir, files);

      expect(count).toBe(0);
      const rewrittenHtml = files.get("index.html")!.toString("utf-8");
      expect(rewrittenHtml).toContain("../nonexistent/file.png");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("rewrites inline style url() references", () => {
    const projectDir = makeProjectDir();
    const extDir = mkdtempSync(join(tmpdir(), "hf-ext-"));
    try {
      writeFileSync(join(extDir, "bg.jpg"), "JPEG_DATA", "utf-8");
      const relToExt = relative(projectDir, join(extDir, "bg.jpg")).replaceAll("\\", "/");

      const html = `<html><body><div style="background-image: url('${relToExt}')"></div></body></html>`;
      const files = new Map<string, Buffer>();
      files.set("index.html", Buffer.from(html, "utf-8"));

      const count = localizeExternalAssets(projectDir, files);

      expect(count).toBe(1);
      const rewrittenHtml = files.get("index.html")!.toString("utf-8");
      expect(rewrittenHtml).toContain("_ext/");
      expect(rewrittenHtml).not.toContain(relToExt);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(extDir, { recursive: true, force: true });
    }
  });

  it("createPublishArchive includes localized external assets", () => {
    const projectDir = makeProjectDir();
    const extDir = mkdtempSync(join(tmpdir(), "hf-ext-"));
    try {
      writeFileSync(join(extDir, "video.mp4"), "MP4_DATA", "utf-8");
      const relToExt = relative(projectDir, join(extDir, "video.mp4")).replaceAll("\\", "/");
      writeFileSync(
        join(projectDir, "index.html"),
        `<html><body><video src="${relToExt}"></video></body></html>`,
        "utf-8",
      );

      const archive = createPublishArchive(projectDir);

      expect(archive.fileCount).toBe(2);
      const zip = new AdmZip(archive.buffer);
      const entries = zip.getEntries().map((e) => e.entryName);
      expect(entries).toContain("index.html");
      expect(entries.some((e) => e.startsWith("_ext/") && e.endsWith("video.mp4"))).toBe(true);

      const indexHtml = zip.readAsText("index.html");
      expect(indexHtml).toContain("_ext/");
      expect(indexHtml).not.toContain(relToExt);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(extDir, { recursive: true, force: true });
    }
  });
});

describe("uploadTimeoutMs", () => {
  it("returns the minimum timeout for small files", () => {
    expect(uploadTimeoutMs(0)).toBe(120_000);
    expect(uploadTimeoutMs(50 * 1024 * 1024)).toBe(120_000);
  });

  it("scales above the floor for large files", () => {
    expect(uploadTimeoutMs(64 * 1024 * 1024)).toBeGreaterThan(120_000);
    expect(uploadTimeoutMs(500 * 1024 * 1024)).toBeGreaterThan(900_000);
  });

  it("returns an integer", () => {
    expect(Number.isInteger(uploadTimeoutMs(123_456))).toBe(true);
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
