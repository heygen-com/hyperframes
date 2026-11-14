import { EventEmitter } from "node:events";
import { HYPERFRAMES_BROWSER_MARKER_ARG } from "@hyperframes/core/browser-marker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureBrowser: vi.fn(),
  findSystemBrowser: vi.fn(),
  launch: vi.fn(),
  buildChromeArgs: vi.fn((): string[] => []),
  resolveBrowserGpuMode: vi.fn(async () => "software" as const),
  compositionRequiresWebGpu: vi.fn(() => false),
  assertWebGpuAdapterAvailable: vi.fn(async () => undefined),
  resolveConfig: vi.fn(),
  usesSoftwareWebGpu: vi.fn(),
}));

vi.mock("../browser/manager.js", () => ({
  ensureBrowser: mocks.ensureBrowser,
  findSystemBrowser: mocks.findSystemBrowser,
}));

vi.mock("puppeteer-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("puppeteer-core")>()),
  default: { launch: mocks.launch },
}));

// captureCompositionFrame.js imports these two from ../browser/gpuPolicy.js,
// which re-exports them from this mocked module — unmocked here, they'd read
// undefined and throw as soon as openSettledCompositionPage calls them.
vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  buildChromeArgs: mocks.buildChromeArgs,
  resolveBrowserGpuMode: mocks.resolveBrowserGpuMode,
  compositionRequiresWebGpu: mocks.compositionRequiresWebGpu,
  assertWebGpuAdapterAvailable: mocks.assertWebGpuAdapterAvailable,
  resolveConfig: mocks.resolveConfig,
  usesSoftwareWebGpu: mocks.usesSoftwareWebGpu,
  DEFAULT_CONFIG: { pageNavigationTimeout: 60_000 },
  resolvePageNavigationTimeout: () => 60_000,
  waitForImagesReady: async () => true,
}));

import { openSettledCompositionPage } from "./captureCompositionFrame.js";
import { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveStaticProjectHtml } from "../utils/staticProjectServer.js";

const HTML = '<div data-composition-id="main" data-width="1920" data-height="1080"></div>';
const OPTIONS = {
  renderReadyTimeoutMs: 1000,
  renderReadyWarningSuffix: "test",
  browserGpuMode: "software" as const,
};
const BUNDLED = "C:\\hyperframes\\chrome-headless-shell.exe";
const SYSTEM = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function launchCrash(): Error {
  return new Error("Failed to launch the browser process! Code: 3221225595");
}

function fakeBrowser() {
  const page = {
    evaluateOnNewDocument: vi.fn(async () => undefined),
    setViewport: vi.fn(async () => undefined),
    goto: vi.fn(async () => undefined),
    createCDPSession: async () => ({
      send: async () => undefined,
      on: () => undefined,
      detach: async () => undefined,
    }),
    waitForFunction: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => undefined),
    setRequestInterception: vi.fn(async (_on: boolean) => undefined),
    on: vi.fn((_event: string, _handler: (request: unknown) => void) => undefined),
    once: vi.fn((_event: string, _handler: () => void) => undefined),
  };
  return {
    browser: {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
      process: vi.fn(() => new EventEmitter()),
    },
    page,
  };
}

describe("openSettledCompositionPage Windows bundled-browser recovery", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    mocks.ensureBrowser.mockResolvedValue({ executablePath: BUNDLED, source: "cache" });
    mocks.findSystemBrowser.mockReturnValue({ executablePath: SYSTEM, source: "system" });
    mocks.buildChromeArgs.mockReturnValue([]);
    mocks.resolveBrowserGpuMode.mockResolvedValue("software");
    mocks.resolveConfig.mockReturnValue({ allowSoftwareWebGpu: false });
    mocks.usesSoftwareWebGpu.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  });

  it("cancels browser setup with the caller's signal before launching", async () => {
    const abort = new AbortController();
    const failure = new Error("browser setup cancelled");
    mocks.ensureBrowser.mockImplementation(async (options) => {
      if (options?.signal !== abort.signal) throw new Error("setup has no caller signal");
      abort.abort(failure);
      throw abort.signal.reason;
    });
    await expect(
      openSettledCompositionPage(HTML, "http://127.0.0.1:3000", {
        ...OPTIONS,
        signal: abort.signal,
      }),
    ).rejects.toBe(failure);
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("starts the composition clock after browser launch and before page creation", async () => {
    const order: string[] = [];
    const opened = fakeBrowser();
    mocks.launch.mockImplementationOnce(async () => {
      order.push("launch");
      return opened.browser;
    });
    opened.browser.newPage.mockImplementationOnce(async () => {
      order.push("page");
      return opened.page;
    });
    const onBrowserReady = vi.fn(() => {
      order.push("ready");
    });
    await openSettledCompositionPage(HTML, "http://127.0.0.1:3000", {
      ...OPTIONS,
      onBrowserReady,
    });
    expect(order).toEqual(["launch", "ready", "page"]);
    expect(onBrowserReady).toHaveBeenCalledOnce();
  });

  it("launches software WebGPU and accepts its adapter when render's opt-in is set", async () => {
    const opened = fakeBrowser();
    mocks.launch.mockResolvedValueOnce(opened.browser);
    mocks.compositionRequiresWebGpu.mockReturnValue(true);
    mocks.resolveConfig.mockReturnValue({ allowSoftwareWebGpu: true });
    mocks.usesSoftwareWebGpu.mockReturnValue(true);

    await openSettledCompositionPage(HTML, "http://127.0.0.1:3000", OPTIONS);

    const gpuConfig = { browserGpuMode: "software", allowSoftwareWebGpu: true };
    expect(mocks.buildChromeArgs).toHaveBeenCalledWith(
      expect.objectContaining({ requiresWebGpu: true }),
      gpuConfig,
    );
    expect(mocks.usesSoftwareWebGpu).toHaveBeenCalledWith(true, gpuConfig);
    expect(mocks.assertWebGpuAdapterAvailable).toHaveBeenCalledWith(opened.page, true, true);
  });

  it("retries the known managed-shell crash once with system Chrome", async () => {
    const fallback = fakeBrowser();
    mocks.launch.mockRejectedValueOnce(launchCrash()).mockResolvedValueOnce(fallback.browser);

    const session = await openSettledCompositionPage(HTML, "http://127.0.0.1:3000", OPTIONS);

    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(mocks.launch.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ executablePath: BUNDLED }),
    );
    expect(mocks.launch.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ executablePath: SYSTEM }),
    );
    expect(session.browser).toBe(fallback.browser);
  });

  it("adds STATUS_STACK_BUFFER_OVERRUN and browser-path guidance when no system Chrome exists", async () => {
    mocks.findSystemBrowser.mockReturnValue(undefined);
    mocks.launch.mockRejectedValueOnce(launchCrash());

    await expect(
      openSettledCompositionPage(HTML, "http://127.0.0.1:3000", OPTIONS),
    ).rejects.toThrow(/STATUS_STACK_BUFFER_OVERRUN[\s\S]*HYPERFRAMES_BROWSER_PATH/);
    expect(mocks.launch).toHaveBeenCalledOnce();
  });

  it("keeps unrelated launch errors unchanged", async () => {
    const error = new Error("Failed to launch the browser process! Code: 1");
    mocks.launch.mockRejectedValueOnce(error);

    await expect(openSettledCompositionPage(HTML, "http://127.0.0.1:3000", OPTIONS)).rejects.toBe(
      error,
    );
    expect(mocks.findSystemBrowser).not.toHaveBeenCalled();
    expect(mocks.launch).toHaveBeenCalledOnce();
  });
});

