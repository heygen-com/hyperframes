import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AssetCodecFacts, MediaCodecMap } from "./mediaCodecMap.js";

/**
 * The pre-warm gate. `browserHostile` marks an asset some browser could fail
 * on; it is not a prediction that THIS browser will ask for the substitute.
 * Pre-warming on the weaker predicate spends a full re-encode during the
 * requesting browser's first layout for codecs it decodes natively.
 */

const dirs: string[] = [];

function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-media-proxy-preview-test-"));
  dirs.push(dir);
  return dir;
}

function hostile(codecName: string, representativeMime: string | null): AssetCodecFacts {
  return { codecName, browserHostile: true, representativeMime, hasAlpha: false };
}

async function loadHelper(map: MediaCodecMap): Promise<{
  injectMediaCodecMapIntoHtml: typeof import("./mediaProxyPreview.js").injectMediaCodecMapIntoHtml;
  resolveProxy: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const resolveProxy = vi.fn(async () => "/unused-proxy-path");
  vi.doMock("./proxyTranscoder.js", () => ({ resolveProxy, PROXY_PARAMS_VERSION: "v1" }));
  // The real codec table; only the ffprobe-backed scan is replaced, so this
  // asserts the shipped policy rather than a copy of it.
  vi.doMock("./mediaCodecMap.js", async () => ({
    ...(await vi.importActual<typeof import("./mediaCodecMap.js")>("./mediaCodecMap.js")),
    scanProjectMediaCodecMap: async () => map,
  }));
  const { injectMediaCodecMapIntoHtml } = await import("./mediaProxyPreview.js");
  return { injectMediaCodecMapIntoHtml, resolveProxy };
}

/** Lets any fire-and-forget work queued while serving run before asserting. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./proxyTranscoder.js");
  vi.doUnmock("./mediaCodecMap.js");
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("serving a page", () => {
  it("starts no copy, even for codecs some browsers cannot play: the page asks if it needs one", async () => {
    const projectDir = tmpProject();
    const { injectMediaCodecMapIntoHtml, resolveProxy } = await loadHelper({
      "/videos/avatar.webm": hostile("vp9", 'video/webm; codecs="vp09.00.10.08"'),
      "/videos/broll.mov": hostile("hevc", 'video/mp4; codecs="hvc1.1.6.L120.B0"'),
      "/videos/master.mov": hostile("prores", null),
    });

    const html = await injectMediaCodecMapIntoHtml(
      "<html><head></head><body></body></html>",
      projectDir,
      [{ html: "<html></html>" }],
    );
    await settle();

    expect(resolveProxy).not.toHaveBeenCalled();
    for (const path of ["/videos/avatar.webm", "/videos/broll.mov", "/videos/master.mov"]) {
      expect(html).toContain(path);
    }
  });
});

describe("injectMediaCodecMapIntoHtml placement", () => {
  it("puts the map before the document's own </head>, not inside an inlined script that prints one", async () => {
    const { injectMediaCodecMapIntoHtml } = await loadHelper({
      "/audio/seg01.webm": hostile("vp9", 'video/webm; codecs="vp09.00.10.08"'),
    });
    const vendor = 'p.print("<head>"),p.print("</head>"),p.print("<body>")';

    const html = await injectMediaCodecMapIntoHtml(
      `<html><head><script>${vendor}</script></head><body></body></html>`,
      tmpProject(),
      [{ html: "<html></html>" }],
    );

    expect(html).toContain(`<script>${vendor}</script>`);
    expect(html.indexOf("data-hf-media-codec-map")).toBeGreaterThan(html.indexOf(vendor));
  });
});

describe("seek-only entries", () => {
  const seekOnly: AssetCodecFacts = {
    codecName: "h264",
    browserHostile: false,
    representativeMime: null,
    hasAlpha: false,
    seekHostile: true,
    width: 1920,
    height: 1080,
  };

  it("reach only Studio's preview, the one surface that makes seek copies", async () => {
    const projectDir = tmpProject();
    const map = { "/videos/sparse.mp4": seekOnly, "/videos/broll.mov": hostile("hevc", null) };
    const { injectMediaCodecMapIntoHtml } = await loadHelper(map);
    const { injectMediaCodecMap } = await import("./mediaProxyPreview.js");
    const page = "<html><head></head></html>";

    const elsewhere = await injectMediaCodecMapIntoHtml(page, projectDir, [{ html: page }]);
    const studio = await injectMediaCodecMap(
      page,
      {} as never,
      projectDir,
      "index.html",
      new Map(),
    );

    expect(elsewhere).toContain("/videos/broll.mov");
    expect(elsewhere).not.toContain("/videos/sparse.mp4");
    expect(studio).toContain('"/videos/sparse.mp4":{"codecName":"h264"');
    expect(studio).toContain('"width":1920,"height":1080');
  });
});
