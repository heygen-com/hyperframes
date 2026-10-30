// @vitest-environment happy-dom
// fallow-ignore-file code-duplication
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openSettledCompositionPage,
  type OpenSettledCompositionPageOptions,
  SCREENSHOT_SEEK_OPTIONS,
  seekCompositionTimeline,
} from "../capture/captureCompositionFrame.js";
import { DEFAULT_CHECK_OPTIONS, runAuditGrid } from "./checkPipeline.js";
import {
  captureFindingFrames,
  matchComponentFindings,
  captureOverviewShot,
  keepBrokenImageAborts,
  preResolveHostileMediaProxies,
  dropFailedProxyEchoes,
  runBrowserCheck,
  collectSeekClock,
  mergeHelperDrafts,
  samplingBrowserCount,
} from "./checkBrowser.js";
import { CheckDeadline } from "./checkDeadline.js";
import { closeManagedBrowser } from "../browser/launch.js";
import type { ProjectDir } from "./project.js";

const mocks = vi.hoisted(() => ({
  stopListeners: new Set<() => void>(),
  proxyProgress: {
    feed: undefined as
      | undefined
      | ((
          report: (index: number, progress: { doneSeconds: number; totalSeconds?: number }) => void,
        ) => void),
  },
  proxySignal: undefined as AbortSignal | undefined,
  bundleWithLocalizedFonts: vi.fn(async () => "<html></html>"),
  prepareFindingInspector: vi.fn(),
  serverClose: vi.fn(async () => undefined),
  resolveProxy:
    vi.fn<
      (
        projectDir: string,
        absoluteSourcePath: string,
        variant?: string,
        box?: { width: number; height: number },
      ) => Promise<string>
    >(),
  FfmpegUnavailableError: class FfmpegUnavailableError extends Error {},
  getProxyCachePath: vi.fn(
    (projectDir: string, sourcePath: string, _variant?: string, _box?: unknown) =>
      `${sourcePath}.proxy.mp4`,
  ),
  scanProjectMediaCodecMap: vi.fn<
    (...args: unknown[]) => Promise<
      Record<
        string,
        {
          codecName: string;
          browserHostile: boolean;
          representativeMime: string | null;
          hasAlpha: boolean;
        }
      >
    >
  >(async () => ({})),
}));

vi.mock("../browser/launch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../browser/launch.js")>()),
  closeManagedBrowser: vi.fn(
    (await importOriginal<typeof import("../browser/launch.js")>()).closeManagedBrowser,
  ),
  onStopSignal: (listener: () => void) => {
    mocks.stopListeners.add(listener);
    return () => mocks.stopListeners.delete(listener);
  },
}));
vi.mock("./bundleWithLocalizedFonts.js", () => ({
  // Keep browser-check unit tests focused on the page driver and audit pipeline.
  // The real helper cold-loads the producer/font graph, which is covered by its
  // own tests and can exhaust this suite's timeout under Windows CI contention.
  bundleWithLocalizedFonts: mocks.bundleWithLocalizedFonts,
}));

vi.mock("./checkFindingInspect.js", () => ({
  prepareFindingInspector: mocks.prepareFindingInspector,
}));

vi.mock("../capture/captureCompositionFrame.js", async (importOriginal) => ({
  // Partial mock: constants (AUDIT_SEEK_OPTIONS, DEFAULT_ZOOM_*) stay real so
  // they remain single-sourced; only the browser-touching functions are faked.
  ...(await importOriginal<typeof import("../capture/captureCompositionFrame.js")>()),
  openSettledCompositionPage: vi.fn(),
  resolveCliChromeGpuMode: vi.fn(() => "hardware"),
  seekCompositionTimeline: vi.fn(async () => undefined),
  waitForPreferredSeekTarget: vi.fn(async () => undefined),
}));

vi.mock("../commands/validate.js", async (importOriginal) => ({
  // Partial mock: shouldIgnoreRequestFailure stays real; the clip audit is
  // faked so tests control its findings without loading real media.
  ...(await importOriginal<typeof import("../commands/validate.js")>()),
  auditClipDurations: vi.fn(async () => [] as Array<{ level: "error" | "warning"; text: string }>),
}));

vi.mock("./staticProjectServer.js", () => ({
  serveStaticProjectHtml: vi.fn(async () => ({
    url: "http://127.0.0.1:3000",
    close: mocks.serverClose,
  })),
}));

// `preResolveHostileMediaProxies` reaches these two studio-server helpers via
vi.mock("@hyperframes/studio-server/media-codec-map", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/studio-server/media-codec-map")>()),
  scanProjectMediaCodecMap: mocks.scanProjectMediaCodecMap,
  proxyVariantFor: (facts: { hasAlpha?: boolean }) => (facts.hasAlpha ? "vp8" : "h264"),
}));
vi.mock("@hyperframes/studio-server/proxy-transcoder", () => ({
  FfmpegUnavailableError: mocks.FfmpegUnavailableError,
  getProxyCachePath: mocks.getProxyCachePath,
  resolveProxies: (
    projectDir: string,
    sources: Array<{
      sourcePath: string;
      variant: string;
      box?: { width: number; height: number };
    }>,
    onSettled: (index: number) => void = () => {},
    onProgress: (
      index: number,
      progress: { doneSeconds: number; totalSeconds?: number },
    ) => void = () => {},
    signal?: AbortSignal,
  ) => {
    mocks.proxySignal = signal;
    mocks.proxyProgress.feed?.(onProgress);
    return Promise.allSettled(
      sources.map(({ sourcePath, variant, box }, index) =>
        (box
          ? mocks.resolveProxy(projectDir, sourcePath, variant, box)
          : mocks.resolveProxy(projectDir, sourcePath, variant)
        ).finally(() => onSettled(index)),
      ),
    );
  },
}));

const PROJECT: ProjectDir = {
  dir: "/project",
  name: "project",
  indexPath: "/project/index.html",
};

// The overlap grid logs one marker per sample; keep them out of test output. One core keeps
// the browser pass on one page unless a test says otherwise.
beforeEach(() => {
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
  vi.spyOn(os, "availableParallelism").mockReturnValue(1);
  vi.spyOn(os, "freemem").mockReturnValue(16 * 1024 ** 3);
  vi.spyOn(process, "availableMemory").mockReturnValue(16 * 1024 ** 3);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "__hyperframesGeometryCandidates");
  Reflect.deleteProperty(window, "__hyperframesLayoutAudit");
  Reflect.deleteProperty(window, "__contrastAuditPrepare");
  Reflect.deleteProperty(window, "__contrastAuditFinish");
  Reflect.deleteProperty(window, "__contrastAuditRestores");
  Reflect.deleteProperty(window, "__contrastAuditRestoreIfPending");
  mocks.scanProjectMediaCodecMap.mockResolvedValue({});
});

function installSessionMock(page: ReturnType<typeof fakePage>): void {
  const browser = Object.assign(Object.create(null), {
    close: vi.fn(async () => undefined),
    process: () => ({ exitCode: 0, signalCode: null }),
  });
  vi.mocked(openSettledCompositionPage).mockImplementation(
    async (_html: string, _url: string, options: OpenSettledCompositionPageOptions) => {
      options.onBrowser?.(browser);
      options.onBrowserReady?.();
      await options.beforeNavigate?.(page);
      return { page, browser, renderReadyTimedOut: false };
    },
  );
}

function mountCanvasFixture(inner = ""): void {
  document.body.innerHTML = `
    <div data-composition-id="main" data-duration="10" data-width="640" data-height="360">${inner}</div>
  `;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 640 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 360 });
}

it("carries raw browser geometry through the page driver and pipeline", async () => {
  // Vitest's console reads Date.now, which would spend a mocked reading below.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Date, "now")
    .mockReturnValueOnce(100)
    .mockReturnValueOnce(160)
    .mockReturnValueOnce(200)
    .mockReturnValueOnce(240);
  mountCanvasFixture(`
      <section data-composition-file="scenes/hero.html">
        <img id="hero-image" data-layout-name="hero" src="data:image/png;base64,AA==" />
      </section>
  `);
  installRects();
  const page = fakePage();
  installSessionMock(page);

  const result = await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false, frameCheck: {} },
    { kind: "none" },
    runAuditGrid,
  );

  expect(mocks.bundleWithLocalizedFonts).toHaveBeenCalledWith(PROJECT.dir);
  expect(result.layoutIssues).toEqual([
    expect.objectContaining({
      code: "frame_out_of_frame",
      severity: "warning",
      selector: "#hero-image",
      sourceFile: "scenes/hero.html",
      dataAttributes: { "data-layout-name": "hero" },
      bbox: { x: 600, y: 80, width: 200, height: 100 },
      rect: { left: 600, top: 80, right: 800, bottom: 180, width: 200, height: 100 },
      overflow: { right: 160 },
      time: 5,
    }),
  ]);
  expect(result.timings).toMatchObject({ launchSettleMs: 60, seekLoopMs: 40, contrastMs: 0 });
  // Each pass inside the seek loop reports its own time.
  for (const pass of [result.timings.gridMs, result.timings.craftMs, result.timings.overlapMs]) {
    expect(pass).toBeGreaterThanOrEqual(0);
  }
  expect(mocks.serverClose).toHaveBeenCalledOnce();
});

