import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The error class lives inside this `vi.hoisted` block (not a plain top-level
// `class`) because `vi.mock` factories run during static-import resolution —
// before any of the test file's own top-level statements execute — so a
// `class` declared below would still be in its temporal dead zone. Mirrors
// the pattern in `commands/play.test.ts`.
const mocks = vi.hoisted(() => {
  class FakeProxyTranscodeError extends Error {
    readonly exitCode: number | null;
    readonly stderrTail: string;
    constructor(message: string, exitCode: number | null = null, stderrTail = "") {
      super(message);
      this.name = "ProxyTranscodeError";
      this.exitCode = exitCode;
      this.stderrTail = stderrTail;
    }
  }
  return {
    resolveProxy: vi.fn<(projectDir: string, absoluteSourcePath: string) => Promise<string>>(),
    scanProjectMediaCodecMap: vi.fn<
      (...args: unknown[]) => Promise<
        Record<
          string,
          {
            codecName: string;
            browserHostile: boolean;
            representativeMime: string | null;
            hasAlpha?: boolean;
          }
        >
      >
    >(),
    ProxyTranscodeError: FakeProxyTranscodeError,
    waitForProxy: vi.fn(<T>(promise: Promise<T>, _timeoutMs?: number) => promise),
  };
});
const FakeProxyTranscodeError = mocks.ProxyTranscodeError;

vi.mock("@hyperframes/studio-server/proxy-transcoder", () => ({
  resolveProxy: mocks.resolveProxy,
  ProxyTranscodeError: mocks.ProxyTranscodeError,
  waitForProxy: mocks.waitForProxy,
  TRANSCODE_TIMEOUT_MS: 15 * 60 * 1000,
}));

vi.mock("@hyperframes/studio-server/media-codec-map", () => ({
  scanProjectMediaCodecMap: mocks.scanProjectMediaCodecMap,
  proxyVariantFor: (facts: { hasAlpha?: boolean }) => (facts.hasAlpha ? "vp8" : "h264"),
}));

const { bakeMediaProxies, PROXY_ARCHIVE_PREFIX } = await import("./publishProxyBake.js");

// No real project directory is touched: `scanProjectMediaCodecMap` (which
// would otherwise walk `projectDir`) and `resolveProxy` (which would
// transcode from it) are both mocked above, mirroring `checkBrowser.test.ts`'s
// `PROJECT: ProjectDir = { dir: "/project", ... }` fixture.
const PROJECT_DIR = resolve("/project");

const tempDirs: string[] = [];
function tmpProxyFile(content: string, extension = ".mp4"): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-publish-proxy-bake-"));
  tempDirs.push(dir);
  const path = join(dir, `proxy${extension}`);
  writeFileSync(path, content, "utf-8");
  return path;
}

function indexHtml(...tags: string[]): Buffer {
  return Buffer.from(`<html><body>${tags.join("\n")}</body></html>`, "utf-8");
}

