import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path, { join } from "node:path";
import { tmpdir } from "node:os";
import {
  closeFileServerSafely,
  createFileServer,
  HF_BRIDGE_SCRIPT,
  HF_EARLY_STUB,
  injectScriptsAtHeadStart,
  isPathInside,
  parseRangeHeader,
  VIRTUAL_TIME_SHIM,
} from "./fileServer.js";

function captureLogger() {
  const warnings: { message: string; meta?: Record<string, unknown> }[] = [];
  return {
    warnings,
    log: {
      error() {},
      warn(message: string, meta?: Record<string, unknown>) {
        warnings.push({ message, meta });
      },
      info() {},
      debug() {},
    },
  };
}

describe("closeFileServerSafely", () => {
  it("swallows and logs a throwing close instead of propagating", () => {
    const { log, warnings } = captureLogger();
    const fileServer = {
      close: () => {
        // http.Server.close() throws ERR_SERVER_NOT_RUNNING on a second close.
        throw new Error("Server is not running.");
      },
    };
    expect(() => closeFileServerSafely(fileServer, "plan", log)).not.toThrow();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("[plan]");
    expect(warnings[0].meta?.error).toBe("Server is not running.");
  });

  it("closes once and stays quiet on the happy path", () => {
    const { log, warnings } = captureLogger();
    let closed = 0;
    closeFileServerSafely({ close: () => closed++ }, "renderChunk", log);
    expect(closed).toBe(1);
    expect(warnings).toHaveLength(0);
  });
});

async function withFileServer(
  projectDir: string,
  run: (server: Awaited<ReturnType<typeof createFileServer>>) => Promise<void>,
): Promise<void> {
  const server = await createFileServer({
    projectDir,
    preHeadScripts: [],
    headScripts: [],
    bodyScripts: [],
  });
  try {
    await run(server);
  } finally {
    server.close();
  }
}

function writeEmptyIndex(projectDir: string): void {
  writeFileSync(join(projectDir, "index.html"), "<!doctype html><html></html>");
}

async function expectTextResponse(
  url: string,
  options: { contentType?: string; bodyIncludes: string },
): Promise<void> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  if (options.contentType) {
    expect(response.headers.get("content-type")).toContain(options.contentType);
  }
  expect(await response.text()).toContain(options.bodyIncludes);
}

describe("injectScriptsIntoHtml", () => {
  it("injects the virtual time shim into head content before authored scripts", () => {
    const html = `<!DOCTYPE html>
<html>
<head><script>window.__order = ["authored-head"];</script></head>
<body><script>window.__order.push("authored-body");</script></body>
</html>`;

    const injected = injectScriptsAtHeadStart(html, [VIRTUAL_TIME_SHIM]);
    const injectedShimTag = `<script>${VIRTUAL_TIME_SHIM}</script>`;
    const authoredHeadTag = `<script>window.__order = ["authored-head"];</script>`;

    expect(injected.indexOf(injectedShimTag)).toBeGreaterThanOrEqual(0);
    expect(injected.indexOf(injectedShimTag)).toBeLessThan(injected.indexOf(authoredHeadTag));
  });

  it("supports iframe html by injecting pre-head scripts without body scripts", () => {
    const html =
      "<!DOCTYPE html><html><head></head><body><script>window.targetLoaded = true;</script></body></html>";

    const preInjected = injectScriptsAtHeadStart(html, [VIRTUAL_TIME_SHIM]);
    const final = preInjected;

    expect(final).toContain(VIRTUAL_TIME_SHIM);
    expect(final).not.toContain("bodyOnly = true");
  });

  it("propagates virtual time seeks into same-origin iframe documents", () => {
    expect(HF_BRIDGE_SCRIPT).toContain("function seekSameOriginChildFrames");
    expect(HF_BRIDGE_SCRIPT).toContain("childWindow.__HF_VIRTUAL_TIME__.seekToTime(nextTimeMs)");
    expect(HF_BRIDGE_SCRIPT).toContain("seekSameOriginChildFrames(window, nextTimeMs)");
  });
});