it("splits the samples over a second Chrome and reports what one Chrome reports", async () => {
  mountCanvasFixture(`<p id="copy" data-layout-name="copy">Hi</p>`);
  type Message = ReturnType<typeof fakeConsoleMessage>;
  const run = async (
    cores: number,
    helper: "works" | "crashes" | "hangs after crashing" | "never opens" = "works",
  ) => {
    vi.mocked(os.availableParallelism).mockReturnValue(cores);
    let helperSeeks = 0;
    const pages: ReturnType<typeof fakePage>[] = [];
    const helperPages = new Set<unknown>();
    const handlers = new Map<unknown, ((message: Message) => void)[]>();
    const errorHandlers = new Map<unknown, ((error: Error) => void)[]>();
    const log = (page: unknown, text: string) =>
      handlers.get(page)?.forEach((handler) => handler(fakeConsoleMessage("error", text)));
    const browser = Object.assign(Object.create(null), {
      close: vi.fn(async () => undefined),
      process: () => ({ exitCode: 0, signalCode: null }),
    });
    vi.mocked(openSettledCompositionPage).mockImplementation(
      async (_html: string, _url: string, options: OpenSettledCompositionPageOptions) => {
        const page = fakePage();
        page.on = vi.fn((event: string, handler: (message: Message) => void) => {
          if (event === "console") handlers.set(page, [...(handlers.get(page) ?? []), handler]);
          if (event === "error")
            errorHandlers.set(page, [...(errorHandlers.get(page) ?? []), handler as never]);
        });
        const opened = pages.push(page);
        // Only the first page's open takes prelaunched Chromes.
        if (!("prelaunched" in options)) helperPages.add(page);
        if (helperPages.has(page) && helper === "never opens")
          await new Promise((_, reject) => options.signal?.addEventListener("abort", reject));
        options.onBrowser?.(browser);
        await options.beforeNavigate?.(page);
        log(page, `logged at load on page ${opened}`);
        return { page, browser, renderReadyTimedOut: false };
      },
    );
    vi.mocked(seekCompositionTimeline).mockImplementation(async (page, time) => {
      if (helperPages.has(page) && helper === "crashes" && ++helperSeeks === 2) {
        log(page, "renderer crashed");
        throw new Error("Target closed");
      }
      // A crashed puppeteer page emits "error" and leaves the call pending for good.
      if (helperPages.has(page) && helper === "hangs after crashing" && ++helperSeeks === 2) {
        log(page, "renderer crashed");
        errorHandlers.get(page)?.forEach((handler) => handler(new Error("Page crashed!")));
        return new Promise<never>(() => undefined);
      }
      log(page, `seeked to ${time}`);
    });
    const result = await runBrowserCheck(
      PROJECT,
      { ...DEFAULT_CHECK_OPTIONS, contrast: false },
      { kind: "none" },
      runAuditGrid,
    );
    const seeks = vi.mocked(seekCompositionTimeline).mock.calls;
    vi.mocked(seekCompositionTimeline).mockClear();
    return {
      pages,
      seekingPages: new Set(seeks.map(([page]) => page)).size,
      messages: result.runtimeFindings.map((finding) => `${finding.time} ${finding.message}`),
    };
  };

  const serial = await run(1);
  const split = await run(4);
  expect(serial.pages).toHaveLength(1);
  expect(split.pages).toHaveLength(2);
  expect(split.seekingPages).toBe(2);
  const loads = (messages: string[]) => messages.filter((line) => line.includes("at load"));
  const sampled = (messages: string[]) => messages.filter((line) => !line.includes("at load"));
  expect(loads(serial.messages)).toHaveLength(1);
  expect(loads(split.messages)).toHaveLength(1);
  expect(sampled(split.messages)).toEqual(sampled(serial.messages));
  expect(serial.messages.length).toBeGreaterThan(3);

  const crashed = await run(4, "crashes");
  expect(crashed.seekingPages).toBe(2);
  expect(loads(crashed.messages)).toHaveLength(1);
  expect(sampled(crashed.messages)).toEqual(sampled(serial.messages));
  const hung = await run(4, "hangs after crashing");
  expect(hung.seekingPages).toBe(2);
  expect(loads(hung.messages)).toHaveLength(1);
  expect(sampled(hung.messages)).toEqual(sampled(serial.messages));
  const unopened = await run(4, "never opens");
  expect(unopened.pages).toHaveLength(2);
  expect(unopened.seekingPages).toBe(1);
  expect(loads(unopened.messages)).toHaveLength(1);
  expect(sampled(unopened.messages)).toEqual(sampled(serial.messages));
});

it("runs the dense overlap grid in page tasks of at most 8 samples, keeping each sample's time on what it logs", async () => {
  mountCanvasFixture(
    `<section data-composition-file="scenes/copy.html"><p id="copy" data-layout-name="copy">Hi</p></section>`,
  );
  const page = fakePage();
  const consoleHandlers: ((message: ReturnType<typeof fakeConsoleMessage>) => void)[] = [];
  const onConsole = (message: ReturnType<typeof fakeConsoleMessage>) =>
    consoleHandlers.forEach((handler) => handler(message));
  page.on = vi.fn((event: string, handler: (typeof consoleHandlers)[number]) => {
    if (event === "console") consoleHandlers.push(handler);
  });
  // CDP delivers the page's console calls in order; forward jsdom's the same way.
  vi.spyOn(console, "debug").mockImplementation((text: string) => {
    onConsole(fakeConsoleMessage("debug", text));
  });
  let evaluateCalls = 0;
  let afterGrid = false;
  const evaluate = page.evaluate;
  page.evaluate = vi.fn(async (...args: unknown[]) => {
    // A timer a sample queued fires once the grid's task ends, before Node's next command.
    if (afterGrid) onConsole(fakeConsoleMessage("error", "queued during the grid"));
    afterGrid = typeof args[0] === "string" && args[0].includes("__hfCheckSample");
    evaluateCalls += 1;
    return Reflect.apply(evaluate, page, args);
  });
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  const denseAudits: number[] = [];
  const injectScript = page.addScriptTag;
  page.addScriptTag = vi.fn(async (arg: { content: string }) => {
    await injectScript(arg);
    Reflect.set(window, "__hyperframesOverlapAudit", ({ time }: { time: number }) => {
      if (time !== 5) denseAudits.push(evaluateCalls);
      if (time !== 2.5) return [];
      onConsole(fakeConsoleMessage("error", "thrown at 2.5"));
      const rect = { left: 10, top: 20, right: 110, bottom: 60, width: 100, height: 40 };
      return [
        {
          code: "content_overlap",
          severity: "warning",
          time,
          selector: "#copy",
          message: "x",
          rect,
        },
      ];
    });
  });
  installSessionMock(page);

  const result = await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false },
    { kind: "none" },
    runAuditGrid,
  );

  const lines = stderr.mock.calls.map((call) => String(call[0]));
  expect(lines).toContain("[hyperframes] check: samples 1/1");
  const batches = Math.ceil(denseAudits.length / 8);
  expect(lines).toContain(`[hyperframes] check: overlap ${batches}/${batches}`);
  for (const step of [0, 1, 2]) expect(lines).toContain(`[hyperframes] check: analyze ${step}/3`);
  expect(lines.indexOf("[hyperframes] check: analyze 0/3")).toBeGreaterThan(
    lines.indexOf(`[hyperframes] check: overlap ${batches}/${batches}`),
  );
  expect(denseAudits.length).toBeGreaterThan(10);
  const tasks = new Map<number, number>();
  for (const calls of denseAudits) tasks.set(calls, (tasks.get(calls) ?? 0) + 1);
  const perTask = [...tasks.values()];
  expect(Math.max(...perTask)).toBeLessThanOrEqual(8);
  expect(perTask).toHaveLength(Math.ceil(denseAudits.length / 8));
  expect(result.runtimeFindings).toContainEqual(
    expect.objectContaining({ code: "console_error", message: "thrown at 2.5", time: 2.5 }),
  );
  const queued = result.runtimeFindings.filter(
    (finding) => finding.message === "queued during the grid",
  );
  expect(queued).toHaveLength(perTask.length);
  expect(queued[0]).toMatchObject({ time: 0, timeRange: [0, expect.any(Number)] });
  expect(queued.at(-1)?.timeRange?.[1]).toBe(10);
  expect(
    result.runtimeFindings.find((finding) => finding.message === "thrown at 2.5"),
  ).not.toHaveProperty("timeRange");
  expect(result.layoutIssues).toContainEqual(
    expect.objectContaining({
      code: "content_overlap",
      selector: "#copy",
      sourceFile: "scenes/copy.html",
      dataAttributes: { "data-layout-name": "copy" },
      bbox: { x: 10, y: 20, width: 100, height: 40 },
      time: 2.5,
    }),
  );
});

it("takes no contrast screenshot at a sample with no text to measure", async () => {
  mountCanvasFixture();
  const page = fakePage();
  page.screenshot = vi.fn(async () => "c3R1Yg==");
  installSessionMock(page);

  await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: true },
    { kind: "none" },
    runAuditGrid,
  );

  expect(page.screenshot).not.toHaveBeenCalled();
});

it("measures text on its own opaque fill without a contrast screenshot", async () => {
  vi.spyOn(Date, "now").mockReturnValue(100);
  mountCanvasFixture(`<div id="headline">Readable copy</div>`);
  const headline = document.querySelector("#headline");
  if (!headline) throw new Error("Contrast fixture failed to mount");
  vi.spyOn(headline, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 50, 300, 40));
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        color: "rgb(255,255,255)",
        fill: "",
        backgroundColor: "rgb(0,0,0)",
        backgroundImage: "none",
        fontSize: "32px",
        fontWeight: "700",
      }) as unknown as CSSStyleDeclaration,
  );
  const page = fakePage();
  page.screenshot = vi.fn(async () => "c3R1Yg==");
  installSessionMock(page);

  const result = await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: true },
    { kind: "none" },
    runAuditGrid,
  );

  expect(result.contrastChecked).toBeGreaterThan(0);
  expect(result.contrastFindings).toEqual([]);
  expect(page.screenshot).not.toHaveBeenCalled();
});

