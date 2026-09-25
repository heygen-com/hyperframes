import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createProjectSignature, fileContentVersion } from "@hyperframes/studio-server";
import { loadHyperframeRuntimeSource } from "@hyperframes/core";
import { loadRuntimeSource } from "./runtimeSource.js";
import { findFFmpeg, findFFprobe } from "../browser/ffmpeg.js";
import { createStudioServer, type StudioServer } from "./studioServer.js";

// Forces loadStudioProducer() down its production import branch (real
// isDevMode() is true for a .ts test file, which instead throws a
// "requires bun" error before ever reaching executeRenderJob — see
// studioServer.ts's loadStudioProducer). Only startRender reads this.
vi.mock("../utils/env.js", () => ({ isDevMode: () => false }));

const producerState = vi.hoisted(() => ({
  // Set per-test to control when the render "finishes" so a shutdown that
  // races an in-flight render is observable instead of vacuous.
  executeRenderJob: (
    _job: unknown,
    _dir: string,
    _outputPath: string,
    _onProgress: unknown,
    _signal: AbortSignal,
  ): Promise<void> => Promise.resolve(),
}));
vi.mock("@hyperframes/producer", () => ({
  createRenderJob: (opts: Record<string, unknown>) => ({ ...opts, perfSummary: undefined }),
  executeRenderJob: (...args: Parameters<typeof producerState.executeRenderJob>) =>
    producerState.executeRenderJob(...args),
}));
const engineState = vi.hoisted(() => ({
  acquireBrowser: async (..._args: unknown[]): Promise<unknown> => {
    throw new Error("acquireBrowser called without a test double");
  },
  closeBrowserPool: async (): Promise<void> => {},
}));
vi.mock("@hyperframes/engine", () => ({
  acquireBrowser: (...args: unknown[]) => engineState.acquireBrowser(...args),
  buildChromeArgs: () => [],
  killTrackedProcesses: () => {},
  closeBrowserPool: () => engineState.closeBrowserPool(),
}));
vi.mock("@hyperframes/studio-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/studio-server")>();
  return { ...actual, createProjectSignature: vi.fn(actual.createProjectSignature) };
});
vi.mock("../browser/gpuPolicy.js", () => ({
  resolveCaptureBrowserGpuMode: async () => "software",
  resolveLocalBrowserGpuMode: () => "software",
  compositionRequiresWebGpu: () => false,
  assertWebGpuAdapterAvailable: async () => {},
}));
vi.mock("../browser/preflight.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../browser/preflight.js")>()),
  resolveRenderBrowser: async () => ({ executablePath: "/fake/chrome", source: "system" }),
}));
vi.mock("../browser/manager.js", () => ({
  ensureBrowser: async () => ({ executablePath: undefined, source: "system" }),
}));

// Lets one test hold the project history in its opening; every other test opens the real one.
const historyState = vi.hoisted(() => ({
  open: null as null | ((...args: unknown[]) => Promise<unknown>),
}));
vi.mock("@hyperframes/studio-server", async (importOriginal) => {
  const original = await importOriginal<typeof import("@hyperframes/studio-server")>();
  return {
    ...original,
    openProjectHistory: (...args: Parameters<typeof original.openProjectHistory>) =>
      historyState.open ? historyState.open(...args) : original.openProjectHistory(...args),
  };
});

// Only `fs.watch` is replaced, so the SSE describe below can fire a file-change
// on demand; every other server test keeps reading and writing real files.
const mockWatcher = new EventEmitter() as EventEmitter & { close: () => void };
mockWatcher.close = vi.fn();

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  const watch = vi.fn(
    (_path: string, _options: unknown, onChange: (event: string, filename: string) => void) => {
      mockWatcher.on("change", onChange);
      return mockWatcher;
    },
  );
  return { ...original, default: { ...original, watch }, watch };
});

// Every server-backed describe below wants the same two things: a throwaway
// project directory, and a server whose watcher is closed afterwards. Three
// copies of that got out of step, so it lives here once.
const dirs: string[] = [];
let server: StudioServer | undefined;

function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-studio-server-test-"));
  dirs.push(dir);
  return dir;
}

const openReaders: ReadableStreamDefaultReader<Uint8Array>[] = [];