describe("isPathInside", () => {
  it("returns true when the child equals the parent", () => {
    expect(isPathInside("/tmp/project", "/tmp/project")).toBe(true);
  });

  it("returns true for direct children", () => {
    expect(isPathInside("/tmp/project/index.html", "/tmp/project")).toBe(true);
  });

  it("returns true for deeply nested descendants", () => {
    expect(isPathInside("/tmp/project/a/b/c/file.html", "/tmp/project")).toBe(true);
  });

  it("rejects siblings with a shared name prefix", () => {
    // The classic prefix-bug: "/foo" should NOT contain "/foobar/x". A naive
    // startsWith check without a trailing separator would incorrectly accept
    // this as nested.
    expect(isPathInside("/tmp/projectile/a", "/tmp/project")).toBe(false);
    expect(isPathInside("/tmp/project-other/a", "/tmp/project")).toBe(false);
  });

  it("rejects paths outside the parent entirely", () => {
    expect(isPathInside("/etc/passwd", "/tmp/project")).toBe(false);
    expect(isPathInside("/tmp/other/file.html", "/tmp/project")).toBe(false);
  });

  it("rejects path-traversal attempts that escape the parent", () => {
    // path.join("/tmp/project", "../etc/passwd") normalizes to "/tmp/etc/passwd"
    // — outside the project root. The whole point of isPathInside is to catch
    // exactly this after the join.
    expect(isPathInside("/tmp/etc/passwd", "/tmp/project")).toBe(false);
    expect(isPathInside("/tmp/project/../etc/passwd", "/tmp/project")).toBe(false);
  });

  it("accepts traversal that resolves back inside the parent", () => {
    expect(isPathInside("/tmp/project/sub/../index.html", "/tmp/project")).toBe(true);
  });

  it("treats parents with and without trailing slashes the same", () => {
    expect(isPathInside("/tmp/project/index.html", "/tmp/project/")).toBe(true);
    expect(isPathInside("/tmp/project/index.html", "/tmp/project")).toBe(true);
  });

  it("resolves relative paths against the current working directory", () => {
    // Both sides resolve against cwd, so a relative file under a relative dir
    // should be considered nested. We don't assert the absolute path; we just
    // check the containment relationship holds after resolution.
    expect(isPathInside("a/b/c.html", "a/b")).toBe(true);
    expect(isPathInside("a/b/../../c.html", "a/b")).toBe(false);
  });

  it("rejects symlink escapes when realpath enforcement is enabled", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "hf-file-server-root-"));
    const outsideDir = mkdtempSync(join(tmpdir(), "hf-file-server-outside-"));
    const outsideFile = join(outsideDir, "secret.txt");
    const symlinkPath = join(rootDir, "escaped.txt");

    try {
      writeFileSync(outsideFile, "secret");
      symlinkSync(outsideFile, symlinkPath);

      expect(isPathInside(symlinkPath, rootDir)).toBe(true);
      expect(isPathInside(symlinkPath, rootDir, { resolveSymlinks: true })).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  describe("with path.win32 (cross-platform pinning tests)", () => {
    // Pin Windows-path semantics on Linux/macOS CI by injecting the win32
    // path module. Without this, accidental Unix-only assumptions (e.g. only
    // splitting on "/") would silently regress for Windows users.
    const win32 = { pathModule: path.win32 };

    it("returns true when the child equals the parent", () => {
      expect(isPathInside("C:\\foo", "C:\\foo", win32)).toBe(true);
    });

    it("returns true for direct children", () => {
      expect(isPathInside("C:\\foo\\bar", "C:\\foo", win32)).toBe(true);
    });

    it("returns true for deeply nested descendants", () => {
      expect(isPathInside("C:\\foo\\a\\b\\c.html", "C:\\foo", win32)).toBe(true);
    });

    it("rejects siblings with a shared name prefix", () => {
      expect(isPathInside("C:\\foobar\\x", "C:\\foo", win32)).toBe(false);
      expect(isPathInside("C:\\foo-other\\x", "C:\\foo", win32)).toBe(false);
    });

    it("rejects path-traversal attempts that escape the parent", () => {
      expect(isPathInside("C:\\foo\\..\\etc\\passwd", "C:\\foo", win32)).toBe(false);
    });

    it("treats parents with and without trailing backslashes the same", () => {
      expect(isPathInside("C:\\foo\\bar", "C:\\foo\\", win32)).toBe(true);
      expect(isPathInside("C:\\foo\\bar", "C:\\foo", win32)).toBe(true);
    });

    it("rejects paths on a different drive letter", () => {
      expect(isPathInside("D:\\foo\\bar", "C:\\foo", win32)).toBe(false);
    });
  });
});

