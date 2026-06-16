import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VALID_CANVAS_RESOLUTIONS } from "../../core.types";
import { registerRenderRoutes } from "./render";
import type { StudioApiAdapter } from "../types";

function createAdapter(
  startRenderSpy: ReturnType<typeof vi.fn>,
  rendersDir = mkdtempSync(join(tmpdir(), "hf-render-test-")),
): { adapter: StudioApiAdapter; rendersDir: string } {
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    // Use a real, existing dir: isSafePath() canonicalizes the project dir with
    // realpath and fails closed if it doesn't exist (real projects always do).
    resolveProject: async (id: string) => ({ id, dir: tmpdir() }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => rendersDir,
    startRender: (opts) => {
      startRenderSpy(opts);
      return {
        id: opts.jobId,
        status: "rendering",
        progress: 0,
        outputPath: opts.outputPath,
      };
    },
  };
  return { adapter, rendersDir };
}

function buildApp(spy: ReturnType<typeof vi.fn>): { app: Hono; cleanup: () => void } {
  const { adapter, rendersDir } = createAdapter(spy);
  const app = new Hono();
  registerRenderRoutes(app, adapter);
  return { app, cleanup: () => rmSync(rendersDir, { recursive: true, force: true }) };
}

describe("POST /projects/:id/render — outputResolution forwarding", () => {
  it("forwards a valid resolution preset to the adapter", async () => {
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      const res = await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fps: 30,
          quality: "high",
          format: "mp4",
          resolution: "landscape-4k",
        }),
      });
      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledOnce();
      const opts = spy.mock.calls[0][0];
      expect(opts.outputResolution).toBe("landscape-4k");
    } finally {
      cleanup();
    }
  });

  it("omits outputResolution when the request does not specify one", async () => {
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      const res = await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fps: 30, quality: "standard", format: "mp4" }),
      });
      expect(res.status).toBe(200);
      const opts = spy.mock.calls[0][0];
      expect(opts.outputResolution).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("drops an invalid resolution string (defense-in-depth, not a 400)", async () => {
    // The route is intentionally lenient on unknown enum values — the producer
    // is the source of truth for validation and emits a clear error message.
    // We just want to make sure garbage doesn't propagate as if it were valid.
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      const res = await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fps: 30, quality: "standard", format: "mp4", resolution: "8k" }),
      });
      expect(res.status).toBe(200);
      const opts = spy.mock.calls[0][0];
      expect(opts.outputResolution).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("accepts each canonical preset value", async () => {
    for (const preset of VALID_CANVAS_RESOLUTIONS) {
      const spy = vi.fn();
      const { app, cleanup } = buildApp(spy);
      try {
        await app.request("http://localhost/projects/demo/render", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fps: 30, quality: "standard", format: "mp4", resolution: preset }),
        });
        expect(spy.mock.calls[0][0].outputResolution).toBe(preset);
      } finally {
        cleanup();
      }
    }
  });
});

describe("POST /projects/:id/render — composition forwarding", () => {
  it("forwards a valid composition path to the adapter", async () => {
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      const res = await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fps: 30,
          quality: "standard",
          format: "mp4",
          composition: "compositions/intro.html",
        }),
      });
      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].composition).toBe("compositions/intro.html");
    } finally {
      cleanup();
    }
  });

  it("omits composition when not specified", async () => {
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      const res = await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fps: 30, quality: "standard", format: "mp4" }),
      });
      expect(res.status).toBe(200);
      expect(spy.mock.calls[0][0].composition).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("omits composition when empty string", async () => {
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      const res = await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fps: 30, quality: "standard", format: "mp4", composition: "" }),
      });
      expect(res.status).toBe(200);
      expect(spy.mock.calls[0][0].composition).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("rejects path-traversal attempts with 400", async () => {
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      const res = await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fps: 30,
          quality: "standard",
          format: "mp4",
          composition: "../../../etc/passwd",
        }),
      });
      expect(res.status).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});

describe("POST /projects/:id/render — fps wire format", () => {
  // The fps fraction-syntax feature accepts JSON `number` (integer fps) and
  // JSON `string` (ffmpeg-style rational) on the wire, normalizing both to
  // the structured Fps form before invoking the adapter.
  it("forwards integer fps as { num, den: 1 }", async () => {
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fps: 60, quality: "standard", format: "mp4" }),
      });
      expect(spy.mock.calls[0][0].fps).toEqual({ num: 60, den: 1 });
    } finally {
      cleanup();
    }
  });

  it("parses '30000/1001' string body as exact NTSC", async () => {
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fps: "30000/1001", quality: "standard", format: "mp4" }),
      });
      expect(spy.mock.calls[0][0].fps).toEqual({ num: 30000, den: 1001 });
    } finally {
      cleanup();
    }
  });

  it("falls back to 30/1 for malformed fps values", async () => {
    // Matches the lenient handling of `quality` and `resolution` in the same
    // route — the producer surfaces a clearer downstream error if the value
    // is genuinely unusable.
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fps: "abc", quality: "standard", format: "mp4" }),
      });
      expect(spy.mock.calls[0][0].fps).toEqual({ num: 30, den: 1 });
    } finally {
      cleanup();
    }
  });

  it("falls back to 30/1 when fps is omitted", async () => {
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quality: "standard", format: "mp4" }),
      });
      expect(spy.mock.calls[0][0].fps).toEqual({ num: 30, den: 1 });
    } finally {
      cleanup();
    }
  });
});