afterEach(async () => {
  await Promise.all(openReaders.splice(0).map((reader) => reader.cancel().catch(() => {})));
  mockWatcher.removeAllListeners();
  server?.watcher.close();
  server = undefined;
  delete process.env.HYPERFRAMES_FFMPEG_PATH;
  delete process.env.HYPERFRAMES_FFPROBE_PATH;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadRuntimeSource", () => {
  it("loads runtime source from the published core entrypoint", async () => {
    await expect(loadRuntimeSource()).resolves.toBe(loadHyperframeRuntimeSource());
  });
});

describe("Studio thumbnail GPU capture plumbing", () => {
  it("uses the shared auto probe, resolved launch mode, requirement guard, and completion-aware seek", () => {
    const source = readFileSync(new URL("./studioServer.ts", import.meta.url), "utf8");
    expect(source).toContain("resolveCaptureBrowserGpuMode");
    expect(source).toContain("{ browserGpuMode: resolvedGpuMode }");
    expect(source).toContain("assertWebGpuAdapterAvailable(page, requiresWebGpu)");
    expect(source).toContain("await seekCompositionTimeline(page, opts.seekTime");
  });
});

describe("createStudioServer project history (D-491)", () => {
  it("serves the project's history, and a change the watcher sees becomes an entry", async () => {
    const projectDir = tmpProject();
    writeFileSync(join(projectDir, "index.html"), "<html>before</html>");
    server = createStudioServer({ projectDir, historyRoot: tmpProject() });
    const historyUrl = `/api/projects/${encodeURIComponent(basename(projectDir))}/history`;
    const list = async () =>
      (await (await server!.app.request(historyUrl)).json()) as {
        entries: Array<{ who: { kind: string } }>;
        back: { label: string } | null;
      };
    expect(await list()).toMatchObject({ entries: [], back: null });

    writeFileSync(join(projectDir, "index.html"), "<html>agent</html>");
    mockWatcher.emit("change", "change", "index.html");

    // Writes with no window open group until 2 s of quiet.
    await vi.waitFor(async () => expect((await list()).entries).toHaveLength(1), {
      timeout: 5_000,
      interval: 200,
    });
    expect((await list()).entries[0]!.who.kind).toBe("outside");
    await server.shutdown();
  });

  it("shutdown returns within preview's exit watchdog while the history is still opening", async () => {
    historyState.open = () => new Promise(() => {});
    try {
      const projectDir = tmpProject();
      server = createStudioServer({ projectDir, historyRoot: tmpProject() });
      void server.app.request(`/api/projects/${encodeURIComponent(basename(projectDir))}/history`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const started = Date.now();
      await server.shutdown();
      expect(Date.now() - started).toBeLessThan(2_900);
    } finally {
      historyState.open = null;
    }
  });
});

describe("createStudioServer autoProxy plumbing", () => {
  it("hyperframes.json media.autoProxy=false flows through to the adapter", () => {
    const projectDir = tmpProject();
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ media: { autoProxy: false } }),
    );

    server = createStudioServer({ projectDir });

    expect(server.adapter.autoProxy).toBe(false);
  });

  it("defaults the adapter to autoProxy=true when neither option nor config disables it", () => {
    server = createStudioServer({ projectDir: tmpProject() });
    expect(server.adapter.autoProxy).toBe(true);
  });

  it("an explicit option (the preview command's resolved --proxy flag) wins over config", () => {
    const projectDir = tmpProject();
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ media: { autoProxy: false } }),
    );

    server = createStudioServer({ projectDir, autoProxy: true });

    expect(server.adapter.autoProxy).toBe(true);
  });

  it("advertises the GPU policy used for thumbnail capture", async () => {
    const projectDir = tmpProject();
    server = createStudioServer({ projectDir, browserGpuMode: "software" });

    const response = await server.app.request("/__hyperframes_config");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ browserGpuMode: "software" });
  });
});

// A render that never reaches the executor (browser check refused, import failed) must fail with
// its reason, not hang until the suite timeout.
async function untilStarted(started: Promise<void>, state: { status: string; error?: string }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const never = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `render never reached executeRenderJob: status=${state.status} error=${state.error}`,
          ),
        ),
      5_000,
    );
  });
  try {
    await Promise.race([started, never]);
  } finally {
    clearTimeout(timer);
  }
}

