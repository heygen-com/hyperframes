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

describe("createFileServer", () => {
  it("serves asset files through project-root symlinked directories", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "hf-file-server-symlink-assets-"));
    const adsDir = join(workspaceDir, "Ads");
    const projectDir = join(adsDir, "annual-upsell-2");
    const sharedDir = join(adsDir, "shared");

    try {
      mkdirSync(projectDir, { recursive: true });
      mkdirSync(sharedDir, { recursive: true });
      writeFileSync(join(projectDir, "index.html"), "<!doctype html><html></html>");
      writeFileSync(
        join(sharedDir, "brand.css"),
        ".aisplus-glass { backdrop-filter: blur(28px); }",
      );
      symlinkSync("../shared", join(projectDir, "shared"));

      const server = await createFileServer({
        projectDir,
        preHeadScripts: [],
        headScripts: [],
        bodyScripts: [],
      });

      try {
        const response = await fetch(`${server.url}/shared/brand.css`);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/css");
        expect(await response.text()).toContain(".aisplus-glass");
      } finally {
        server.close();
      }
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("decodes percent-encoded reserved characters in URL path segments", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-file-server-reserved-chars-"));

    try {
      const subDir = join(projectDir, "video#1");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(projectDir, "index.html"), "<!doctype html><html></html>");
      writeFileSync(join(subDir, "frame.jpg"), "fake-jpg");

      const server = await createFileServer({
        projectDir,
        preHeadScripts: [],
        headScripts: [],
        bodyScripts: [],
      });

      try {
        const res = await fetch(`${server.url}/video%231/frame.jpg`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("fake-jpg");
      } finally {
        server.close();
      }
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
});