it("uses check --timeout for both navigation and render-ready settling, and loads media near the playhead", async () => {
  mountCanvasFixture();
  const page = fakePage();
  installSessionMock(page);

  await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false, timeout: 30_000 },
    { kind: "none" },
    runAuditGrid,
  );

  expect(openSettledCompositionPage).toHaveBeenCalledWith(
    expect.stringMatching(
      /<meta name="hyperframes-studio-preview" content="capture">[\s\S]*<html>/,
    ),
    "http://127.0.0.1:3000",
    expect.objectContaining({
      navigationTimeoutMs: 30_000,
      renderReadyTimeoutMs: 30_000,
    }),
  );
});

it("fails at once when the page crashes, instead of waiting out the deadline", async () => {
  mountCanvasFixture(`<p id="copy" data-layout-name="copy">Hi</p>`);
  const page = fakePage();
  const onError: Array<(error: Error) => void> = [];
  page.on = vi.fn((event: string, handler: (error: Error) => void) => {
    if (event === "error") onError.push(handler);
  });
  installSessionMock(page);
  // A crashed puppeteer page emits "error" and leaves the call pending for good.
  vi.mocked(seekCompositionTimeline).mockImplementation(async () => {
    for (const handler of onError) handler(new Error("Page crashed!"));
    return new Promise<never>(() => undefined);
  });

  try {
    await expect(
      runBrowserCheck(
        PROJECT,
        { ...DEFAULT_CHECK_OPTIONS, contrast: false },
        { kind: "none" },
        runAuditGrid,
      ),
    ).rejects.toThrow("The page crashed: Page crashed!");
  } finally {
    // clearAllMocks keeps implementations, and a seek that never settles would hang every later test.
    vi.mocked(seekCompositionTimeline).mockImplementation(async () => undefined);
  }
});

it("round-trips the browser script's raw contrast candidates back into finish", async () => {
  // The U2 regression class: Node parses prepare's candidates for reporting,
  // but must hand the UNTOUCHED objects back to __contrastAuditFinish — the
  // page script samples pixels via its own bbox shape (w/h). A normalized
  // candidate (width/height) makes every sample rect NaN and the audit
  // silently reports zero checked elements as green.
  vi.spyOn(Date, "now").mockReturnValue(100);
  mountCanvasFixture(`
      <div id="headline">Readable copy</div>
  `);
  const root = document.querySelector("[data-composition-id]");
  const headline = document.querySelector("#headline");
  if (!root || !headline) throw new Error("Contrast fixture failed to mount");
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 640, 360));
  vi.spyOn(headline, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 50, 300, 40));
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        color: "rgb(255,255,255)",
        fill: "",
        backgroundColor: "rgba(0,0,0,0)",
        backgroundImage: "none",
        fontSize: "32px",
        fontWeight: "700",
      }) as unknown as CSSStyleDeclaration,
  );

  // happy-dom can't decode PNGs: stub Image (sync onload) and the canvas 2D
  // context the way layout-audit.browser.test.ts's contrast harness does, so
  // the REAL __contrastAuditFinish runs its sampling path end to end.
  class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 640;
    naturalHeight = 360;

    set src(_value: string) {
      this.onload?.();
    }
  }
  vi.stubGlobal("Image", MockImage);
  const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext") as unknown as {
    mockReturnValue(value: CanvasRenderingContext2D): void;
  };
  getContextSpy.mockReturnValue({
    drawImage() {},
    getImageData() {
      return { data: new Uint8ClampedArray(640 * 360 * 4).fill(255) };
    },
  } as unknown as CanvasRenderingContext2D);

  const received: Array<Record<string, unknown>> = [];
  const page = fakePage();
  const injectScript = page.addScriptTag;
  page.addScriptTag = vi.fn(async (arg: { content: string }) => {
    await injectScript(arg);
    const w = window as unknown as {
      __contrastAuditFinish?: ((...args: unknown[]) => Promise<unknown>) & { wrapped?: boolean };
    };
    const finish = w.__contrastAuditFinish;
    if (finish && !finish.wrapped) {
      const wrapper = Object.assign(
        async (...args: unknown[]) => {
          const candidates = args[2];
          if (Array.isArray(candidates)) {
            received.push(...(candidates as Array<Record<string, unknown>>));
          }
          return finish(...args);
        },
        { wrapped: true },
      );
      w.__contrastAuditFinish = wrapper;
    }
  });
  page.screenshot = vi.fn(async () => "c3R1Yg==");
  installSessionMock(page);

  await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: true },
    { kind: "none" },
    runAuditGrid,
  );

  expect(received.length).toBeGreaterThan(0);
  for (const candidate of received) {
    const bbox = candidate.bbox as Record<string, unknown>;
    // The page script's own shape (w/h), not Node's envelope shape (width/height):
    expect(typeof bbox.w).toBe("number");
    expect(typeof bbox.h).toBe("number");
  }
});

it.each([
  { snapshots: true, shots: 2, saved: ["text-visible-base64"] },
  { snapshots: false, shots: 1, saved: [] },
])(
  "takes $shots contrast screenshot(s) when snapshots is $snapshots, overview after text restores",
  async ({ snapshots, shots, saved }) => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    mountCanvasFixture(`<div id="headline">Readable copy</div>`);
    const root = document.querySelector("[data-composition-id]");
    const headline = document.querySelector<HTMLElement>("#headline");
    if (!root || !headline) throw new Error("Contrast fixture failed to mount");
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 640, 360));
    vi.spyOn(headline, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 50, 300, 40));
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          display: "block",
          visibility: "visible",
          opacity: "1",
          color: "rgb(255,255,255)",
          fill: "",
          clipPath: "none",
          fontSize: "32px",
          fontWeight: "700",
        }) as unknown as CSSStyleDeclaration,
    );

    const page = fakePage();
    const injectScript = page.addScriptTag;
    page.addScriptTag = vi.fn(async (arg: { content: string }) => {
      await injectScript(arg);
      const w = window as unknown as {
        __contrastAuditFinish?: (...args: unknown[]) => Promise<unknown>;
        __contrastAuditRestoreIfPending?: () => void;
      };
      if (w.__contrastAuditFinish) {
        w.__contrastAuditFinish = async () => {
          w.__contrastAuditRestoreIfPending?.();
          return [];
        };
      }
    });
    page.screenshot = vi.fn(async () =>
      headline.style.getPropertyValue("color") === "transparent"
        ? "text-hidden-base64"
        : "text-visible-base64",
    );
    installSessionMock(page);

    const result = await runBrowserCheck(
      PROJECT,
      { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: true, snapshots },
      { kind: "none" },
      runAuditGrid,
    );

    expect(page.screenshot).toHaveBeenCalledTimes(shots);
    expect(page.screenshot).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        clip: { x: 50, y: 50, width: 300, height: 40 },
        captureBeyondViewport: false,
      }),
    );
    expect(seekCompositionTimeline).toHaveBeenCalledWith(page, 5, SCREENSHOT_SEEK_OPTIONS);
    expect(result.screenshots.map((shot) => shot.pngBase64)).toEqual(saved);
  },
);

describe("skipContrastInMotion", () => {
  type Tween = { target: string; start: number; duration: number; repeat?: number };

  async function contrastFindings(
    tweens: Tween[],
    skipContrastInMotion: boolean | undefined,
    snapshots = false,
  ) {
    vi.spyOn(Date, "now").mockReturnValue(100);
    mountCanvasFixture(`<div id="scene"><div id="headline">Low contrast copy</div></div>`);
    const root = document.querySelector("[data-composition-id]");
    const headline = document.querySelector("#headline");
    if (!root || !headline) throw new Error("Contrast fixture failed to mount");
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 640, 360));
    vi.spyOn(headline, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 50, 300, 40));
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          display: "block",
          visibility: "visible",
          opacity: "1",
          color: "rgb(250,250,250)",
          fill: "",
          backgroundColor: "rgba(0,0,0,0)",
          backgroundImage: "none",
          fontSize: "32px",
          fontWeight: "700",
        }) as unknown as CSSStyleDeclaration,
    );
    class MockImage {
      onload: (() => void) | null = null;
      naturalWidth = 640;
      naturalHeight = 360;
      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("Image", MockImage);
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext") as unknown as {
      mockReturnValue(value: CanvasRenderingContext2D): void;
    };
    getContextSpy.mockReturnValue({
      drawImage() {},
      getImageData() {
        return { data: new Uint8ClampedArray(640 * 360 * 4).fill(255) };
      },
    } as unknown as CanvasRenderingContext2D);
    const main = {
      time: () => 5,
      repeat: () => 0,
      globalTime: (local: number) => local,
      getChildren: () => children,
    };
    const children = tweens.map((tween) => ({
      parent: main,
      targets: () => [document.querySelector(tween.target)],
      duration: () => tween.duration,
      totalDuration: () => tween.duration * ((tween.repeat ?? 0) + 1),
      repeat: () => tween.repeat ?? 0,
      globalTime: (local: number) => tween.start + local,
      startTime: () => tween.start,
      endTime: () => tween.start + tween.duration,
      timeScale: () => 1,
      paused: () => false,
    }));
    if (tweens.length > 0) {
      Reflect.set(window, "__timelines", {
        main,
      });
    }
    const page = fakePage();
    const annotations: string[] = [];
    page.screenshot = vi.fn(async () => {
      annotations.push(document.getElementById("__hyperframesCheckAnnotations")?.textContent ?? "");
      return "c3R1Yg==";
    });
    installSessionMock(page);
    try {
      const result = await runBrowserCheck(
        PROJECT,
        { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: true, skipContrastInMotion, snapshots },
        { kind: "none" },
        runAuditGrid,
      );
      return { ...result, annotations };
    } finally {
      Reflect.deleteProperty(window, "__timelines");
    }
  }

  const fadingIn: Tween[] = [{ target: "#headline", start: 4.8, duration: 0.6 }];

  it("drops a failure measured mid-tween only when enabled", async () => {
    const off = await contrastFindings(fadingIn, undefined);
    expect(off.contrastFindings).toEqual([
      expect.objectContaining({ selector: "#headline", severity: "error" }),
    ]);
    expect(off.contrastFindings[0]).not.toHaveProperty("inMotion");
    expect((await contrastFindings(fadingIn, true)).contrastFindings).toEqual([]);
  });

  it("removes filtered failures from checked counts and snapshot annotations", async () => {
    const off = await contrastFindings(fadingIn, undefined, true);
    expect(off.contrastChecked).toBe(1);
    expect(off.annotations.some((text) => text.includes("contrast_aa_failure"))).toBe(true);
    const on = await contrastFindings(fadingIn, true, true);
    expect(on.contrastChecked).toBe(0);
    expect(on.contrastPassed).toBe(0);
    expect(on.annotations.every((text) => !text.includes("contrast_aa_failure"))).toBe(true);
    expect(on.screenshots).toHaveLength(1);
  });

  it("still reports the same text once its tween has ended", async () => {
    const settled: Tween[] = [{ target: "#headline", start: 1, duration: 0.6 }];
    expect((await contrastFindings(settled, true)).contrastFindings).toHaveLength(1);
  });

  it("still reports text under only ambient tweens on an ancestor", async () => {
    const ambient: Tween[] = [
      { target: "#scene", start: 0, duration: 10 },
      { target: "#scene", start: 0, duration: 2, repeat: -1 },
    ];
    expect((await contrastFindings(ambient, true)).contrastFindings).toHaveLength(1);
  });

  it("still reports text on a page without GSAP", async () => {
    expect((await contrastFindings([], true)).contrastFindings).toHaveLength(1);
  });
});

