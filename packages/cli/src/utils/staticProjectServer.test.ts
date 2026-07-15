import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveStaticProjectHtml, type StaticProjectServer } from "./staticProjectServer.js";

// `serveStaticProjectHtml` reaches these two studio-server helpers via a
// absolute module regardless of which file's relative specifier reaches it).
//
// The error class lives inside this `vi.hoisted` block (not a plain top-level
// `class`) because `vi.mock` factories run during static-import resolution —
// before any of this file's own top-level statements execute — so a `class`
// declared below would still be in its temporal dead zone.
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

vi.mock("@hyperframes/studio-server/media-codec-map", () => ({
  scanProjectMediaCodecMap: mocks.scanProjectMediaCodecMap,
}));

let server: StaticProjectServer | undefined;
let dir: string | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  mocks.resolveProxy.mockReset();
  mocks.resolveProxy.mockResolvedValue("/unused-prewarm-proxy-path");
  mocks.scanProjectMediaCodecMap.mockReset();
  mocks.scanProjectMediaCodecMap.mockResolvedValue({});
});

async function serveWith(bytes: Buffer): Promise<{ url: string }> {
  dir = mkdtempSync(join(tmpdir(), "hf-static-"));
  writeFileSync(join(dir, "tone.wav"), bytes);
  server = await serveStaticProjectHtml(dir, "<html></html>");
  return { url: server.url };
}

describe("serveStaticProjectHtml range support", () => {
  it("answers a Range request with 206 + the requested byte slice", async () => {
    // Chromium needs byte-range seekability or WAV `.duration` reports Infinity,
    // which makes `hyperframes validate` falsely warn it cannot read the duration.
    const body = Buffer.from("0123456789", "utf-8");
    const { url } = await serveWith(body);

    const res = await fetch(`${url}tone.wav`, { headers: { Range: "bytes=2-5" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-range")).toBe(`bytes 2-5/${body.length}`);
    expect(await res.text()).toBe("2345");
  });

  it("advertises Accept-Ranges even on a full 200 response", async () => {
    const { url } = await serveWith(Buffer.from("abcdef", "utf-8"));
    const res = await fetch(`${url}tone.wav`);
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(await res.text()).toBe("abcdef");
  });

  it("streams a small slice out of a large file without buffering the whole thing", async () => {
    // 8MB file, ask for 4 bytes deep inside it. The handler must createReadStream
    // the [start,end] window only, not readFileSync the whole 8MB and slice.
    const size = 8 * 1024 * 1024;
    const big = Buffer.alloc(size, 0x61); // 'a' everywhere...
    big.write("WXYZ", 5_000_000); // ...except a 4-byte marker
    const { url } = await serveWith(big);

    const res = await fetch(`${url}tone.wav`, { headers: { Range: "bytes=5000000-5000003" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 5000000-5000003/${size}`);
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("WXYZ");
  });

  it("returns 416 for an unsatisfiable range", async () => {
    const body = Buffer.from("abc", "utf-8");
    const { url } = await serveWith(body);
    const res = await fetch(`${url}tone.wav`, { headers: { Range: "bytes=99-200" } });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${body.length}`);
  });
});

describe("serveStaticProjectHtml asset roots", () => {
  const extraDirs: string[] = [];
  const mk = (): string => {
    const d = mkdtempSync(join(tmpdir(), "hf-static-root-"));
    extraDirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of extraDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("serves files from an extra asset root when the project dir lacks them", async () => {
    // extra root (e.g. localized-assets temp dir) resolves same-origin
    const projectDir = mk();
    const assetDir = mk();
    mkdirSync(join(assetDir, "_remote_media"), { recursive: true });
    writeFileSync(join(assetDir, "_remote_media", "img.jpg"), "PIXELS");
    server = await serveStaticProjectHtml(projectDir, "<html></html>", undefined, [assetDir]);

    const res = await fetch(`${server.url}_remote_media/img.jpg`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PIXELS");
  });

  it("prefers the project dir over an asset root for the same path", async () => {
    const projectDir = mk();
    const assetDir = mk();
    writeFileSync(join(projectDir, "a.txt"), "PROJECT");
    writeFileSync(join(assetDir, "a.txt"), "ASSET");
    server = await serveStaticProjectHtml(projectDir, "<html></html>", undefined, [assetDir]);

    const res = await fetch(`${server.url}a.txt`);
    expect(await res.text()).toBe("PROJECT");
  });

  it("404s a path present in no root", async () => {
    const projectDir = mk();
    server = await serveStaticProjectHtml(projectDir, "<html></html>", undefined, [mk()]);
    const res = await fetch(`${server.url}nope.txt`);
    expect(res.status).toBe(404);
  });
});

describe("serveStaticProjectHtml transparent media proxies", () => {
  const dirs: string[] = [];
  const mk = (): string => {
    const d = mkdtempSync(join(tmpdir(), "hf-static-proxy-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("injects __HF_MEDIA_CODEC_MAP__ into the served HTML", async () => {
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mp4": { codecName: "hevc", browserHostile: true, representativeMime: null },
    });
    const projectDir = mk();
    server = await serveStaticProjectHtml(projectDir, "<html><head></head><body></body></html>");

    const res = await fetch(server.url);
    const html = await res.text();
    expect(html).toContain("__HF_MEDIA_CODEC_MAP__");
    expect(html).toContain("/clip.mp4");
  });

  it("serves the resolved proxy's bytes for ?hf-proxy=h264 on a hostile video asset", async () => {
    const projectDir = mk();
    writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
    const proxyPath = join(projectDir, "proxy.mp4");
    writeFileSync(proxyPath, "transcoded-h264-bytes");
    mocks.resolveProxy.mockResolvedValue(proxyPath);
    server = await serveStaticProjectHtml(projectDir, "<html></html>");

    const res = await fetch(`${server.url}clip.mp4?hf-proxy=h264`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("transcoded-h264-bytes");
    expect(mocks.resolveProxy).toHaveBeenCalledWith(projectDir, join(projectDir, "clip.mp4"));
  });

  it("answers 502 when the proxy transcode fails", async () => {
    const projectDir = mk();
    writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
    mocks.resolveProxy.mockRejectedValue(
      new FakeProxyTranscodeError("ffmpeg exited with code 1", 1),
    );
    server = await serveStaticProjectHtml(projectDir, "<html></html>");

    const res = await fetch(`${server.url}clip.mp4?hf-proxy=h264`);
    expect(res.status).toBe(502);
  });

  it("404s ?hf-proxy=h264 for a non-video asset without attempting a transcode", async () => {
    const projectDir = mk();
    writeFileSync(join(projectDir, "image.png"), "not-a-video");
    server = await serveStaticProjectHtml(projectDir, "<html></html>");

    const res = await fetch(`${server.url}image.png?hf-proxy=h264`);
    expect(res.status).toBe(404);
    expect(mocks.resolveProxy).not.toHaveBeenCalled();
  });
});
