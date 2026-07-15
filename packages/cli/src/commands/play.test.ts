import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { ProjectDir } from "../utils/project.js";

// `registerCompositionRoute` reaches these two studio-server helpers via a
// module, since both files sit at the same depth under packages/cli/src/.
//
// The error class lives inside this `vi.hoisted` block (not a plain top-level
// `class`) because `vi.mock` factories run during static-import resolution —
// before any of the test file's own top-level statements execute — so a
// `class` declared below would still be in its temporal dead zone.
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
    resolveProxy: vi.fn<(projectDir: string, absoluteSourcePath: string) => Promise<string>>(
      // Benign default so `injectMediaCodecMap`'s fire-and-forget pre-warm
      // (called for every hostile map entry) always gets a promise to
      // `.catch()`, even in tests that don't care about the proxy path.
      async () => "/unused-prewarm-proxy-path",
    ),
    scanProjectMediaCodecMap: vi.fn<
      (
        ...args: unknown[]
      ) => Promise<
        Record<
          string,
          { codecName: string; browserHostile: boolean; representativeMime: string | null }
        >
      >
    >(async () => ({})),
    ProxyTranscodeError: FakeProxyTranscodeError,
  };
});
const FakeProxyTranscodeError = mocks.ProxyTranscodeError;

vi.mock("@hyperframes/studio-server/proxy-transcoder", () => ({
  resolveProxy: mocks.resolveProxy,
  ProxyTranscodeError: mocks.ProxyTranscodeError,
}));

// The shared injection helper ships as a self-contained dist bundle (its copy
// of scanProjectMediaCodecMap is inlined), so it must be mocked wholesale —
// mocking the media-codec-map subpath can't reach inside it. The fake mirrors
// the real contract (scan → inject tag) via this file's scan mock so the
// existing injection assertions stay meaningful.
vi.mock("@hyperframes/studio-server/media-proxy-preview", () => ({
  injectMediaCodecMapIntoHtml: vi.fn(
    async (html: string, projectDir: string, htmlSources: unknown[]) => {
      const map = await mocks.scanProjectMediaCodecMap(projectDir, htmlSources);
      const tag = `<script data-hf-media-codec-map>window.__HF_MEDIA_CODEC_MAP__=${JSON.stringify(map)};</script>`;
      return html.includes("</head>")
        ? html.replace("</head>", `${tag}\n</head>`)
        : `${tag}\n${html}`;
    },
  ),
}));

const { registerCompositionRoute } = await import("./play.js");

let dir: string | undefined;

function tmpProject(): ProjectDir {
  dir = mkdtempSync(join(tmpdir(), "hf-play-test-"));
  return { dir, name: "test-project", indexPath: join(dir, "index.html") };
}

afterEach(() => {
  mocks.resolveProxy.mockReset();
  mocks.resolveProxy.mockResolvedValue("/unused-prewarm-proxy-path");
  mocks.scanProjectMediaCodecMap.mockReset();
  mocks.scanProjectMediaCodecMap.mockResolvedValue({});
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function buildApp(project: ProjectDir, autoProxy: boolean): Promise<Hono> {
  const app = new Hono();
  await registerCompositionRoute(app, project, autoProxy);
  return app;
}

describe("registerCompositionRoute", () => {
  it("answers a Range request on a plain asset with 206 + the requested byte slice", async () => {
    const project = tmpProject();
    writeFileSync(join(project.dir, "clip.mp4"), Buffer.from("0123456789", "utf-8"));
    const app = await buildApp(project, true);

    const res = await app.request("/composition/clip.mp4", { headers: { Range: "bytes=2-5" } });

    expect(res.status).toBe(206);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await res.text()).toBe("2345");
  });

  it("serves the resolved proxy's bytes for ?hf-proxy=h264 on a hostile asset", async () => {
    const project = tmpProject();
    writeFileSync(join(project.dir, "clip.mp4"), "original-hevc-bytes");
    const proxyPath = join(project.dir, "proxy.mp4");
    writeFileSync(proxyPath, "transcoded-h264-bytes");
    mocks.resolveProxy.mockResolvedValue(proxyPath);
    const app = await buildApp(project, true);

    const res = await app.request("/composition/clip.mp4?hf-proxy=h264");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("transcoded-h264-bytes");
    expect(mocks.resolveProxy).toHaveBeenCalledWith(project.dir, join(project.dir, "clip.mp4"));
  });

  it("serves ?hf-proxy=h264 for a .mov hostile asset as Content-Type video/mp4 (the proxy IS mp4)", async () => {
    const project = tmpProject();
    writeFileSync(join(project.dir, "clip.mov"), "original-prores-bytes");
    const proxyPath = join(project.dir, "proxy.mp4");
    writeFileSync(proxyPath, "transcoded-h264-bytes");
    mocks.resolveProxy.mockResolvedValue(proxyPath);
    const app = await buildApp(project, true);

    const res = await app.request("/composition/clip.mov?hf-proxy=h264");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(await res.text()).toBe("transcoded-h264-bytes");
  });

  it("answers 502 (not a silent failure) when the proxy transcode fails", async () => {
    const project = tmpProject();
    writeFileSync(join(project.dir, "clip.mp4"), "original-hevc-bytes");
    mocks.resolveProxy.mockRejectedValue(
      new FakeProxyTranscodeError("ffmpeg exited with code 1", 1),
    );
    const app = await buildApp(project, true);

    const res = await app.request("/composition/clip.mp4?hf-proxy=h264");

    expect(res.status).toBe(502);
  });

  it("404s ?hf-proxy=h264 for a non-video asset without attempting a transcode", async () => {
    const project = tmpProject();
    writeFileSync(join(project.dir, "image.png"), "not-a-video");
    const app = await buildApp(project, true);

    const res = await app.request("/composition/image.png?hf-proxy=h264");

    expect(res.status).toBe(404);
    expect(mocks.resolveProxy).not.toHaveBeenCalled();
  });

  it("injects __HF_MEDIA_CODEC_MAP__ into served composition HTML", async () => {
    const project = tmpProject();
    writeFileSync(join(project.dir, "index.html"), "<html><head></head><body></body></html>");
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mp4": {
        codecName: "hevc",
        browserHostile: true,
        representativeMime: 'video/mp4; codecs="hvc1.1.6.L120.B0"',
      },
    });
    const app = await buildApp(project, true);

    const res = await app.request("/composition/index.html");
    const html = await res.text();

    expect(html).toContain("__HF_MEDIA_CODEC_MAP__");
    expect(html).toContain("/clip.mp4");
  });

  it("opt-out (autoProxy=false) skips codec-map injection and 404s the proxy param", async () => {
    const project = tmpProject();
    writeFileSync(join(project.dir, "index.html"), "<html><head></head><body></body></html>");
    writeFileSync(join(project.dir, "clip.mp4"), "original-hevc-bytes");
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mp4": { codecName: "hevc", browserHostile: true, representativeMime: null },
    });
    const app = await buildApp(project, false);

    const htmlRes = await app.request("/composition/index.html");
    expect(await htmlRes.text()).not.toContain("__HF_MEDIA_CODEC_MAP__");
    expect(mocks.scanProjectMediaCodecMap).not.toHaveBeenCalled();

    const proxyRes = await app.request("/composition/clip.mp4?hf-proxy=h264");
    expect(proxyRes.status).toBe(404);
    expect(mocks.resolveProxy).not.toHaveBeenCalled();
  });
});