describe("createStudioServer shutdown", () => {
  function startRenderOpts(jobId: string, outputPath: string) {
    return {
      project: { id: "demo", dir: tmpProject(), title: "demo" },
      outputPath,
      format: "mp4" as const,
      fps: { num: 30, den: 1 },
      quality: "draft",
      jobId,
    };
  }

  it("cancels an in-flight render's signal and waits for it before draining the browser pool", async () => {
    const events: string[] = [];
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    producerState.executeRenderJob = (_job, _dir, _outputPath, _onProgress, signal) => {
      started();
      return new Promise((_resolve, reject) => {
        const onAbort = () =>
          setTimeout(() => {
            events.push("render-settled");
            reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
          }, 20);
        // A signal aborted before this executor ran would never fire a later
        // "abort" listener (edge-triggered, not level-triggered) — check the
        // already-aborted case too, same as real capture code must.
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort);
      });
    };

    server = createStudioServer({ projectDir: tmpProject() });
    const outputPath = join(tmpdir(), "shutdown-render.mp4");
    const state = server.adapter.startRender(startRenderOpts("job-1", outputPath));
    expect(state.status).toBe("rendering");

    // Wait until the render has actually reached executeRenderJob (several
    // microtask hops through loadStudioProducer/ensureBrowser) before racing
    // it against shutdown, or shutdown could abort a signal nothing is
    // listening on yet — a race in this test, not in the fix under test.
    await untilStarted(startedPromise, state);

    await server.shutdown();
    events.push("drain-and-shutdown-returned");

    expect(events).toEqual(["render-settled", "drain-and-shutdown-returned"]);
  });

  it("refuses a render started after shutdown has begun instead of launching a fresh browser", async () => {
    let releaseFirstRender: () => void = () => {};
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    producerState.executeRenderJob = () => {
      started();
      return new Promise<void>((resolve) => {
        releaseFirstRender = resolve;
      });
    };

    server = createStudioServer({ projectDir: tmpProject() });
    const first = server.adapter.startRender(startRenderOpts("job-1", join(tmpdir(), "a.mp4")));
    await untilStarted(startedPromise, first);

    const shutdownPromise = server.shutdown();
    // shuttingDown is set synchronously as shutdown()'s first statement, so a
    // render request arriving anywhere after that call has been made (even
    // before it resolves) must already see it.
    const late = server.adapter.startRender(startRenderOpts("job-2", join(tmpdir(), "b.mp4")));

    expect(late.status).toBe("failed");
    expect(late.error).toMatch(/shutting down/i);

    releaseFirstRender();
    await shutdownPromise;
  });

  const thumbnailOpts = () => ({
    project: { id: "demo", dir: tmpProject(), title: "demo" },
    compPath: "index.html",
    seekTime: 0.5,
    width: 640,
    height: 360,
    outputWidth: 640,
    outputHeight: 360,
    previewUrl: "http://localhost/preview",
    signal: new AbortController().signal,
  });

  it("does not launch a browser for a thumbnail request after shutdown has begun", async () => {
    const acquire = vi.fn();
    engineState.acquireBrowser = acquire;
    server = createStudioServer({ projectDir: tmpProject() });
    await server.shutdown();

    await expect(server.adapter.generateThumbnail?.(thumbnailOpts())).resolves.toBeNull();
    expect(acquire).not.toHaveBeenCalled();
  });

  it("releases a thumbnail browser that finished launching after shutdown began", async () => {
    const release = vi.fn(async () => {});
    let launched!: () => void;
    const launchedPromise = new Promise<void>((resolve) => (launched = resolve));
    let finishLaunch: () => void = () => {};
    engineState.acquireBrowser = async () => {
      launched();
      await new Promise<void>((resolve) => (finishLaunch = resolve));
      return { browser: new EventEmitter(), release };
    };
    let reachedBrowserClose!: () => void;
    const reachedBrowserClosePromise = new Promise<void>(
      (resolve) => (reachedBrowserClose = resolve),
    );
    engineState.closeBrowserPool = async () => reachedBrowserClose();
    server = createStudioServer({ projectDir: tmpProject() });
    const thumbnail = server.adapter.generateThumbnail?.(thumbnailOpts());
    await launchedPromise;

    const shutdown = server.shutdown();
    // shutdown() starts the pool close alongside the thumbnail-browser close,
    // before it waits on renders: closing is the signal the close has begun
    // while the launch is still pending, without racing a fixed sleep.
    await reachedBrowserClosePromise;
    finishLaunch();
    await shutdown;

    await expect(thumbnail).resolves.toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("closes browsers within a bounded timeout even when a render's done promise never settles", async () => {
    const closeBrowserPool = vi.fn(async () => {});
    engineState.closeBrowserPool = closeBrowserPool;
    const release = vi.fn(async () => {});
    let launched!: () => void;
    const launchedPromise = new Promise<void>((resolve) => (launched = resolve));
    let finishLaunch: () => void = () => {};
    engineState.acquireBrowser = async () => {
      launched();
      await new Promise<void>((resolve) => (finishLaunch = resolve));
      return { browser: new EventEmitter(), release };
    };

    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    producerState.executeRenderJob = () => {
      started();
      // Never settles, even once aborted -- the pathological case the CLI's
      // 3s exit watchdog exists to survive.
      return new Promise<void>(() => {});
    };

    server = createStudioServer({ projectDir: tmpProject() });
    const state = server.adapter.startRender(startRenderOpts("job-1", join(tmpdir(), "hang.mp4")));
    await untilStarted(startedPromise, state);

    const thumbnail = server.adapter.generateThumbnail?.(thumbnailOpts());
    await launchedPromise;
    finishLaunch();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const never = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("shutdown() did not resolve within its bound")),
        3_000,
      );
    });
    try {
      await Promise.race([server.shutdown(), never]);
    } finally {
      clearTimeout(timer);
    }

    expect(release).toHaveBeenCalledTimes(1);
    expect(closeBrowserPool).toHaveBeenCalledTimes(1);
    await expect(thumbnail).resolves.toBeNull();
  });

  it("does not hand an already-leased browser to a new caller once shutdown has begun", async () => {
    const release = vi.fn(async () => {});
    const newPage = vi.fn(async () => {
      throw new Error("no real page in this test double");
    });
    engineState.acquireBrowser = async () => ({
      browser: { connected: true, newPage, on: () => {} },
      release,
    });

    server = createStudioServer({ projectDir: tmpProject() });
    await server.adapter.generateThumbnail?.(thumbnailOpts());
    expect(newPage).toHaveBeenCalledTimes(1);

    const shutdownPromise = server.shutdown();
    // shuttingDown flips true synchronously as shutdown()'s first statement,
    // before its closeThumbnailBrowser() call runs -- this request lands in
    // that window and must not reuse the still-connected lease.
    const late = server.adapter.generateThumbnail?.(thumbnailOpts());

    await expect(late).resolves.toBeNull();
    expect(newPage).toHaveBeenCalledTimes(1);
    await shutdownPromise;
  });
});