it("carries validate's clip-duration audit into the runtime findings", async () => {
  vi.spyOn(Date, "now").mockReturnValue(100);
  mountCanvasFixture();
  const validateModule = await import("../commands/validate.js");
  vi.mocked(validateModule.auditClipDurations).mockResolvedValue([
    {
      level: "warning",
      text: "Audio is 22.10s but its slot (data-duration) is 30.00s — the slot is shortened to the media length when rendered.",
    },
  ]);
  const page = fakePage();
  installSessionMock(page);

  const result = await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false },
    { kind: "none" },
    runAuditGrid,
  );

  expect(result.runtimeFindings).toEqual([
    expect.objectContaining({
      code: "clip_media_fit",
      severity: "warning",
      message: expect.stringContaining("slot is shortened"),
    }),
  ]);
});

it("reports each video whose browser-playable copy could not be made as a warning finding", async () => {
  mountCanvasFixture();
  mocks.scanProjectMediaCodecMap.mockResolvedValue({
    "/media/hlg.mp4": {
      codecName: "hevc",
      browserHostile: true,
      representativeMime: null,
      hasAlpha: false,
    },
  });
  mocks.resolveProxy.mockRejectedValue(
    new Error("HDR proxying requires ffmpeg zscale/tonemap filters (libzimg)"),
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  installSessionMock(fakePage());

  const result = await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false },
    { kind: "none" },
    runAuditGrid,
  );

  expect(result.runtimeFindings).toContainEqual(
    expect.objectContaining({
      code: "media_proxy_failed",
      severity: "warning",
      message: expect.stringContaining(
        "media/hlg.mp4: HDR proxying requires ffmpeg zscale/tonemap filters (libzimg)",
      ),
    }),
  );
});

it("surfaces the runtime's media-proxy-fallback console.info line as an info finding, ignoring unrelated info logs", async () => {
  vi.spyOn(Date, "now").mockReturnValue(100);
  mountCanvasFixture();
  const page = fakePage();
  const fallbackMessage = fakeConsoleMessage(
    "info",
    '[hyperframes] runtime_media_proxy_fallback: "assets/clip.mp4" uses a codec (hevc) this browser can\'t decode; ' +
      "auto-swapped to an authoring proxy for this preview only. Render output is unaffected.",
  );
  const unrelatedInfo = fakeConsoleMessage("info", "[hyperframes] render runtime fps 30");
  const authorInfo = fakeConsoleMessage("info", "debug runtime_media_proxy_probe");
  page.on = vi.fn(
    (event: string, handler: (message: ReturnType<typeof fakeConsoleMessage>) => void) => {
      if (event === "console") {
        handler(fallbackMessage);
        handler(unrelatedInfo);
        handler(authorInfo);
      }
    },
  );
  installSessionMock(page);

  const result = await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false },
    { kind: "none" },
    runAuditGrid,
  );

  expect(result.runtimeFindings).toContainEqual(
    expect.objectContaining({
      code: "media_proxy_fallback",
      severity: "info",
      message: fallbackMessage.text(),
    }),
  );
  expect(result.runtimeFindings.some((finding) => finding.message === unrelatedInfo.text())).toBe(
    false,
  );
  expect(result.runtimeFindings.some((finding) => finding.message === authorInfo.text())).toBe(
    false,
  );
});

it("surfaces the runtime's media-proxy-unavailable console.info line as its own info finding", async () => {
  vi.spyOn(Date, "now").mockReturnValue(100);
  mountCanvasFixture();
  const page = fakePage();
  const unavailableMessage = fakeConsoleMessage(
    "info",
    '[hyperframes] runtime_media_proxy_unavailable: "https://cdn.example.com/video.mp4" (cross_origin): ' +
      "video reports zero decodable width but its source is cross-origin; no local proxy can be served for it",
  );
  page.on = vi.fn(
    (event: string, handler: (message: ReturnType<typeof fakeConsoleMessage>) => void) => {
      if (event === "console") {
        handler(unavailableMessage);
      }
    },
  );
  installSessionMock(page);

  const result = await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false },
    { kind: "none" },
    runAuditGrid,
  );

  expect(result.runtimeFindings).toContainEqual(
    expect.objectContaining({
      code: "media_proxy_unavailable",
      severity: "info",
      message: unavailableMessage.text(),
    }),
  );
});

it("surfaces the runtime's web-audio-bypass console.info line as its own info finding", async () => {
  // The whole complaint in #3458 is that nothing was reported. The runtime
  // emits this from media DISCOVERY, not from playback scheduling, precisely
  // because `check` seeks and never calls play() — a diagnostic raised from
  // the transport would never reach this scraper.
  vi.spyOn(Date, "now").mockReturnValue(100);
  mountCanvasFixture();
  const page = fakePage();
  const bypassMessage = fakeConsoleMessage(
    "info",
    '[hyperframes] runtime_web_audio_bypass: "https://cdn.example.com/track.mp3" ' +
      "(cross_origin_no_cors): Web Audio capture withheld; the track plays through native " +
      "HTMLMediaElement output. Native playback cannot reproduce: fx-chain. Fix: proxy or download " +
      "the asset to a same-origin URL to keep it.",
  );
  const authorInfo = fakeConsoleMessage("info", "debug runtime_web_audio_bypass lookalike");
  page.on = vi.fn(
    (event: string, handler: (message: ReturnType<typeof fakeConsoleMessage>) => void) => {
      if (event === "console") {
        handler(bypassMessage);
        handler(authorInfo);
      }
    },
  );
  installSessionMock(page);

  const result = await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false },
    { kind: "none" },
    runAuditGrid,
  );

  expect(result.runtimeFindings).toContainEqual(
    expect.objectContaining({
      code: "web_audio_bypass",
      severity: "info",
      message: bypassMessage.text(),
    }),
  );
  // Prefix-anchored, so a composition author's own console.info that merely
  // mentions the code is not promoted into a finding.
  expect(result.runtimeFindings.some((finding) => finding.message === authorInfo.text())).toBe(
    false,
  );
});

it("elevates and deduplicates WebGPU validation warnings while preserving ordinary warnings", async () => {
  vi.spyOn(Date, "now").mockReturnValue(100);
  mountCanvasFixture();
  const page = fakePage();
  const validationFailure = fakeConsoleMessage(
    "warn",
    "WebGPU uncaptured error: GPUValidationError: Destroyed texture used in a submit",
  );
  const ordinaryWarning = fakeConsoleMessage("warn", "Optional caption font was not loaded");
  page.on = vi.fn(
    (event: string, handler: (message: ReturnType<typeof fakeConsoleMessage>) => void) => {
      if (event === "console") {
        handler(validationFailure);
        handler(validationFailure);
        handler(ordinaryWarning);
      }
    },
  );
  installSessionMock(page);

  const result = await runBrowserCheck(
    PROJECT,
    { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false },
    { kind: "none" },
    runAuditGrid,
  );

  expect(result.runtimeFindings).toContainEqual(
    expect.objectContaining({
      code: "webgpu_runtime_error",
      severity: "error",
      message: `${validationFailure.text()} (repeated 2 times)`,
    }),
  );
  expect(result.runtimeFindings).toContainEqual(
    expect.objectContaining({
      code: "console_warning",
      severity: "warning",
      message: ordinaryWarning.text(),
    }),
  );
});

describe("collectSeekClock", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "__timelines");
    Reflect.deleteProperty(window, "__hfSeekClocks");
  });

  const seekPage = { evaluate: async (fn: () => unknown) => fn() } as unknown as Parameters<
    typeof collectSeekClock
  >[0];

  it("skips a custom clock whose time() returns null instead of reading it as 0", async () => {
    Reflect.set(window, "__timelines", {
      root: { duration: () => 9, seek() {}, time: () => null },
      card: { duration: () => 9, seek() {}, time: () => 3 },
    });

    const clocks = await collectSeekClock(seekPage);

    expect(clocks.map((clock) => clock.time)).toEqual([3]);
  });
});

