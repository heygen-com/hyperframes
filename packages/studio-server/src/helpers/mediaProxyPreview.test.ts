import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
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
  mediaProxyDemand: typeof import("./mediaCodecMap.js").mediaProxyDemand;
  resolveProxy: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const resolveProxy = vi.fn(async () => "/unused-prewarm-proxy-path");
  vi.doMock("./proxyTranscoder.js", () => ({ resolveProxy, PROXY_PARAMS_VERSION: "v1" }));
  // The real codec table and pre-warm gate; only the ffprobe-backed scan is
  // replaced, so this asserts the shipped policy rather than a copy of it.
  vi.doMock("./mediaCodecMap.js", async () => ({
    ...(await vi.importActual<typeof import("./mediaCodecMap.js")>("./mediaCodecMap.js")),
    scanProjectMediaCodecMap: async () => map,
  }));
  const { injectMediaCodecMapIntoHtml } = await import("./mediaProxyPreview.js");
  const { mediaProxyDemand } = await import("./mediaCodecMap.js");
  return { injectMediaCodecMapIntoHtml, mediaProxyDemand, resolveProxy };
}

/** The pre-warm is fire-and-forget, so let its microtasks run before asserting. */
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

describe("injectMediaCodecMapIntoHtml pre-warm", () => {
  it("pre-warms the unconditionally undecodable codec and leaves the conditional one lazy", async () => {
    const projectDir = tmpProject();
    const { injectMediaCodecMapIntoHtml, resolveProxy } = await loadHelper({
      "/videos/avatar.webm": hostile("vp9", 'video/webm; codecs="vp09.00.10.08"'),
      "/videos/broll.mov": hostile("hevc", 'video/mp4; codecs="hvc1.1.6.L120.B0"'),
    });

    const html = await injectMediaCodecMapIntoHtml(
      "<html><head></head><body></body></html>",
      projectDir,
      [{ html: "<html></html>" }],
    );
    await settle();

    expect(resolveProxy).toHaveBeenCalledTimes(1);
    expect(resolveProxy).toHaveBeenCalledWith(
      projectDir,
      resolve(projectDir, "videos/broll.mov"),
      "h264",
    );
    // Both entries still reach the client: the browser-side canPlayType check
    // owns whether a VP9 asset needs a proxy, and that contract is unchanged.
    expect(html).toContain("/videos/avatar.webm");
    expect(html).toContain("/videos/broll.mov");
  });

  it("counts the pre-warms it starts, and none for a conditional codec", async () => {
    const projectDir = tmpProject();
    const { injectMediaCodecMapIntoHtml, mediaProxyDemand } = await loadHelper({
      "/videos/avatar.webm": hostile("vp9", 'video/webm; codecs="vp09.00.10.08"'),
      "/videos/broll.mov": hostile("hevc", 'video/mp4; codecs="hvc1.1.6.L120.B0"'),
    });

    await injectMediaCodecMapIntoHtml("<html><head></head></html>", projectDir, [
      { html: "<html></html>" },
    ]);
    await settle();

    expect(mediaProxyDemand()).toEqual({ prewarmsRequested: 1, proxyRequests: 0 });
  });

  it("pre-warms ProRes, which no browser decodes at all", async () => {
    const projectDir = tmpProject();
    const { injectMediaCodecMapIntoHtml, resolveProxy } = await loadHelper({
      "/videos/master.mov": hostile("prores", null),
    });

    await injectMediaCodecMapIntoHtml("<html><head></head></html>", projectDir, [
      { html: "<html></html>" },
    ]);
    await settle();

    expect(resolveProxy).toHaveBeenCalledTimes(1);
  });
});