describe("POST /projects/:id/render — composition path safety", () => {
  const tmpDirs: string[] = [];

  function buildAppWithProjectDir(spy: ReturnType<typeof vi.fn>): {
    app: Hono;
    projectDir: string;
  } {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-render-proj-"));
    const rendersDir = mkdtempSync(join(tmpdir(), "hf-render-out-"));
    tmpDirs.push(projectDir, rendersDir);
    const adapter: StudioApiAdapter = {
      listProjects: () => [],
      resolveProject: async (id: string) => ({ id, dir: projectDir }),
      bundle: async () => null,
      lint: async () => ({ findings: [] }),
      runtimeUrl: "/api/runtime.js",
      rendersDir: () => rendersDir,
      startRender: (opts) => {
        spy(opts);
        return { id: opts.jobId, status: "rendering", progress: 0, outputPath: opts.outputPath };
      },
    };
    const app = new Hono();
    registerRenderRoutes(app, adapter);
    return { app, projectDir };
  }

  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  async function postComposition(app: Hono, composition: string): Promise<Response> {
    return app.request("http://localhost/projects/demo/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fps: 30, quality: "standard", format: "mp4", composition }),
    });
  }

  // Mirror the repo convention (preview.test.ts): skip symlink cases on
  // non-symlink-privileged Windows runners rather than crash the suite.
  function tryCreateSymlink(target: string, path: string, type: "dir" | "file"): boolean {
    try {
      symlinkSync(target, path, type);
      return true;
    } catch {
      return false;
    }
  }

  it("accepts a composition path inside the project directory", async () => {
    const spy = vi.fn();
    const { app } = buildAppWithProjectDir(spy);
    const res = await postComposition(app, "scenes/intro.html");
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("rejects a `..` traversal in the composition path", async () => {
    const spy = vi.fn();
    const { app } = buildAppWithProjectDir(spy);
    const res = await postComposition(app, "../../etc/passwd");
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a composition reached through an in-project symlink pointing outside the project", async () => {
    const spy = vi.fn();
    const { app, projectDir } = buildAppWithProjectDir(spy);
    const external = mkdtempSync(join(tmpdir(), "hf-render-external-"));
    tmpDirs.push(external);
    writeFileSync(join(external, "secret.html"), "<html></html>");
    if (!tryCreateSymlink(external, join(projectDir, "link"), "dir")) return;
    const res = await postComposition(app, "link/secret.html");
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("allows a composition reached through an in-project symlink that stays inside the project", async () => {
    const spy = vi.fn();
    const { app, projectDir } = buildAppWithProjectDir(spy);
    mkdirSync(join(projectDir, "real"));
    writeFileSync(join(projectDir, "real", "scene.html"), "<html></html>");
    if (!tryCreateSymlink(join(projectDir, "real"), join(projectDir, "alias"), "dir")) return;
    const res = await postComposition(app, "alias/scene.html");
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("GET /projects/:id/renders/file/* — path safety", () => {
  const tmpDirs: string[] = [];

  function buildApp(): { app: Hono; rendersDir: string } {
    const rendersDir = mkdtempSync(join(tmpdir(), "hf-renders-out-"));
    tmpDirs.push(rendersDir);
    const adapter: StudioApiAdapter = {
      listProjects: () => [],
      resolveProject: async (id: string) => ({ id, dir: tmpdir() }),
      bundle: async () => null,
      lint: async () => ({ findings: [] }),
      runtimeUrl: "/api/runtime.js",
      rendersDir: () => rendersDir,
      startRender: (opts) => ({
        id: opts.jobId,
        status: "rendering",
        progress: 0,
        outputPath: opts.outputPath,
      }),
    };
    const app = new Hono();
    registerRenderRoutes(app, adapter);
    return { app, rendersDir };
  }

  // Mirror the repo convention (preview.test.ts / composition tests above):
  // skip symlink cases on non-symlink-privileged Windows runners.
  function tryCreateSymlink(target: string, path: string, type: "dir" | "file"): boolean {
    try {
      symlinkSync(target, path, type);
      return true;
    } catch {
      return false;
    }
  }

  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it("serves a render file that lives inside rendersDir", async () => {
    const { app, rendersDir } = buildApp();
    writeFileSync(join(rendersDir, "demo.mp4"), "render-bytes");
    const res = await app.request("http://localhost/projects/demo/renders/file/demo.mp4");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("render-bytes");
  });

  it("rejects a file reached through a symlink inside rendersDir pointing outside it", async () => {
    const { app, rendersDir } = buildApp();
    // A bare join()+readFileSync followed the symlink and leaked the target;
    // the resolveWithinProject chokepoint canonicalizes with realpath first.
    const external = mkdtempSync(join(tmpdir(), "hf-renders-external-"));
    tmpDirs.push(external);
    writeFileSync(join(external, "secret.txt"), "TOP-SECRET");
    if (!tryCreateSymlink(join(external, "secret.txt"), join(rendersDir, "leak.txt"), "file"))
      return;
    const res = await app.request("http://localhost/projects/demo/renders/file/leak.txt");
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("TOP-SECRET");
  });

  it("serves a render file reached through a symlink that stays inside rendersDir", async () => {
    const { app, rendersDir } = buildApp();
    mkdirSync(join(rendersDir, "nested"));
    writeFileSync(join(rendersDir, "nested", "clip.mp4"), "nested-bytes");
    if (!tryCreateSymlink(join(rendersDir, "nested"), join(rendersDir, "alias"), "dir")) return;
    const res = await app.request("http://localhost/projects/demo/renders/file/alias/clip.mp4");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("nested-bytes");
  });
});