describe("keepBrokenImageAborts", () => {
  const draft = (url: string, abortedImage: boolean) => ({
    code: "request_failed",
    severity: "error" as const,
    message: `Failed to load ${url}`,
    time: 0,
    url,
    abortedImage,
  });

  it("keeps an aborted image only when it is still broken, and every other failure", () => {
    const swappedPast = draft("http://h/seq/0004.png", true);
    const stuck = draft("http://h/plate.png", true);
    const missing = draft("http://h/gone.png", false);
    const kept = keepBrokenImageAborts(
      [swappedPast, stuck, missing],
      new Set(["http://h/plate.png"]),
    );
    expect(kept).toEqual([stuck, missing]);
  });

  it("reports an aborted image a page still shows broken, not one swapped away or one that decodes", async () => {
    const base = "http://127.0.0.1:3000/assets";
    mountCanvasFixture(
      `<img id="stuck" src="${base}/plate.png"><img id="fine" src="${base}/seq/0012.png">`,
    );
    const stuck = document.getElementById("stuck") as HTMLImageElement;
    const fine = document.getElementById("fine") as HTMLImageElement;
    stuck.decode = () => Promise.reject(new Error("broken"));
    fine.decode = () => Promise.resolve();
    const aborted = (url: string) => ({
      url: () => url,
      failure: () => ({ errorText: "net::ERR_ABORTED" }),
      resourceType: () => "image",
    });
    const page = fakePage();
    page.on = vi.fn((event: string, handler: (request: ReturnType<typeof aborted>) => void) => {
      if (event !== "requestfailed") return;
      for (const url of ["seq/0004.png", "seq/0012.png", "plate.png"])
        handler(aborted(`${base}/${url}`));
    });
    installSessionMock(page);

    const result = await runBrowserCheck(
      PROJECT,
      { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false },
      { kind: "none" },
      runAuditGrid,
    );

    const failed = result.runtimeFindings.filter((finding) => finding.code === "request_failed");
    expect(failed.map((finding) => finding.message)).toEqual([
      "Failed to load assets/plate.png: net::ERR_ABORTED",
    ]);
  });

  it("does not report an aborted image whose reload is still pending at the cap", async () => {
    const url = "http://127.0.0.1:3000/assets/slow.png";
    mountCanvasFixture(`<img id="slow" src="${url}">`);
    (document.getElementById("slow") as HTMLImageElement).decode = () => new Promise(() => {});
    const page = fakePage();
    page.on = vi.fn((event: string, handler: (request: unknown) => void) => {
      if (event !== "requestfailed") return;
      handler({
        url: () => url,
        failure: () => ({ errorText: "net::ERR_ABORTED" }),
        resourceType: () => "image",
      });
    });
    installSessionMock(page);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const checked = runBrowserCheck(
        PROJECT,
        { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false },
        { kind: "none" },
        runAuditGrid,
      );
      await vi.runAllTimersAsync();
      const result = await checked;
      expect(result.runtimeFindings.filter((finding) => finding.code === "request_failed")).toEqual(
        [],
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("samplingBrowserCount", () => {
  const GB = 1024 ** 3;
  it("uses a second Chrome only with a spare core, 250 MB free each and more than one sample", () => {
    expect(samplingBrowserCount(DEFAULT_CHECK_OPTIONS, 8, 16 * GB)).toBe(2);
    expect(samplingBrowserCount(DEFAULT_CHECK_OPTIONS, 3, 1 * GB)).toBe(2);
    expect(samplingBrowserCount(DEFAULT_CHECK_OPTIONS, 2, 16 * GB)).toBe(1);
    expect(samplingBrowserCount(DEFAULT_CHECK_OPTIONS, 1, 2 * GB)).toBe(1);
    expect(samplingBrowserCount(DEFAULT_CHECK_OPTIONS, 8, 400 * 1024 ** 2)).toBe(1);
    expect(samplingBrowserCount({ ...DEFAULT_CHECK_OPTIONS, at: [1] }, 8, 16 * GB)).toBe(1);
  });

  it("counts a container's memory limit, not the host's free memory", () => {
    vi.mocked(os.freemem).mockReturnValue(100 * GB);
    vi.mocked(process.availableMemory).mockReturnValue(400 * 1024 ** 2);
    expect(samplingBrowserCount(DEFAULT_CHECK_OPTIONS, 8)).toBe(1);
    vi.mocked(process.availableMemory).mockReturnValue(16 * GB);
    expect(samplingBrowserCount(DEFAULT_CHECK_OPTIONS, 8)).toBe(2);
  });
});

describe("mergeHelperDrafts", () => {
  const draft = (message: string, time: number) =>
    ({ code: "console_error", severity: "error", message, time }) as const;
  it("orders the helper's sample-loop messages by time and drops its load and same-time repeats", () => {
    const primary = {
      drafts: [draft("load", 0), draft("at 0", 0), draft("at 2", 2), draft("dense", 0)],
      start: 1,
      end: 3,
    };
    const helper = {
      drafts: [draft("load", 0), draft("at 1", 1), draft("at 2", 2), draft("at 3", 3)],
      start: 1,
      end: 4,
    };
    expect(mergeHelperDrafts(primary, helper).map((entry) => entry.message)).toEqual([
      "load",
      "at 0",
      "at 1",
      "at 2",
      "at 3",
      "dense",
    ]);
  });

  it("orders samples the first page redid after its own later ones", () => {
    const primary = {
      drafts: [draft("load", 0), draft("at 0", 0), draft("at 2", 2), draft("at 1", 1)],
      start: 1,
      end: 4,
    };
    const dropped = { drafts: [draft("at 1", 1)], start: Infinity, end: Infinity };
    expect(mergeHelperDrafts(primary, dropped).map((entry) => entry.message)).toEqual([
      "load",
      "at 0",
      "at 1",
      "at 2",
    ]);
  });

  it("adds nothing from a helper that never sampled", () => {
    const primary = { drafts: [draft("load", 0)], start: 1, end: 1 };
    const helper = {
      drafts: [draft("load", 0)],
      start: Number.POSITIVE_INFINITY,
      end: Number.POSITIVE_INFINITY,
    };
    expect(mergeHelperDrafts(primary, helper)).toEqual(primary.drafts);
  });
});

describe("dropFailedProxyEchoes", () => {
  it("keeps one finding for a failed proxy and drops the preview's repeats of it", () => {
    const at = (code: string, message: string, url?: string) =>
      ({ code, severity: "info", message, time: 0, url }) as const;
    const failed = at("media_proxy_failed", "Could not make a copy of media/a.mov");
    const unrelated502 = at(
      "http_error",
      "502 loading media/b.mov",
      "http://127.0.0.1:3000/media/b.mov?hf-proxy=h264",
    );
    const originalMissing = at(
      "http_error",
      "404 loading media/a.mov",
      "http://127.0.0.1:3000/media/a.mov",
    );

    const kept = dropFailedProxyEchoes(
      [
        failed,
        at(
          "http_error",
          "502 loading media/my clip.mov",
          "http://127.0.0.1:3000/media/my%20clip.mov?hf-proxy=h264",
        ),
        at(
          "http_error",
          "502 loading media/a.mov",
          "http://127.0.0.1:3000/media/a.mov?hf-proxy=h264",
        ),
        at(
          "media_proxy_fallback",
          '[hyperframes] runtime_media_proxy_fallback: "media/a.mov" uses a codec (prores)',
        ),
        at(
          "media_proxy_unavailable",
          '[hyperframes] runtime_media_proxy_unavailable: "http://127.0.0.1:3000/media/a.mov" (proxy_playback_failed): x',
        ),
        unrelated502,
        originalMissing,
      ],
      new Set(["/media/a.mov", "/media/my clip.mov"]),
    );

    expect(kept).toEqual([failed, unrelated502, originalMissing]);
  });
});

describe("preResolveHostileMediaProxies", () => {
  const dirs: string[] = [];
  const mkProjectDir = (): string => {
    const d = mkdtempSync(join(tmpdir(), "hf-check-preresolve-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("awaits resolveProxy for every browser-hostile entry before returning", async () => {
    const projectDir = mkProjectDir();
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mp4": {
        codecName: "hevc",
        browserHostile: true,
        representativeMime: null,
        hasAlpha: false,
      },
      "/plain.mp4": {
        codecName: "h264",
        browserHostile: false,
        representativeMime: null,
        hasAlpha: false,
      },
    });
    let resolveTranscode: (() => void) | undefined;
    mocks.resolveProxy.mockImplementation(
      () =>
        new Promise<string>((resolveIt) => {
          resolveTranscode = () => resolveIt("/cache/clip.mp4");
        }),
    );

    let settled = false;
    const pending = preResolveHostileMediaProxies(projectDir, "<html></html>").then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.resolveProxy).toHaveBeenCalledTimes(1);
    expect(mocks.resolveProxy).toHaveBeenCalledWith(
      projectDir,
      join(projectDir, "clip.mp4"),
      "h264",
    );
    expect(settled).toBe(false); // still waiting on the hostile entry's transcode

    resolveTranscode?.();
    await pending;
    expect(settled).toBe(true);
  });

  it("makes the copy at the size that fills the composition, not at the source size", async () => {
    const projectDir = mkProjectDir();
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mp4": {
        codecName: "hevc",
        browserHostile: true,
        representativeMime: null,
        hasAlpha: false,
      },
    });
    mocks.resolveProxy.mockResolvedValue("/cache/clip.mp4");
    const html =
      '<html><body><div data-composition-id="root" data-width="1920" data-height="1080"></div></body></html>';

    await preResolveHostileMediaProxies(projectDir, html);

    // The page asks for the quantized stage size, so the copy and its cache check use that box.
    const box = { width: 2048, height: 1218 };
    expect(mocks.resolveProxy).toHaveBeenCalledWith(
      projectDir,
      join(projectDir, "clip.mp4"),
      "h264",
      box,
    );
    expect(mocks.getProxyCachePath).toHaveBeenCalledWith(
      projectDir,
      join(projectDir, "clip.mp4"),
      "h264",
      box,
    );
  });

  it("does nothing (no scan, no resolveProxy) when autoProxy is off in hyperframes.json", async () => {
    const projectDir = mkProjectDir();
    writeFileSync(
      join(projectDir, "hyperframes.json"),
      JSON.stringify({ media: { autoProxy: false } }),
    );

    await preResolveHostileMediaProxies(projectDir, "<html></html>");

    expect(mocks.scanProjectMediaCodecMap).not.toHaveBeenCalled();
    expect(mocks.resolveProxy).not.toHaveBeenCalled();
  });

  it("returns a resolveProxy rejection as a warning instead of throwing", async () => {
    const projectDir = mkProjectDir();
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mp4": {
        codecName: "hevc",
        browserHostile: true,
        representativeMime: null,
        hasAlpha: false,
      },
    });
    mocks.resolveProxy.mockRejectedValue(new Error("ffmpeg exited with code 1"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(preResolveHostileMediaProxies(projectDir, "<html></html>")).resolves.toEqual({
      findings: [
        expect.objectContaining({
          code: "media_proxy_failed",
          severity: "warning",
          message: expect.stringContaining("clip.mp4: ffmpeg exited with code 1"),
        }),
      ],
      failedPaths: new Set(["/clip.mp4"]),
      files: [{ file: "clip.mp4", state: "failed", reason: "ffmpeg exited with code 1" }],
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("media proxy pre-resolve: 0/1 ready, 1 failed"),
    );
  });

  it("reports an unusable ffmpeg once for every video, without promising a working render", async () => {
    const projectDir = mkProjectDir();
    const hevc = {
      codecName: "hevc",
      browserHostile: true,
      representativeMime: null,
      hasAlpha: false,
    };
    mocks.scanProjectMediaCodecMap.mockResolvedValue({ "/a.mp4": hevc, "/b.mp4": hevc });
    mocks.resolveProxy.mockRejectedValue(
      new mocks.FfmpegUnavailableError("ffmpeg binary not found"),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { findings } = await preResolveHostileMediaProxies(projectDir, "<html></html>");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("copies of a.mp4, b.mp4: ffmpeg binary not found");
    expect(findings[0]?.message).not.toContain("render");
  });

  // `check --json` stdout must stay pure JSON, so these lines belong on stderr.
  it("writes the pre-resolve summary to stderr and leaves stdout untouched", async () => {
    const projectDir = mkProjectDir();
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mp4": {
        codecName: "hevc",
        browserHostile: true,
        representativeMime: null,
        hasAlpha: false,
      },
    });
    mocks.resolveProxy.mockResolvedValue("/cache/clip.mp4");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await preResolveHostileMediaProxies(projectDir, "<html></html>");

    expect(errorSpy.mock.calls.map(([line]) => line)).toEqual([
      expect.stringMatching(/^\[hyperframes\] Making browser-playable copies of 1 video /),
      "[hyperframes] browser-playable copies: 1/1",
      expect.stringMatching(
        /^\[hyperframes\] media proxy pre-resolve: 1\/1 ready, 0 failed \(\d+ms\)$/,
      ),
    ]);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("says how far a copy has got every few seconds, so a slow copy reads as slow", async () => {
    vi.useFakeTimers();
    try {
      const projectDir = mkProjectDir();
      mocks.scanProjectMediaCodecMap.mockResolvedValue({
        "/clip.mov": {
          codecName: "hevc",
          browserHostile: true,
          representativeMime: null,
          hasAlpha: false,
        },
      });
      let finish: (() => void) | undefined;
      mocks.resolveProxy.mockImplementation(
        () => new Promise<string>((done) => (finish = () => done("/cache/clip.mp4"))),
      );
      mocks.proxyProgress.feed = (report) => report(0, { doneSeconds: 30, totalSeconds: 120 });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const pending = preResolveHostileMediaProxies(projectDir, "<html></html>");
      await vi.advanceTimersByTimeAsync(10_000);
      mocks.proxyProgress.feed = undefined;
      finish?.();
      await pending;

      expect(errorSpy.mock.calls.map(([line]) => line)).toContain(
        "[hyperframes] making browser-playable copies: 0 of 1 done. clip.mov: 25% (10s so far)",
      );
    } finally {
      mocks.proxyProgress.feed = undefined;
      vi.useRealTimers();
    }
  });

  it("stops reporting a copy once it is done, so a finished one is not read as stuck", async () => {
    vi.useFakeTimers();
    try {
      const projectDir = mkProjectDir();
      const hostile = {
        codecName: "hevc",
        browserHostile: true,
        representativeMime: null,
        hasAlpha: false,
      };
      mocks.scanProjectMediaCodecMap.mockResolvedValue({ "/a.mov": hostile, "/b.mov": hostile });
      let finishB: (() => void) | undefined;
      mocks.resolveProxy.mockImplementation((_dir, sourcePath) =>
        sourcePath.endsWith("a.mov")
          ? Promise.resolve("/cache/a.mp4")
          : new Promise<string>((done) => (finishB = () => done("/cache/b.mp4"))),
      );
      mocks.proxyProgress.feed = (report) => {
        report(0, { doneSeconds: 118, totalSeconds: 120 });
        report(1, { doneSeconds: 30, totalSeconds: 120 });
      };
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const pending = preResolveHostileMediaProxies(projectDir, "<html></html>");
      await vi.advanceTimersByTimeAsync(10_000);
      mocks.proxyProgress.feed = undefined;
      finishB?.();
      await pending;

      const lines = errorSpy.mock.calls.map(([line]) => String(line));
      expect(lines).toContain(
        "[hyperframes] making browser-playable copies: 1 of 2 done. b.mov: 25% (10s so far)",
      );
      expect(lines.some((line) => line.includes(" a.mov: "))).toBe(false);
    } finally {
      mocks.proxyProgress.feed = undefined;
      vi.useRealTimers();
    }
  });

  it("ends the copies it is making when it is stopped by a signal", async () => {
    const projectDir = mkProjectDir();
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/clip.mov": {
        codecName: "hevc",
        browserHostile: true,
        representativeMime: null,
        hasAlpha: false,
      },
    });
    let finish: (() => void) | undefined;
    mocks.resolveProxy.mockImplementation(
      () => new Promise<string>((done) => (finish = () => done("/cache/clip.mp4"))),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const pending = preResolveHostileMediaProxies(projectDir, "<html></html>");
    await vi.waitFor(() => expect(mocks.proxySignal).toBeDefined());
    expect(mocks.proxySignal!.aborted).toBe(false);
    for (const listener of mocks.stopListeners) listener();

    expect(mocks.proxySignal!.aborted).toBe(true);
    finish?.();
    await pending;
    expect(mocks.stopListeners.size).toBe(0);
  });

  it("says it is making copies, and counts them, only when some are not made yet", async () => {
    const projectDir = mkProjectDir();
    const codec = {
      codecName: "hevc",
      browserHostile: true,
      representativeMime: null,
      hasAlpha: false,
    };
    mocks.scanProjectMediaCodecMap.mockResolvedValue({ "/a.mov": codec, "/b.mov": codec });
    mocks.resolveProxy.mockResolvedValue("/cache/copy.mp4");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    writeFileSync(join(projectDir, "a.mov.proxy.mp4"), "");
    const { files } = await preResolveHostileMediaProxies(projectDir, "<html></html>");
    expect(files).toEqual([
      { file: "a.mov", state: "cached" },
      { file: "b.mov", state: "ready" },
    ]);
    expect(errorSpy.mock.calls.map(([line]) => String(line).slice(0, 48))).toEqual([
      "[hyperframes] Making browser-playable copies of ",
      "[hyperframes] browser-playable copies: 1/2",
      "[hyperframes] browser-playable copies: 2/2",
      "[hyperframes] media proxy pre-resolve: 2/2 ready",
    ]);
    expect(errorSpy.mock.calls[0]![0]).toContain("copies of 1 video Chrome");

    errorSpy.mockClear();
    writeFileSync(join(projectDir, "b.mov.proxy.mp4"), "");
    await preResolveHostileMediaProxies(projectDir, "<html></html>");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toMatch(/^\[hyperframes\] media proxy pre-resolve: 2\/2/);
  });

  it("writes a scan failure to stderr and leaves stdout untouched", async () => {
    const projectDir = mkProjectDir();
    mocks.scanProjectMediaCodecMap.mockRejectedValue(new Error("ffprobe not found"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(preResolveHostileMediaProxies(projectDir, "<html></html>")).resolves.toEqual({
      findings: [],
      failedPaths: new Set(),
      files: [],
    });

    expect(errorSpy).toHaveBeenCalledWith(
      "[hyperframes] media proxy pre-resolve: scan failed (ffprobe not found)",
    );
    expect(infoSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(mocks.resolveProxy).not.toHaveBeenCalled();
  });

  it("pre-resolves an alpha VP9 asset through the Chromium-compatible VP8 proxy", async () => {
    const projectDir = mkProjectDir();
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/alpha.webm": {
        codecName: "vp9",
        browserHostile: true,
        representativeMime: 'video/webm; codecs="vp09.00.10.08"',
        hasAlpha: true,
      },
    });

    await preResolveHostileMediaProxies(projectDir, "<html></html>");

    expect(mocks.resolveProxy).toHaveBeenCalledTimes(1);
    expect(mocks.resolveProxy).toHaveBeenCalledWith(
      projectDir,
      join(projectDir, "alpha.webm"),
      "vp8",
    );
  });

  it("is a no-op when the codec map has no hostile entries", async () => {
    const projectDir = mkProjectDir();
    mocks.scanProjectMediaCodecMap.mockResolvedValue({
      "/plain.mp4": {
        codecName: "h264",
        browserHostile: false,
        representativeMime: null,
        hasAlpha: false,
      },
    });

    await preResolveHostileMediaProxies(projectDir, "<html></html>");

    expect(mocks.resolveProxy).not.toHaveBeenCalled();
  });
});