describe("openSettledCompositionPage when nothing may listen", () => {
  const launched = () =>
    mocks.launch.mock.calls.at(-1)?.[0] as unknown as { pipe?: boolean; args: string[] };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.ensureBrowser.mockResolvedValue({ executablePath: BUNDLED, source: "cache" });
    mocks.buildChromeArgs.mockReturnValue(["--headless"]);
    mocks.resolveBrowserGpuMode.mockResolvedValue("software");
    mocks.resolveConfig.mockReturnValue({ allowSoftwareWebGpu: false });
    mocks.usesSoftwareWebGpu.mockReturnValue(false);
  });

  afterEach(() => vi.restoreAllMocks());

  it("drives Chrome over a pipe in one process and answers the page from the project", async () => {
    vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server) {
      process.nextTick(() =>
        this.emit("error", Object.assign(new Error("listen EPERM"), { code: "EPERM" })),
      );
      return this;
    });
    const dir = mkdtempSync(join(tmpdir(), "hf-nolisten-"));
    const server = await serveStaticProjectHtml(dir, "<html><body>composition</body></html>");
    const opened = fakeBrowser();
    mocks.launch.mockResolvedValue(opened.browser);
    try {
      await openSettledCompositionPage(HTML, server.url, OPTIONS);

      expect(launched().pipe).toBe(true);
      expect(launched().args).toEqual([
        "--headless",
        "--single-process",
        "--disable-gpu-compositing",
        HYPERFRAMES_BROWSER_MARKER_ARG,
      ]);
      expect(opened.page.setRequestInterception).toHaveBeenCalledWith(true);
      const onRequest = opened.page.on.mock.calls.find(([event]) => event === "request")![1];
      const respond = vi.fn(async (_response: { status: number; body: Buffer }) => undefined);
      const proceed = vi.fn(async () => undefined);
      const request = (url: string) => ({
        url: () => url,
        method: () => "GET",
        headers: () => ({}),
        isInterceptResolutionHandled: () => false,
        respond,
        continue: proceed,
        abort: vi.fn(async () => undefined),
      });
      onRequest(request(`${server.url}index.html`));
      await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce());
      expect(respond.mock.calls[0]![0]).toMatchObject({ status: 200 });
      expect(String(respond.mock.calls[0]![0].body)).toContain("composition");
      onRequest(request("https://cdn.example/gsap.js"));
      expect(proceed).toHaveBeenCalledOnce();
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the usual launch for a project served on a port", async () => {
    const opened = fakeBrowser();
    mocks.launch.mockResolvedValue(opened.browser);
    await openSettledCompositionPage(HTML, "http://127.0.0.1:3000", OPTIONS);
    expect(launched().pipe).toBe(true);
    expect(launched().args).toEqual(["--headless", HYPERFRAMES_BROWSER_MARKER_ARG]);
    expect(opened.page.setRequestInterception).not.toHaveBeenCalled();
  });

  it("asks the page to replay skipped frames, so a still shows what playback shows", async () => {
    const opened = fakeBrowser();
    mocks.launch.mockResolvedValue(opened.browser);
    await openSettledCompositionPage(HTML, "http://127.0.0.1:3000", OPTIONS);
    expect(opened.page.evaluateOnNewDocument).toHaveBeenCalledWith(
      "window.__HF_REPLAY_SKIPPED_FRAMES = true",
    );
  });
});