describe("Studio thumbnail capture", () => {
  function fakePageBrowser(onEvaluate = () => {}) {
    const screenshot = vi.fn(async () => Buffer.from("jpeg"));
    const evaluate = vi.fn(async () => onEvaluate());
    const page = new Proxy(
      { screenshot, evaluate },
      {
        get: (target, key) =>
          key === "then"
            ? undefined
            : key in target
              ? target[key as keyof typeof target]
              : async () => {},
      },
    );
    engineState.acquireBrowser = async () => ({
      browser: { connected: true, newPage: async () => page, on: () => {} },
      release: async () => {},
    });
    return { screenshot };
  }
  const opts = (dir: string, signal = new AbortController().signal) => ({
    project: { id: "demo", dir, title: "demo" },
    compPath: "index.html",
    seekTime: 0.5,
    width: 640,
    height: 360,
    outputWidth: 640,
    outputHeight: 360,
    previewUrl: "http://localhost/preview",
    signal,
  });

  it("stops a thumbnail whose request is aborted before its screenshot", async () => {
    let abortOnEvaluate: AbortController | undefined;
    const { screenshot } = fakePageBrowser(() => abortOnEvaluate?.abort());
    const dir = tmpProject();
    server = createStudioServer({ projectDir: dir });
    await expect(server.adapter.generateThumbnail?.(opts(dir))).resolves.toBeInstanceOf(Buffer);
    expect(screenshot).toHaveBeenCalledTimes(1);

    const aborting = new AbortController();
    abortOnEvaluate = aborting;
    await expect(
      server.adapter.generateThumbnail?.(opts(dir, aborting.signal)),
    ).resolves.toBeNull();
    expect(screenshot).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached project signature instead of walking the project per thumbnail", async () => {
    fakePageBrowser();
    const dir = tmpProject();
    server = createStudioServer({ projectDir: dir });
    await server.adapter.generateThumbnail?.(opts(dir));
    const walks = vi.mocked(createProjectSignature).mock.calls.length;
    for (let i = 0; i < 3; i++) await server.adapter.generateThumbnail?.(opts(dir));
    expect(vi.mocked(createProjectSignature).mock.calls.length).toBe(walks);
  });
});