describe("captureOverviewShot", () => {
  it("injects the annotation overlay before the overview shot and removes it right after", async () => {
    const calls: string[] = [];
    const evaluate = vi.fn(async (fn: unknown, ...args: unknown[]) => {
      calls.push("evaluate");
      return typeof fn === "function" ? Reflect.apply(fn, undefined, args) : undefined;
    });
    const screenshot = vi.fn(async () => {
      calls.push("screenshot");
      return "annotated-base64";
    });
    const page = Object.assign(Object.create(null), { evaluate, screenshot });

    const result = await captureOverviewShot(
      page,
      [{ label: "1 clipped_text", bbox: { x: 0, y: 0, width: 10, height: 10 } }],
      "measurement-base64",
    );

    // inject overlay -> take the shot -> remove overlay, in that order —
    // never present while any audit (which runs before this is called) collects.
    expect(calls).toEqual(["evaluate", "screenshot", "evaluate"]);
    expect(result).toBe("annotated-base64");
  });

  it("skips the overlay entirely and returns the plain screenshot when there's nothing to annotate", async () => {
    const evaluate = vi.fn();
    const screenshot = vi.fn();
    const page = Object.assign(Object.create(null), { evaluate, screenshot });

    const result = await captureOverviewShot(page, [], "measurement-base64");

    expect(evaluate).not.toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
    expect(result).toBe("measurement-base64");
  });
});