describe("parseRangeHeader", () => {
  const SIZE = 1000;

  it("returns absent when there is no Range header", () => {
    expect(parseRangeHeader(undefined, SIZE)).toEqual({ kind: "absent" });
    expect(parseRangeHeader(null, SIZE)).toEqual({ kind: "absent" });
    expect(parseRangeHeader("", SIZE)).toEqual({ kind: "absent" });
  });

  it("parses a closed range bytes=START-END", () => {
    expect(parseRangeHeader("bytes=0-99", SIZE)).toEqual({
      kind: "satisfiable",
      start: 0,
      end: 99,
    });
    expect(parseRangeHeader("bytes=100-199", SIZE)).toEqual({
      kind: "satisfiable",
      start: 100,
      end: 199,
    });
  });

  it("parses an open-ended range bytes=START- as start..EOF", () => {
    expect(parseRangeHeader("bytes=100-", SIZE)).toEqual({
      kind: "satisfiable",
      start: 100,
      end: SIZE - 1,
    });
    expect(parseRangeHeader("bytes=0-", SIZE)).toEqual({
      kind: "satisfiable",
      start: 0,
      end: SIZE - 1,
    });
  });

  it("parses a suffix range bytes=-N as the last N bytes", () => {
    expect(parseRangeHeader("bytes=-50", SIZE)).toEqual({
      kind: "satisfiable",
      start: SIZE - 50,
      end: SIZE - 1,
    });
    // Suffix larger than the file: clamp to the whole file.
    expect(parseRangeHeader("bytes=-5000", SIZE)).toEqual({
      kind: "satisfiable",
      start: 0,
      end: SIZE - 1,
    });
  });

  it("clamps the end of a closed range to the last valid byte", () => {
    // bytes=900-9999 on a 1000-byte file -> serve 900..999.
    expect(parseRangeHeader("bytes=900-9999", SIZE)).toEqual({
      kind: "satisfiable",
      start: 900,
      end: SIZE - 1,
    });
  });

  it("returns unsatisfiable when start >= size", () => {
    expect(parseRangeHeader("bytes=1000-2000", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=2000-", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("returns unsatisfiable when end < start in a closed range", () => {
    expect(parseRangeHeader("bytes=200-100", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("returns unsatisfiable for a suffix request on a zero-byte file", () => {
    expect(parseRangeHeader("bytes=-10", 0)).toEqual({ kind: "unsatisfiable" });
  });

  it("returns absent for non-bytes units, multi-range, and malformed inputs", () => {
    expect(parseRangeHeader("items=0-1", SIZE)).toEqual({ kind: "absent" });
    expect(parseRangeHeader("bytes=0-99,200-299", SIZE)).toEqual({ kind: "absent" });
    expect(parseRangeHeader("bytes=abc-def", SIZE)).toEqual({ kind: "absent" });
    expect(parseRangeHeader("bytes=", SIZE)).toEqual({ kind: "absent" });
    expect(parseRangeHeader("bytes=-", SIZE)).toEqual({ kind: "absent" });
  });

  it("tolerates surrounding whitespace and case", () => {
    expect(parseRangeHeader(" Bytes = 0-99 ", SIZE)).toEqual({
      kind: "satisfiable",
      start: 0,
      end: 99,
    });
  });
});

describe("createFileServer", () => {
  async function expectInjectedRenderFps(
    fps: Parameters<typeof createFileServer>[0]["fps"],
    expected: {
      value: string;
      source: "render-options" | "default";
      fallbackReason?: "missing" | "invalid";
    },
  ): Promise<void> {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-file-server-render-fps-"));

    try {
      writeEmptyIndex(projectDir);
      const server = await createFileServer({
        projectDir,
        preHeadScripts: [],
        headScripts: [],
        ...(fps ? { fps } : {}),
      });
      try {
        const response = await fetch(`${server.url}/index.html`);
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain("window.__HF_EXPORT_RENDER_SEEK_CONFIG");
        expect(html).toContain(`var __renderFps = ${expected.value}`);
        expect(html).toContain(`var __renderFpsSource = "${expected.source}"`);
        if (expected.fallbackReason) {
          expect(html).toContain(`var __renderFpsFallbackReason = "${expected.fallbackReason}"`);
        } else {
          expect(html).toContain("var __renderFpsFallbackReason = null");
        }
        expect(html).toContain("fps: __renderFps");
        expect(html).toContain("fpsSource: __renderFpsSource");
        expect(html).not.toContain("[hyperframes] render fps defaulted");
      } finally {
        server.close();
      }
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  }

  it("injects the requested render fps into the page render config", async () => {
    await expectInjectedRenderFps({ num: 60, den: 1 }, { value: "60", source: "render-options" });
  });

  it("injects fractional render fps without rounding", async () => {
    await expectInjectedRenderFps(
      { num: 24000, den: 1001 },
      { value: "23.976023976023978", source: "render-options" },
    );
  });

  it("marks missing render fps as an explicit 30fps default", async () => {
    await expectInjectedRenderFps(undefined, {
      value: "30",
      source: "default",
      fallbackReason: "missing",
    });
  });

  it("marks invalid render fps as an explicit 30fps default", async () => {
    await expectInjectedRenderFps(
      { num: 60, den: 0 },
      {
        value: "30",
        source: "default",
        fallbackReason: "invalid",
      },
    );
  });

  it("serves asset files through project-root symlinked directories", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "hf-file-server-symlink-assets-"));
    const adsDir = join(workspaceDir, "Ads");
    const projectDir = join(adsDir, "annual-upsell-2");
    const sharedDir = join(adsDir, "shared");

    try {
      mkdirSync(projectDir, { recursive: true });
      mkdirSync(sharedDir, { recursive: true });
      writeEmptyIndex(projectDir);
      writeFileSync(
        join(sharedDir, "brand.css"),
        ".aisplus-glass { backdrop-filter: blur(28px); }",
      );
      symlinkSync("../shared", join(projectDir, "shared"));

      await withFileServer(projectDir, async (server) => {
        await expectTextResponse(`${server.url}/shared/brand.css`, {
          contentType: "text/css",
          bodyIncludes: ".aisplus-glass",
        });
      });
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("streams binary file content without buffering through readFileSync", async () => {
    // Regression test for the video-heavy event-loop block documented at
    // renderOrchestrator.ts:1277-1306. Pre-fix the file route called
    // readFileSync on every binary asset, which on 32MB+ videos stalled
    // the Node event loop long enough to wedge concurrent /health probes.
    // This test pins three properties of the streaming path:
    //
    //   1. Correctness: the served byte sequence matches the file exactly,
    //      across a chunk boundary (we use a 5 MB synthetic asset, well past
    //      Node's default 64KB createReadStream highWaterMark).
    //   2. Content-Length is reported via statSync so range-aware HTTP
    //      consumers (Chrome's media stack) see the size up front.
    //   3. Concurrent requests don't serialize behind each other — N
    //      parallel fetches all return identical content. With readFileSync
    //      they'd block the event loop in serial; with the stream they
    //      pipe interleaved chunks.
    const projectDir = mkdtempSync(join(tmpdir(), "hf-file-server-stream-"));
    try {
      writeEmptyIndex(projectDir);
      // 5 MB of deterministic bytes — large enough to span many 64KB read
      // chunks, small enough to keep the test fast.
      const size = 5 * 1024 * 1024;
      const buf = Buffer.alloc(size);
      for (let i = 0; i < size; i++) buf[i] = i & 0xff;
      writeFileSync(join(projectDir, "big.bin"), buf);

      await withFileServer(projectDir, async (server) => {
        // Single-request correctness + content-length.
        const r = await fetch(`${server.url}/big.bin`);
        expect(r.status).toBe(200);
        expect(r.headers.get("content-length")).toBe(String(size));
        const out = Buffer.from(await r.arrayBuffer());
        expect(out.length).toBe(size);
        // Spot-check a few sentinel positions (full equality check is O(5MB)
        // and unnecessary — if any chunk were misaligned we'd see it here).
        expect(out[0]).toBe(0);
        expect(out[255]).toBe(255);
        expect(out[256]).toBe(0);
        expect(out[size - 1]).toBe((size - 1) & 0xff);

        // Concurrent requests don't corrupt each other.
        const concurrent = await Promise.all(
          Array.from({ length: 4 }, () => fetch(`${server.url}/big.bin`)),
        );
        for (const resp of concurrent) {
          expect(resp.status).toBe(200);
          const body = Buffer.from(await resp.arrayBuffer());
          expect(body.length).toBe(size);
          expect(body[0]).toBe(0);
          expect(body[size - 1]).toBe((size - 1) & 0xff);
        }
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("serves Range requests with 206 Partial Content + Accept-Ranges", async () => {
    // Pins the RFC 7233 implementation for the binary path: Chrome's <video>
    // element issues `Range: bytes=...` when seeking, and the response must
    // be 206 with `Content-Range` + a sliced body so the player can resume
    // partial-load without re-pulling the whole file. Also pins that the
    // server advertises `Accept-Ranges: bytes` on full-body GETs so clients
    // know future Range requests are supported.
    const projectDir = mkdtempSync(join(tmpdir(), "hf-file-server-range-"));
    try {
      writeEmptyIndex(projectDir);
      // Use a 4 KB deterministic asset: small enough to keep the test
      // fast, large enough that suffix / partial responses exercise the
      // slicing math meaningfully.
      const size = 4096;
      const buf = Buffer.alloc(size);
      for (let i = 0; i < size; i++) buf[i] = i & 0xff;
      writeFileSync(join(projectDir, "asset.bin"), buf);

      await withFileServer(projectDir, async (server) => {
        // 1. Full GET advertises Accept-Ranges: bytes.
        const full = await fetch(`${server.url}/asset.bin`);
        expect(full.status).toBe(200);
        expect(full.headers.get("accept-ranges")).toBe("bytes");
        expect(full.headers.get("content-length")).toBe(String(size));
        await full.body?.cancel();

        // 2. Closed range: bytes=0-99 returns the first 100 bytes.
        const head = await fetch(`${server.url}/asset.bin`, {
          headers: { Range: "bytes=0-99" },
        });
        expect(head.status).toBe(206);
        expect(head.headers.get("content-range")).toBe(`bytes 0-99/${size}`);
        expect(head.headers.get("content-length")).toBe("100");
        expect(head.headers.get("accept-ranges")).toBe("bytes");
        const headBody = Buffer.from(await head.arrayBuffer());
        expect(headBody.length).toBe(100);
        expect(headBody[0]).toBe(0);
        expect(headBody[99]).toBe(99);

        // 3. Open-ended: bytes=4000- returns the tail.
        const tail = await fetch(`${server.url}/asset.bin`, {
          headers: { Range: "bytes=4000-" },
        });
        expect(tail.status).toBe(206);
        expect(tail.headers.get("content-range")).toBe(`bytes 4000-${size - 1}/${size}`);
        expect(tail.headers.get("content-length")).toBe(String(size - 4000));
        const tailBody = Buffer.from(await tail.arrayBuffer());
        expect(tailBody.length).toBe(size - 4000);
        expect(tailBody[0]).toBe(4000 & 0xff);
        expect(tailBody[tailBody.length - 1]).toBe((size - 1) & 0xff);

        // 4. Suffix: bytes=-50 returns the last 50 bytes.
        const suffix = await fetch(`${server.url}/asset.bin`, {
          headers: { Range: "bytes=-50" },
        });
        expect(suffix.status).toBe(206);
        expect(suffix.headers.get("content-range")).toBe(`bytes ${size - 50}-${size - 1}/${size}`);
        expect(suffix.headers.get("content-length")).toBe("50");
        const suffixBody = Buffer.from(await suffix.arrayBuffer());
        expect(suffixBody.length).toBe(50);
        expect(suffixBody[0]).toBe((size - 50) & 0xff);
        expect(suffixBody[49]).toBe((size - 1) & 0xff);

        // 5. Unsatisfiable: bytes=99999-99999 returns 416 with
        //    Content-Range: bytes */<size> per RFC 7233 §4.4.
        const bad = await fetch(`${server.url}/asset.bin`, {
          headers: { Range: "bytes=99999-99999" },
        });
        expect(bad.status).toBe(416);
        expect(bad.headers.get("content-range")).toBe(`bytes */${size}`);
        expect(bad.headers.get("accept-ranges")).toBe("bytes");
        await bad.body?.cancel();

        // 6. Multi-range falls back to 200 (we don't reassemble
        //    multipart/byteranges for the single-asset use case).
        const multi = await fetch(`${server.url}/asset.bin`, {
          headers: { Range: "bytes=0-9,20-29" },
        });
        expect(multi.status).toBe(200);
        expect(multi.headers.get("accept-ranges")).toBe("bytes");
        await multi.body?.cancel();
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("decodes percent-encoded reserved characters in URL path segments", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-file-server-reserved-chars-"));

    try {
      const subDir = join(projectDir, "video#1");
      mkdirSync(subDir, { recursive: true });
      writeEmptyIndex(projectDir);
      writeFileSync(join(subDir, "frame.jpg"), "fake-jpg");

      await withFileServer(projectDir, async (server) => {
        await expectTextResponse(`${server.url}/video%231/frame.jpg`, {
          bodyIncludes: "fake-jpg",
        });
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("HF_EARLY_STUB + HF_BRIDGE_SCRIPT integration", () => {
  /**
   * Simulates the real injection order in a Puppeteer page:
   *   1. HF_EARLY_STUB  (start of <head>, before everything)
   *   2. authored page scripts that write to window.__hf.transitions
   *      (e.g. @hyperframes/shader-transitions in <body>)
   *   3. HF_BRIDGE_SCRIPT (end of <body>, upgrades __hf with seek/duration)
   *
   * Regression test for the race condition where the bridge used to overwrite
   * window.__hf with a fresh object, dropping any fields user libraries
   * (notably `transitions`) had populated during page-script execution.
   * Without the early stub + patch-not-replace bridge, the engine never
   * detects shader transitions and HDR compositing falls back to plain DOM.
   */
  it("preserves __hf.transitions written by page scripts through bridge upgrade", () => {
    const sandbox: {
      window: Record<string, unknown> & {
        __hf?: { transitions?: unknown[]; seek?: (t: number) => void; duration?: number };
        __player?: { renderSeek: (t: number) => void; getDuration: () => number };
        setInterval: typeof setInterval;
        clearInterval: typeof clearInterval;
      };
      document: { querySelector: () => null };
    } = {
      window: {
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
      },
      document: { querySelector: () => null },
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = sandbox.document;

    const run = (src: string): void => {
      new Function("window", "document", `with (window) {\n${src}\n}`)(
        sandbox.window,
        sandbox.document,
      );
    };

    run(HF_EARLY_STUB);
    expect(sandbox.window.__hf).toBeDefined();
    expect(sandbox.window.__hf?.transitions).toBeUndefined();

    sandbox.window.__hf!.transitions = [
      { time: 5, duration: 0.5, shader: "domain-warp", fromScene: "a", toScene: "b" },
    ];

    sandbox.window.__player = {
      renderSeek: () => {},
      getDuration: () => 30,
    };

    run(HF_BRIDGE_SCRIPT);

    expect(sandbox.window.__hf).toBeDefined();
    expect(sandbox.window.__hf?.transitions).toEqual([
      { time: 5, duration: 0.5, shader: "domain-warp", fromScene: "a", toScene: "b" },
    ]);
    expect(typeof sandbox.window.__hf?.seek).toBe("function");
    expect(sandbox.window.__hf?.duration).toBe(0);

    sandbox.window.__renderReady = true;
    expect(sandbox.window.__hf?.duration).toBe(30);
  });

  it("keeps render-time timeline seeks synchronous during large renders", () => {
    const sandbox: {
      window: Record<string, unknown> & {
        __hf?: Record<string, unknown>;
        __hfTimelinesBuilding?: boolean;
        gsap?: { timeline: () => { totalTime: (time?: number) => number | unknown } };
        requestAnimationFrame: typeof requestAnimationFrame;
        setTimeout: typeof setTimeout;
      };
      document: Record<string, never>;
      CustomEvent: typeof CustomEvent;
    } = {
      window: {
        requestAnimationFrame: (() => 1) as typeof requestAnimationFrame,
        setTimeout: (() => 1) as typeof setTimeout,
      },
      document: {},
      CustomEvent,
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = sandbox.document;
    sandbox.window.CustomEvent = sandbox.CustomEvent;

    new Function("window", "document", "CustomEvent", `with (window) {\n${HF_EARLY_STUB}\n}`)(
      sandbox.window,
      sandbox.document,
      sandbox.CustomEvent,
    );

    const totalTimeCalls: number[] = [];
    sandbox.window.gsap = {
      timeline: () => ({
        to: () => {},
        from: () => {},
        fromTo: () => {},
        set: () => {},
        pause: () => {},
        play: () => {},
        seek: () => {},
        totalTime: (time?: number) => {
          if (typeof time === "number") totalTimeCalls.push(time);
          return totalTimeCalls.at(-1) ?? 0;
        },
        time: () => 0,
        duration: () => 10,
        add: () => {},
        getChildren: () => [],
        paused: () => true,
        timeScale: () => 1,
        kill: () => {},
      }),
    };

    const timeline = sandbox.window.gsap.timeline();
    for (let i = 0; i < 5100; i += 1) {
      timeline.totalTime(i / 30);
    }

    expect(totalTimeCalls).toHaveLength(5100);
    expect(sandbox.window.__hfTimelinesBuilding).toBe(false);
  });

  it("flushes queued construction calls before forwarding timeline children", () => {
    const sandbox: {
      window: Record<string, unknown> & {
        __hf?: Record<string, unknown>;
        __hfTimelinesBuilding?: boolean;
        gsap?: {
          timeline: () => { to: (...args: unknown[]) => unknown; getChildren: () => unknown[] };
        };
        requestAnimationFrame: typeof requestAnimationFrame;
        setTimeout: typeof setTimeout;
      };
      document: Record<string, never>;
      CustomEvent: typeof CustomEvent;
    } = {
      window: {
        requestAnimationFrame: (() => 1) as typeof requestAnimationFrame,
        setTimeout: ((callback: () => void) => {
          callback();
          return 1;
        }) as typeof setTimeout,
      },
      document: {},
      CustomEvent,
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = sandbox.document;
    sandbox.window.CustomEvent = sandbox.CustomEvent;

    new Function("window", "document", "CustomEvent", `with (window) {\n${HF_EARLY_STUB}\n}`)(
      sandbox.window,
      sandbox.document,
      sandbox.CustomEvent,
    );

    const constructionCalls: unknown[][] = [];
    const child = { id: "child" };
    sandbox.window.gsap = {
      timeline: () => ({
        to: (...args: unknown[]) => {
          constructionCalls.push(args);
        },
        from: () => {},
        fromTo: () => {},
        set: () => {},
        pause: () => {},
        play: () => {},
        seek: () => {},
        totalTime: () => 0,
        time: () => 0,
        duration: () => 10,
        add: () => {},
        getChildren: () => [child],
        paused: () => true,
        timeScale: () => 1,
        kill: () => {},
      }),
    };

    const timeline = sandbox.window.gsap.timeline();
    timeline.to("#box", { x: 100 });

    expect(constructionCalls).toHaveLength(0);
    expect(timeline.getChildren()).toEqual([child]);
    expect(constructionCalls).toHaveLength(1);
    expect(sandbox.window.__hfTimelinesBuilding).toBe(false);
  });

  it("proxy is non-thenable — Promise.resolve(proxy) resolves immediately", async () => {
    const sandbox: {
      window: Record<string, unknown> & {
        __hf?: Record<string, unknown>;
        __hfTimelinesBuilding?: boolean;
        gsap?: { timeline: () => Record<string, unknown> };
        requestAnimationFrame: typeof requestAnimationFrame;
        setTimeout: typeof setTimeout;
      };
      document: Record<string, never>;
      CustomEvent: typeof CustomEvent;
    } = {
      window: {
        requestAnimationFrame: (() => 1) as typeof requestAnimationFrame,
        setTimeout: (() => 1) as typeof setTimeout,
      },
      document: {},
      CustomEvent,
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = sandbox.document;
    sandbox.window.CustomEvent = sandbox.CustomEvent;

    new Function("window", "document", "CustomEvent", `with (window) {\n${HF_EARLY_STUB}\n}`)(
      sandbox.window,
      sandbox.document,
      sandbox.CustomEvent,
    );

    sandbox.window.gsap = {
      timeline: () => ({
        to: () => {},
        from: () => {},
        fromTo: () => {},
        set: () => {},
        pause: () => {},
        play: () => {},
        seek: () => {},
        totalTime: () => 0,
        time: () => 0,
        duration: () => 10,
        add: () => {},
        getChildren: () => [],
        paused: () => true,
        timeScale: () => 1,
        kill: () => {},
        then: (_resolve: () => void) => {
          throw new Error("Real then() was called — proxy is thenable");
        },
      }),
    };

    const timeline = sandbox.window.gsap.timeline();
    const resolved = await Promise.resolve(timeline);
    expect(resolved).toBe(timeline);
  });

  it("keeps bridge duration at zero until the runtime publishes render readiness", () => {
    const sandbox: {
      window: Record<string, unknown> & {
        __hf?: { seek?: (t: number) => void; duration?: number };
        __player?: { renderSeek: (t: number) => void; getDuration: () => number };
        __renderReady?: boolean;
        __hfTimelinesBuilding?: boolean;
        setInterval: typeof setInterval;
        clearInterval: typeof clearInterval;
      };
      document: { querySelector: () => { getAttribute: (name: string) => string | null } };
    } = {
      window: {
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
      },
      document: {
        querySelector: () => ({
          getAttribute: (name: string) => (name === "data-duration" ? "15" : null),
        }),
      },
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = sandbox.document;
    sandbox.window.__player = {
      renderSeek: () => {},
      getDuration: () => 0,
    };

    new Function("window", "document", `with (window) {\n${HF_BRIDGE_SCRIPT}\n}`)(
      sandbox.window,
      sandbox.document,
    );

    expect(sandbox.window.__hf?.duration).toBe(0);

    sandbox.window.__renderReady = true;
    expect(sandbox.window.__hf?.duration).toBe(15);

    sandbox.window.__hfTimelinesBuilding = true;
    expect(sandbox.window.__hf?.duration).toBe(0);
  });

  it("derives duration from sub-composition data-start + data-duration when root has none", () => {
    const sandbox: any = {
      window: {
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
      },
      document: {
        querySelector: () => ({
          getAttribute: () => null,
        }),
        querySelectorAll: () => [
          {
            getAttribute: (n: string) =>
              n === "data-start" ? "0" : n === "data-duration" ? "5" : null,
          },
          {
            getAttribute: (n: string) =>
              n === "data-start" ? "5" : n === "data-duration" ? "8" : null,
          },
        ],
      },
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = sandbox.document;
    sandbox.window.__player = {
      renderSeek: () => {},
      getDuration: () => 0,
    };
    sandbox.window.__renderReady = true;

    new Function("window", "document", `with (window) {\n${HF_BRIDGE_SCRIPT}\n}`)(
      sandbox.window,
      sandbox.document,
    );

    expect(sandbox.window.__hf?.duration).toBe(13);
  });
});