describe("Studio project lint endpoint", () => {
  it("surfaces findings that require the complete project graph", async () => {
    const projectDir = tmpProject();
    mkdirSync(join(projectDir, "compositions"));
    mkdirSync(join(projectDir, "scenes"));
    writeFileSync(
      join(projectDir, "index.html"),
      `<html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10"></div></body></html>`,
    );
    writeFileSync(
      join(projectDir, "compositions", "index.html"),
      `<html><body><div data-composition-id="authored" data-width="1920" data-height="1080" data-start="0" data-duration="5"><div class="clip" data-start="0" data-duration="5">Visible</div></div></body></html>`,
    );
    writeFileSync(join(projectDir, "scenes", "intro.html"), "<html><body>Intro</body></html>");
    server = createStudioServer({ projectDir, projectName: "demo" });

    const response = await server.app.request("http://localhost/api/projects/demo/lint");
    const payload = (await response.json()) as {
      findings?: Array<{ code?: string; file?: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.findings).toContainEqual(
      expect.objectContaining({ code: "blank_root_with_standalone_composition" }),
    );
    expect(payload.findings).toContainEqual(expect.objectContaining({ file: "scenes/intro.html" }));
    expect(payload.findings?.every((finding) => !finding.file?.startsWith(projectDir))).toBe(true);
  });
});

describe("host guarding on identity-bearing responses", () => {
  // NOTE: the SPA-injection branch itself is covered in telemetryIdentity.test.ts
  // via buildStudioHeadScriptsForHost. It cannot be asserted here: this route
  // only reaches the injection branch when packages/studio/dist is built,
  // which is true locally and false in the CI test lane, so a route-level
  // assertion on the returned HTML passes on a dev box and fails in CI.

  it("refuses the identity endpoint for a hostile Host", async () => {
    server = createStudioServer({ projectDir: tmpProject() });
    const res = await server.app.request("/api/telemetry-identity", {
      headers: { host: "evil.example.com" },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('distinctId":"');
  });

  it("serves the identity endpoint on a loopback Host", async () => {
    server = createStudioServer({ projectDir: tmpProject() });
    const res = await server.app.request("/api/telemetry-identity", {
      headers: { host: "127.0.0.1:5173" },
    });
    expect(res.status).toBe(200);
    // The seed is no longer served here at all — Studio gets decisions
    // injected instead, so nothing needs it over HTTP.
    expect(Object.keys((await res.json()) as object)).toEqual(["distinctId"]);
  });
});

// Studio asks this before it offers Export, so a machine without an encoder
// gets an install command up front instead of a 503 after the work is done.
describe("FFmpeg environment endpoint", () => {
  it("reports the cause and a pasteable command when FFmpeg is unusable", async () => {
    // A configured-but-missing override is the one "no FFmpeg" state a test can
    // force on a machine that does have FFmpeg installed.
    process.env.HYPERFRAMES_FFMPEG_PATH = join(tmpdir(), "hf-missing-ffmpeg");
    server = createStudioServer({ projectDir: tmpProject() });

    const res = await server.app.request("/api/environment/ffmpeg");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      title?: string;
      detail?: string;
      command?: string;
    };

    expect(body.ok).toBe(false);
    expect(body.title).toContain("not found");
    expect(body.detail).toBeTruthy();
    // Undefined only on platforms with no one-line install; CI runs none.
    expect(body.command).toBeTruthy();
  });

  // Needs a real FFmpeg: the check runs `-version` on whatever it resolves, so
  // a stand-in binary would only prove the stand-in works. Skipped rather than
  // faked on machines without one.
  it.skipIf(!findFFmpeg() || !findFFprobe())(
    "answers a plain ok when both binaries resolve",
    async () => {
      server = createStudioServer({ projectDir: tmpProject() });

      const res = await server.app.request("/api/environment/ffmpeg");

      expect(await res.json()).toEqual({ ok: true });
    },
  );
});

describe("Studio file-change SSE", () => {
  /** Opens `count` `/api/events` connections and waits for each to register its listener. */
  async function subscribe(count: number): Promise<ReadableStreamDefaultReader<Uint8Array>[]> {
    const responses = await Promise.all(
      Array.from({ length: count }, () => server!.app.request("/api/events")),
    );
    const streams = responses.map((response) => {
      const reader = response.body!.getReader();
      openReaders.push(reader);
      return reader;
    });
    // streamSSE runs its callback after the Response resolves, so the listener
    // each connection adds has to exist before the watcher fires.
    await new Promise((resolve) => setTimeout(resolve, 20));
    return streams;
  }

  const nextEvent = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> =>
    new TextDecoder().decode((await reader.read()).value);

  /** The version as it appears inside the JSON-encoded SSE data line. */
  const encodedVersion = (content: string): string =>
    fileContentVersion(content).replaceAll('"', '\\"');

  it("labels a Studio write for every open subscriber, not just the first", async () => {
    const projectDir = tmpProject();
    writeFileSync(join(projectDir, "index.html"), "<html>before</html>");
    server = createStudioServer({ projectDir });
    const streams = await subscribe(2);

    const written = "<html>after</html>";
    const write = await server.app.request(
      `/api/projects/${encodeURIComponent(basename(projectDir))}/files/index.html`,
      {
        method: "PUT",
        headers: {
          "If-Match": fileContentVersion("<html>before</html>"),
          "X-Hyperframes-Write-Token": "studio-write-1",
        },
        body: written,
      },
    );
    expect(write.status).toBe(200);
    mockWatcher.emit("change", "change", "index.html");

    for (const payload of await Promise.all(streams.map(nextEvent))) {
      expect(payload).toContain("studio-write-1");
      expect(payload).toContain(encodedVersion(written));
    }
  });

  it("still reports an external write with a version so subscribers can dedupe it", async () => {
    const projectDir = tmpProject();
    writeFileSync(join(projectDir, "index.html"), "<html>before</html>");
    server = createStudioServer({ projectDir });
    const streams = await subscribe(2);

    writeFileSync(join(projectDir, "index.html"), "<html>agent</html>");
    mockWatcher.emit("change", "change", "index.html");

    for (const payload of await Promise.all(streams.map(nextEvent))) {
      expect(payload).not.toContain("writeToken");
      expect(payload).toContain(encodedVersion("<html>agent</html>"));
    }
  });

  // `/api/events` is one connection per SERVER, not per project: a tab left
  // open from a `preview` run whose port was later reused by a DIFFERENT
  // project shares this exact stream. Without `projectId` on the wire, that
  // stale tab cannot tell "my project changed" from "the other project this
  // server now serves changed" — see useExternalFileChangeCoordinator's
  // cross-project filter, which reads this field.
  it("labels every file-change with this server's project id", async () => {
    const projectDir = tmpProject();
    writeFileSync(join(projectDir, "index.html"), "<html>before</html>");
    server = createStudioServer({ projectDir, projectName: "demo-project" });
    const streams = await subscribe(1);

    writeFileSync(join(projectDir, "index.html"), "<html>agent</html>");
    mockWatcher.emit("change", "change", "index.html");

    const [payload] = await Promise.all(streams.map(nextEvent));
    expect(payload).toContain('"projectId":"demo-project"');
  });
});