function installRects(): void {
  const root = document.querySelector("[data-composition-id]");
  const image = document.querySelector("#hero-image");
  if (!root || !image) throw new Error("Geometry fixture failed to mount");
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 640, 360));
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue(new DOMRect(600, 80, 200, 100));
}

function fakeConsoleMessage(type: string, text: string) {
  return {
    type: () => type,
    text: () => text,
    location: () => ({ url: "http://127.0.0.1:3000/index.html", lineNumber: 1 }),
  };
}

function fakePage() {
  return Object.assign(Object.create(null), {
    on: vi.fn(),
    viewport: () => ({ width: 640, height: 360 }),
    screenshot: vi.fn(async () => "c3R1Yg=="),
    addScriptTag: vi.fn(async ({ content }: { content: string }) => {
      window.eval(content);
    }),
    evaluate: vi.fn(async (callback: unknown, ...args: unknown[]) => {
      if (typeof callback === "string") return window.eval(callback);
      if (typeof callback !== "function") throw new Error("Expected an evaluate callback");
      return Reflect.apply(callback, window, args);
    }),
  });
}

describe("component output membership", () => {
  it("includes descendants and either side of a collision; keeps unresolved findings", () => {
    document.body.innerHTML =
      '<section id="selected"><span id="child"></span></section><section id="other"><span id="outside"></span></section>';
    const finding = (selector: string, containerSelector?: string) => ({
      code: "content_overlap",
      severity: "error" as const,
      selector,
      containerSelector,
      sourceFile: "index.html",
      dataAttributes: {},
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      time: 1,
      message: "collision",
    });
    expect(
      matchComponentFindings({
        components: ["#selected"],
        findings: [
          finding("#child"),
          finding("#outside", "#child"),
          finding("#outside", "#other"),
          finding("#gone"),
        ],
      }),
    ).toEqual([true, true, false, true]);
    expect(() => matchComponentFindings({ components: ["#missing"], findings: [] })).toThrow(
      "matched nothing",
    );
  });
});

describe("motion blur findings in the check output (T6)", () => {
  type Handler = (message: ReturnType<typeof fakeConsoleMessage>) => void;
  const ACCELERATED = {
    state: "off",
    reason: "a WebGL canvas cannot be captured",
    reasonCode: "accelerated-canvas",
    movers: 0,
  };

  afterEach(() => {
    Reflect.deleteProperty(window, "__hfMotionBlur");
  });

  async function checkWith(
    report: object,
    options: { cores?: number; echo?: [string, string][]; mount?: () => void } = {},
  ) {
    vi.mocked(os.availableParallelism).mockReturnValue(options.cores ?? 1);
    mountCanvasFixture(`<p id="copy" data-layout-name="copy">Hi</p>`);
    options.mount?.();
    const handlers: Handler[] = [];
    const log = (type: string, text: string) =>
      handlers.forEach((handler) => handler(fakeConsoleMessage(type, text)));
    Reflect.set(window, "__hfMotionBlur", {
      probe: () => {
        for (const [type, text] of options.echo ?? []) log(type, text);
        return report;
      },
      suspend: vi.fn(),
    });
    const browser = Object.assign(Object.create(null), {
      close: vi.fn(async () => undefined),
      process: () => ({ exitCode: 0, signalCode: null }),
    });
    let opened = 0;
    vi.mocked(openSettledCompositionPage).mockImplementation(
      async (_html: string, _url: string, settle: OpenSettledCompositionPageOptions) => {
        const page = fakePage();
        const first = ++opened === 1;
        page.on = vi.fn((event: string, handler: Handler) => {
          if (event === "console" && first) handlers.push(handler);
        });
        settle.onBrowser?.(browser);
        await settle.beforeNavigate?.(page);
        return { page, browser, renderReadyTimedOut: false };
      },
    );
    const result = await runBrowserCheck(
      PROJECT,
      { ...DEFAULT_CHECK_OPTIONS, contrast: false },
      { kind: "none" },
      runAuditGrid,
    );
    return { findings: result.runtimeFindings, pages: opened };
  }
  const blurCodes = (findings: { code: string }[]) =>
    findings.map((finding) => finding.code).filter((code) => code.startsWith("motion_blur"));

  it("carries a blur finding, its fix and its anchor into the output", async () => {
    const { findings } = await checkWith(ACCELERATED);
    const [finding, ...rest] = findings.filter(({ code }) => code === "motion_blur_off");
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      severity: "warning",
      message: expect.stringContaining("a WebGL canvas cannot be captured"),
      selector: expect.any(String),
      fixHint: expect.stringMatching(/WebGL\/WebGPU.*sub-composition/),
    });
  });

  it("anchors the finding on the root the runtime picks, not the first composition (W4)", async () => {
    const mount = (): void => {
      document.body.innerHTML = `
        <div id="aux" data-composition-id="aux" data-duration="4"></div>
        <div id="real" data-composition-id="main" data-root="true" data-duration="10"></div>`;
      const rect = { x: 3, y: 4, width: 640, height: 360 } as DOMRect;
      const real = document.getElementById("real");
      if (real) real.getBoundingClientRect = () => rect;
    };
    const { findings } = await checkWith(ACCELERATED, { mount });
    expect(findings.find(({ code }) => code === "motion_blur_off")).toMatchObject({
      selector: '[data-composition-id][data-root="true"]',
      dataAttributes: expect.objectContaining({
        "data-root": "true",
        "data-composition-id": "main",
      }),
      bbox: { x: 3, y: 4, width: 640, height: 360 },
    });
  });

  it("still carries it, once, when a second Chrome shares the sampling", async () => {
    const { findings, pages } = await checkWith(ACCELERATED, { cores: 4 });
    expect(pages).toBe(2);
    expect(blurCodes(findings)).toEqual(["motion_blur_off"]);
  });

  it("keeps an unrelated console warning and drops the runtime's duplicate of the finding", async () => {
    const { findings } = await checkWith(ACCELERATED, {
      echo: [
        ["warn", "[motion-blur] off: a WebGL canvas cannot be captured"],
        ["warn", "your own warning"],
      ],
    });
    const warnings = findings.filter(({ code }) => code === "console_warning");
    expect(warnings.map(({ message }) => message)).toEqual(["your own warning"]);
    expect(blurCodes(findings)).toEqual(["motion_blur_off"]);
  });

  it("keeps the runtime's off-line when there is no finding to replace it", async () => {
    const { findings } = await checkWith(
      { state: "on", reason: null, reasonCode: null, movers: 2 },
      { echo: [["warn", "[motion-blur] off: later, for a reason the probe did not see"]] },
    );
    expect(findings.map(({ code }) => code)).toContain("console_warning");
    expect(blurCodes(findings)).toEqual([]);
  });

  it("does not drop an error that merely starts like the echo", async () => {
    const { findings } = await checkWith(ACCELERATED, {
      echo: [["error", "[motion-blur] off: thrown by the page itself"]],
    });
    expect(findings.map(({ code }) => code)).toContain("console_error");
  });

  it("says nothing moves only when the report says no mover, not when it says some", async () => {
    const still = await checkWith({ state: "on", reason: null, reasonCode: null, movers: 0 });
    expect(blurCodes(still.findings)).toEqual(["motion_blur_no_movers"]);
    const moving = await checkWith({ state: "on", reason: null, reasonCode: null, movers: 3 });
    expect(blurCodes(moving.findings)).toEqual([]);
    const off = await checkWith(ACCELERATED);
    expect(blurCodes(off.findings)).toEqual(["motion_blur_off"]);
  });

  it("treats a report without a mover count as no movers", async () => {
    const { findings } = await checkWith({ state: "on", reason: null, reasonCode: null });
    expect(blurCodes(findings)).toEqual(["motion_blur_no_movers"]);
  });

  it("adds nothing for a page that never opted in", async () => {
    vi.mocked(os.availableParallelism).mockReturnValue(1);
    mountCanvasFixture();
    const page = fakePage();
    installSessionMock(page);
    const result = await runBrowserCheck(
      PROJECT,
      { ...DEFAULT_CHECK_OPTIONS, samples: 1, contrast: false },
      { kind: "none" },
      runAuditGrid,
    );
    expect(blurCodes(result.runtimeFindings)).toEqual([]);
  });
});

