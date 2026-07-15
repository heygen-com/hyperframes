import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    scanProjectMediaCodecMap:
      vi.fn<
        (
          ...args: unknown[]
        ) => Promise<
          Record<
            string,
            { codecName: string; browserHostile: boolean; representativeMime: string | null }
          >
        >
      >(),
    ProxyTranscodeError: FakeProxyTranscodeError,
  };
});
const FakeProxyTranscodeError = mocks.ProxyTranscodeError;

vi.mock("@hyperframes/studio-server/proxy-transcoder", () => ({
  resolveProxy: mocks.resolveProxy,
  ProxyTranscodeError: mocks.ProxyTranscodeError,
}));

vi.mock("@hyperframes/studio-server/media-codec-map", () => ({
  scanProjectMediaCodecMap: mocks.scanProjectMediaCodecMap,
}));

const { bakeMediaProxies, PROXY_ARCHIVE_PREFIX } = await import("./publishProxyBake.js");

// No real project directory is touched: `scanProjectMediaCodecMap` (which
// would otherwise walk `projectDir`) and `resolveProxy` (which would
// transcode from it) are both mocked above, mirroring `checkBrowser.test.ts`'s
// `PROJECT: ProjectDir = { dir: "/project", ... }` fixture.
const PROJECT_DIR = "/project";

const tempDirs: string[] = [];
function tmpProxyFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-publish-proxy-bake-"));
  tempDirs.push(dir);
  const path = join(dir, "proxy.mp4");
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

    await bakeMediaProxies(PROJECT_DIR, fileContents);

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

    expect(mocks.resolveProxy).toHaveBeenCalledWith(PROJECT_DIR, join(PROJECT_DIR, "clip.mp4"));
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

  it("skips an asset whose transcode fails, warns, and still leaves the archive buildable", async () => {
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mp4": { codecName: "hevc", browserHostile: true, representativeMime: "video/mp4" },
    });
    mocks.resolveProxy.mockRejectedValue(new FakeProxyTranscodeError("ffmpeg exited with code 1"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const fileContents = new Map<string, Buffer>([
      ["index.html", indexHtml(`<video src="clip.mp4" muted></video>`)],
      ["clip.mp4", Buffer.from("ORIGINAL_HEVC_BYTES", "utf-8")],
    ]);

    await expect(bakeMediaProxies(PROJECT_DIR, fileContents)).resolves.toBeUndefined();

    expect([...fileContents.keys()].some((k) => k.startsWith(`${PROXY_ARCHIVE_PREFIX}/`))).toBe(
      false,
    );
    expect(fileContents.get("index.html")?.toString("utf-8")).toContain('src="clip.mp4"');
    expect(fileContents.get("clip.mp4")?.toString("utf-8")).toBe("ORIGINAL_HEVC_BYTES");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("clip.mp4");

    warnSpy.mockRestore();
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