afterEach(() => {
  mocks.resolveProxy.mockReset();
  mocks.scanProjectMediaCodecMap.mockReset();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("bakeMediaProxies", () => {
  it("bakes a proxy for a hostile video: original stays, proxy is added under _proxy/, HTML rewritten to it", async () => {
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mp4": { codecName: "hevc", browserHostile: true, representativeMime: "video/mp4" },
    });
    const proxyPath = tmpProxyFile("PROXY_H264_BYTES");
    mocks.resolveProxy.mockResolvedValue(proxyPath);

    const fileContents = new Map<string, Buffer>([
      ["index.html", indexHtml(`<video src="clip.mp4" muted></video>`)],
      ["clip.mp4", Buffer.from("ORIGINAL_HEVC_BYTES", "utf-8")],
    ]);

    const manifest = await bakeMediaProxies(PROJECT_DIR, fileContents);

    // Original bytes untouched.
    expect(fileContents.get("clip.mp4")?.toString("utf-8")).toBe("ORIGINAL_HEVC_BYTES");

    // Proxy added under the archive prefix with the transcoded bytes.
    const proxyEntries = [...fileContents.keys()].filter((k) =>
      k.startsWith(`${PROXY_ARCHIVE_PREFIX}/`),
    );
    expect(proxyEntries).toHaveLength(1);
    expect(fileContents.get(proxyEntries[0]!)?.toString("utf-8")).toBe("PROXY_H264_BYTES");

    // HTML rewritten to reference the proxy, not the original.
    const html = fileContents.get("index.html")!.toString("utf-8");
    expect(html).toContain(proxyEntries[0]!);
    expect(html).not.toContain('src="clip.mp4"');

    expect(mocks.resolveProxy).toHaveBeenCalledWith(
      PROJECT_DIR,
      join(PROJECT_DIR, "clip.mp4"),
      "h264",
    );
    expect(mocks.waitForProxy).toHaveBeenCalledWith(expect.any(Promise), 15 * 60 * 1000);
    expect(manifest).toEqual({ proxied: ["/clip.mp4"], skippedAlpha: [], failed: [] });
  });

  it("never rewrites an <audio> sharing the hostile video's src; the original file stays for it", async () => {
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mp4": { codecName: "hevc", browserHostile: true, representativeMime: "video/mp4" },
    });
    mocks.resolveProxy.mockResolvedValue(tmpProxyFile("PROXY_H264_BYTES"));

    const fileContents = new Map<string, Buffer>([
      [
        "index.html",
        indexHtml(`<video src="clip.mp4" muted></video>`, `<audio src="clip.mp4"></audio>`),
      ],
      ["clip.mp4", Buffer.from("ORIGINAL_HEVC_BYTES", "utf-8")],
    ]);

    await bakeMediaProxies(PROJECT_DIR, fileContents);

    const html = fileContents.get("index.html")!.toString("utf-8");
    expect(html).toContain('<audio src="clip.mp4">');
    expect(html).not.toMatch(/<video src="clip\.mp4"/);
    expect(fileContents.get("clip.mp4")?.toString("utf-8")).toBe("ORIGINAL_HEVC_BYTES");
  });

  it("fails publish with an explicit manifest when a required opaque proxy cannot be built", async () => {
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mp4": { codecName: "hevc", browserHostile: true, representativeMime: "video/mp4" },
    });
    mocks.resolveProxy.mockRejectedValue(new FakeProxyTranscodeError("ffmpeg exited with code 1"));
    const fileContents = new Map<string, Buffer>([
      ["index.html", indexHtml(`<video src="clip.mp4" muted></video>`)],
      ["clip.mp4", Buffer.from("ORIGINAL_HEVC_BYTES", "utf-8")],
    ]);

    await expect(bakeMediaProxies(PROJECT_DIR, fileContents)).rejects.toMatchObject({
      name: "ProxyBakeError",
      manifest: {
        proxied: [],
        skippedAlpha: [],
        failed: [{ path: "/clip.mp4", error: "ffmpeg exited with code 1" }],
      },
    });

    expect([...fileContents.keys()].some((k) => k.startsWith(`${PROXY_ARCHIVE_PREFIX}/`))).toBe(
      false,
    );
    expect(fileContents.get("index.html")?.toString("utf-8")).toContain('src="clip.mp4"');
    expect(fileContents.get("clip.mp4")?.toString("utf-8")).toBe("ORIGINAL_HEVC_BYTES");
  });

  it("bakes and rewrites a percent-encoded src through the same resolution path the scan uses", async () => {
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/assets/my clip.mp4": {
        codecName: "hevc",
        browserHostile: true,
        representativeMime: "video/mp4",
      },
    });
    const proxyPath = tmpProxyFile("PROXY_H264_BYTES");
    mocks.resolveProxy.mockResolvedValue(proxyPath);

    const fileContents = new Map<string, Buffer>([
      ["index.html", indexHtml(`<video src="assets/my%20clip.mp4" muted></video>`)],
      ["assets/my clip.mp4", Buffer.from("ORIGINAL_HEVC_BYTES", "utf-8")],
    ]);

    await bakeMediaProxies(PROJECT_DIR, fileContents);

    // Baked: the proxy entry landed under _proxy/.
    const proxyEntries = [...fileContents.keys()].filter((k) =>
      k.startsWith(`${PROXY_ARCHIVE_PREFIX}/`),
    );
    expect(proxyEntries).toHaveLength(1);

    // Rewritten: the percent-encoded src now points at the proxy.
    const html = fileContents.get("index.html")!.toString("utf-8");
    expect(html).toContain(proxyEntries[0]!);
    expect(html).not.toContain("assets/my%20clip.mp4");
  });

  it("bakes an alpha-bearing hostile asset as a VP8 WebM proxy", async () => {
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mov": {
        codecName: "prores",
        browserHostile: true,
        representativeMime: null,
        hasAlpha: true,
      },
    });
    const proxyPath = tmpProxyFile("PROXY_VP8_ALPHA_BYTES", ".webm");
    mocks.resolveProxy.mockResolvedValue(proxyPath);
    const fileContents = new Map<string, Buffer>([
      ["index.html", indexHtml(`<video src="clip.mov" muted></video>`)],
      ["clip.mov", Buffer.from("ORIGINAL_PRORES_4444_BYTES", "utf-8")],
    ]);

    const manifest = await bakeMediaProxies(PROJECT_DIR, fileContents);

    expect(mocks.resolveProxy).toHaveBeenCalledWith(
      PROJECT_DIR,
      join(PROJECT_DIR, "clip.mov"),
      "vp8",
    );
    const proxyEntries = [...fileContents.keys()].filter((key) =>
      key.startsWith(`${PROXY_ARCHIVE_PREFIX}/`),
    );
    expect(proxyEntries).toEqual([`${PROXY_ARCHIVE_PREFIX}/proxy.webm`]);
    expect(fileContents.get(proxyEntries[0]!)?.toString("utf-8")).toBe("PROXY_VP8_ALPHA_BYTES");
    expect(fileContents.get("index.html")?.toString("utf-8")).toContain(proxyEntries[0]!);
    expect(manifest).toEqual({ proxied: ["/clip.mov"], skippedAlpha: [], failed: [] });
  });

  it("returns deterministic manifest ordering across concurrent transcodes", async () => {
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/z.mov": { codecName: "hevc", browserHostile: true, representativeMime: null },
      "/a.mov": { codecName: "hevc", browserHostile: true, representativeMime: null },
    });
    const zProxy = tmpProxyFile("Z");
    const aProxy = tmpProxyFile("A");
    mocks.resolveProxy.mockImplementation(async (_projectDir, sourcePath) =>
      sourcePath.endsWith("z.mov") ? zProxy : aProxy,
    );
    const fileContents = new Map<string, Buffer>([
      ["index.html", indexHtml(`<video src="z.mov"></video>`, `<video src="a.mov"></video>`)],
      ["z.mov", Buffer.from("Z")],
      ["a.mov", Buffer.from("A")],
    ]);

    const manifest = await bakeMediaProxies(PROJECT_DIR, fileContents);

    expect(manifest.proxied).toEqual(["/a.mov", "/z.mov"]);
  });

  it("is a no-op when no asset is browser-hostile", async () => {
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mp4": { codecName: "h264", browserHostile: false, representativeMime: null },
    });

    const fileContents = new Map<string, Buffer>([
      ["index.html", indexHtml(`<video src="clip.mp4" muted></video>`)],
      ["clip.mp4", Buffer.from("ORIGINAL_H264_BYTES", "utf-8")],
    ]);

    await bakeMediaProxies(PROJECT_DIR, fileContents);

    expect(mocks.resolveProxy).not.toHaveBeenCalled();
    expect(fileContents.size).toBe(2);
    expect(fileContents.get("index.html")?.toString("utf-8")).toContain('src="clip.mp4"');
  });

  it("never scans (and is a no-op) when the archive has no HTML entries", async () => {
    const fileContents = new Map<string, Buffer>([["clip.mp4", Buffer.from("BYTES", "utf-8")]]);

    await bakeMediaProxies(PROJECT_DIR, fileContents);

    expect(mocks.scanProjectMediaCodecMap).not.toHaveBeenCalled();
    expect(fileContents.size).toBe(1);
  });
});