describe("finding frame capture", () => {
  it("keeps a progressing frame batch alive past 120 seconds", async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), "finding-frames-progress-"));
    const deadline = new CheckDeadline();
    const page = Object.assign(fakePage(), { evaluateOnNewDocument: vi.fn(async () => undefined) });
    page.screenshot.mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
      deadline.signal.throwIfAborted();
      return "frame";
    });
    installSessionMock(page);
    const requests = Array.from({ length: 40 }, (_, index) => ({
      time: index,
      filename: `frame-${index}.png`,
    }));
    try {
      const result = await deadline
        .run(() =>
          captureFindingFrames({ ...PROJECT, dir }, DEFAULT_CHECK_OPTIONS, requests, deadline),
        )
        .catch((error: unknown) => error);
      expect((result as { written: string[] }).written).toHaveLength(40);
      expect(deadline.signal.aborted).toBe(false);
    } finally {
      await deadline.close();
      vi.useRealTimers();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("seeks each requested time, writes its screenshot and closes the session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finding-frames-"));
    const page = fakePage();
    installSessionMock(page);
    const closeCalls = mocks.serverClose.mock.calls.length;
    const requests = [
      { time: 1, filename: "finding-frame-00.png" },
      { time: 2, filename: "finding-frame-01.png" },
    ];
    try {
      const { written: paths, inspected } = await captureFindingFrames(
        { ...PROJECT, dir },
        DEFAULT_CHECK_OPTIONS,
        requests,
      );
      expect(paths).toHaveLength(2);
      expect(inspected).toEqual([]);
      for (const [index, path] of paths.entries()) {
        expect(readFileSync(path, "utf8")).toBe("c3R1Yg==");
        expect(seekCompositionTimeline).toHaveBeenCalledWith(
          page,
          requests[index]?.time,
          SCREENSHOT_SEEK_OPTIONS,
        );
      }
      expect(mocks.serverClose.mock.calls.length).toBe(closeCalls + 1);
      const session = await vi.mocked(openSettledCompositionPage).mock.results.at(-1)?.value;
      expect(closeManagedBrowser).toHaveBeenCalledWith(session.browser);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("inspects each target on the inspector's page right after its frame, keeping going past a failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finding-frames-inspect-"));
    const page = fakePage();
    installSessionMock(page);
    const order: string[] = [];
    vi.mocked(seekCompositionTimeline).mockImplementation(async (_page, time) => {
      order.push(`seek ${time}`);
    });
    const ready = vi.fn(async () => undefined);
    mocks.prepareFindingInspector.mockResolvedValue({
      html: "<html>inspected</html>",
      ready,
      inspect: vi.fn(async (_page: unknown, target: { selector?: string; hfId?: string }) => {
        order.push(`inspect ${target.selector ?? target.hfId}`);
        return target.selector === "#bad" ? { error: "missing" } : { results: [] };
      }),
    });
    try {
      const { written, inspected } = await captureFindingFrames(
        { ...PROJECT, dir },
        DEFAULT_CHECK_OPTIONS,
        [
          { time: 1, filename: "a.png", inspect: [{ selector: "#bad" }, { hfId: "hf-1" }] },
          { time: 2, filename: "b.png", inspect: [{ selector: "#c" }] },
        ],
      );
      expect(written).toHaveLength(2);
      expect(vi.mocked(openSettledCompositionPage).mock.calls.at(-1)?.[0]).toBe(
        "<html>inspected</html>",
      );
      expect(ready).toHaveBeenCalledWith(expect.objectContaining({ url: "http://127.0.0.1:3000" }));
      expect(order).toEqual(["seek 1", "inspect #bad", "inspect hf-1", "seek 2", "inspect #c"]);
      expect(inspected).toEqual([
        { time: 1, target: { selector: "#bad" }, inspect: { error: "missing" } },
        { time: 1, target: { hfId: "hf-1" }, inspect: { results: [] } },
        { time: 2, target: { selector: "#c" }, inspect: { results: [] } },
      ]);
    } finally {
      vi.mocked(seekCompositionTimeline).mockImplementation(async () => undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(["prepare", "ready"] as const)(
    "does not capture after cancellation during inspector %s",
    async (stage) => {
      const dir = mkdtempSync(join(tmpdir(), "finding-inspect-setup-abort-"));
      const deadline = new CheckDeadline();
      const page = Object.assign(fakePage(), {
        evaluateOnNewDocument: vi.fn(async () => undefined),
      });
      installSessionMock(page);
      const inspect = vi.fn();
      mocks.prepareFindingInspector.mockImplementationOnce(async () => {
        if (stage === "prepare") deadline.stop("SIGTERM");
        return {
          html: "<html>inspected</html>",
          ready: async () => {
            deadline.stop("SIGTERM");
          },
          inspect,
        };
      });
      const launches = vi.mocked(openSettledCompositionPage).mock.calls.length;
      const closes = mocks.serverClose.mock.calls.length;
      try {
        const result = await deadline
          .run(() =>
            captureFindingFrames(
              { ...PROJECT, dir },
              DEFAULT_CHECK_OPTIONS,
              [{ time: 1, filename: "first.png", inspect: [{ selector: "#a" }] }],
              deadline,
            ),
          )
          .catch((error: unknown) => error);
        expect(result).toBe(deadline.signal.reason);
        await deadline.close();
        expect(page.screenshot).not.toHaveBeenCalled();
        expect(inspect).not.toHaveBeenCalled();
        expect(vi.mocked(openSettledCompositionPage).mock.calls.length - launches).toBe(
          stage === "prepare" ? 0 : 1,
        );
        expect(mocks.serverClose.mock.calls.length - closes).toBe(stage === "prepare" ? 0 : 1);
      } finally {
        await deadline.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.each(["stop", "timeout"] as const)(
    "ends inspection work after a %s and closes the session",
    async (reason) => {
      vi.useFakeTimers();
      const dir = mkdtempSync(join(tmpdir(), "finding-inspect-abort-"));
      const deadline = new CheckDeadline();
      const page = Object.assign(fakePage(), {
        evaluateOnNewDocument: vi.fn(async () => undefined),
      });
      installSessionMock(page);
      const inspect = vi.fn(async () => {
        if (reason === "stop") deadline.stop("SIGTERM");
        else await vi.advanceTimersByTimeAsync(120_001);
        return { error: "page closed" };
      });
      mocks.prepareFindingInspector.mockResolvedValue({
        html: "<html>inspected</html>",
        ready: async () => undefined,
        inspect,
      });
      const closeCalls = mocks.serverClose.mock.calls.length;
      try {
        const result = await deadline
          .run(() =>
            captureFindingFrames(
              { ...PROJECT, dir },
              DEFAULT_CHECK_OPTIONS,
              [
                {
                  time: 1,
                  filename: "first.png",
                  inspect: [{ selector: "#a" }, { selector: "#b" }],
                },
                { time: 2, filename: "later.png", inspect: [{ selector: "#c" }] },
              ],
              deadline,
            ),
          )
          .catch((error: unknown) => error);
        expect(result).toBe(deadline.signal.reason);
        await deadline.close();
        expect(inspect).toHaveBeenCalledTimes(1);
        expect(page.screenshot).toHaveBeenCalledTimes(1);
        expect(mocks.serverClose.mock.calls.length).toBe(closeCalls + 1);
        const session = await vi.mocked(openSettledCompositionPage).mock.results.at(-1)?.value;
        expect(closeManagedBrowser).toHaveBeenCalledWith(session.browser);
      } finally {
        await deadline.close();
        vi.useRealTimers();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("does not prepare the inspector when no request asks for it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finding-frames-no-inspect-"));
    installSessionMock(fakePage());
    mocks.prepareFindingInspector.mockClear();
    try {
      await captureFindingFrames({ ...PROJECT, dir }, DEFAULT_CHECK_OPTIONS, [
        { time: 1, filename: "a.png", inspect: [] },
      ]);
      expect(mocks.prepareFindingInspector).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("closes the session when a later screenshot fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "finding-frames-failure-"));
    const page = fakePage();
    page.screenshot
      .mockResolvedValueOnce("first")
      .mockRejectedValueOnce(new Error("capture failed"));
    installSessionMock(page);
    const closeCalls = mocks.serverClose.mock.calls.length;
    try {
      await expect(
        captureFindingFrames({ ...PROJECT, dir }, DEFAULT_CHECK_OPTIONS, [
          { time: 1, filename: "first.png" },
          { time: 2, filename: "second.png" },
        ]),
      ).rejects.toThrow("capture failed");
      expect(mocks.serverClose.mock.calls.length).toBe(closeCalls + 1);
      const session = await vi.mocked(openSettledCompositionPage).mock.results.at(-1)?.value;
      expect(closeManagedBrowser).toHaveBeenCalledWith(session.browser);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
