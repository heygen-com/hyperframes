import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import {
  BACKGROUND_DECODE_TIMEOUT_MS,
  captureFrame,
  captureFramesBatchPipelined,
  completeDeferredDrawElementInit,
  createCaptureSession,
  type CaptureSession,
} from "./frameCapture.js";
import { produceDrawElementFrameBatch } from "./drawElementService.js";
import { pageScreenshotCapture } from "./screenshotService.js";

vi.mock("./browserManager.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./browserManager.js")>()),
  resolveBrowserGpuMode: async () => "hardware",
  acquireBrowser: async () => ({
    captureMode: "screenshot",
    browser: {
      version: async () => "Chrome/150.0.0.0",
      newPage: async () => ({
        mainFrame: () => ({}),
        evaluateOnNewDocument: async () => {},
        setViewport: async () => {},
        evaluate: async () => undefined,
      }),
    },
  }),
}));
vi.mock("./drawElementService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./drawElementService.js")>()),
  injectDrawElementCanvas: vi.fn(),
  produceDrawElementFrameBatch: vi.fn(),
}));
vi.mock("./screenshotService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./screenshotService.js")>()),
  pageScreenshotCapture: vi.fn(),
}));

const STUCK = "https://user:pw@cdn.test/bg.jpg?token=SECRET#frag";
const SANITIZED = "https://cdn.test/bg.jpg";

/** Runs the page's evaluate callbacks in this realm; the any url() background never finishes decoding. */
function backgroundPage(backgroundImage: string): Page {
  const element = { style: { backgroundImage } };
  class StuckImage {
    src = "";
    decode = () => new Promise<void>(() => {});
  }
  return {
    evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown) => {
      Object.assign(globalThis, {
        document: { querySelectorAll: () => [element] },
        Image: StuckImage,
        window: {},
      });
      return fn(arg);
    },
  } as unknown as Page;
}

const dirs: string[] = [];
async function session(page?: Page): Promise<CaptureSession> {
  const dir = mkdtempSync(join(tmpdir(), "hf-decode-callers-"));
  dirs.push(dir);
  const s = await createCaptureSession(
    "http://localhost:0",
    dir,
    { width: 1920, height: 1080, fps: { num: 30, den: 1 }, format: "jpeg" },
    null,
    { forceScreenshot: true },
  );
  s.isInitialized = true;
  s.captureMode = "drawelement";
  if (page) s.page = page;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return s;
}

function expectOnlyTheSanitizedWarning(s: CaptureSession): void {
  expect(JSON.stringify([s.browserConsoleBuffer, s.warnings])).not.toMatch(/SECRET|user|pw@|frag/);
  expect(s.warnings).toEqual([
    expect.objectContaining({
      code: "media_readiness_timeout",
      details: {
        mediaType: "image",
        sources: [SANITIZED],
        timeoutMs: BACKGROUND_DECODE_TIMEOUT_MS,
      },
    }),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HF_FORCE_DRAWELEMENT", "1");
  vi.stubEnv("HF_FAST_CAPTURE_BOUNDARY_SS", "false");
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  const root = globalThis as Record<string, unknown>;
  for (const key of [
    "__hf_css_background_decoded",
    "__hf_css_background_timed_out",
    "__hfDecodeDynamicCssBackgroundImages",
    "document",
    "Image",
    "window",
  ]) {
    delete root[key];
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("a background decode timeout reaches the session warning at every caller", () => {
  it("drawElement init reports the stuck url, sanitized", async () => {
    const s = await session(backgroundPage(`url("${STUCK}")`));
    s.deInitDeferred = true;
    s.onBeforeCapture = async () => {};

    const done = completeDeferredDrawElementInit(s);
    await vi.advanceTimersByTimeAsync(BACKGROUND_DECODE_TIMEOUT_MS);
    await done;

    expectOnlyTheSanitizedWarning(s);
  });

  it("drawElement init adds no warning when nothing timed out", async () => {
    const s = await session(backgroundPage("none"));
    s.deInitDeferred = true;
    s.onBeforeCapture = async () => {};

    await completeDeferredDrawElementInit(s);

    expect(s.warnings).toEqual([]);
  });

  it("the per-frame seek reports the stuck url, sanitized", async () => {
    vi.mocked(pageScreenshotCapture).mockResolvedValue(Buffer.from("frame"));
    const s = await session(backgroundPage(`url("${STUCK}")`));
    s.captureMode = "screenshot";

    const done = captureFrame(s, 7, 7 / 30);
    await vi.advanceTimersByTimeAsync(BACKGROUND_DECODE_TIMEOUT_MS);
    await done;

    expectOnlyTheSanitizedWarning(s);
  });

  it("the per-frame seek adds no warning when nothing timed out", async () => {
    vi.mocked(pageScreenshotCapture).mockResolvedValue(Buffer.from("frame"));
    const s = await session(backgroundPage("none"));
    s.captureMode = "screenshot";

    await captureFrame(s, 7, 7 / 30);

    expect(s.warnings).toEqual([]);
  });

  it.each([
    ["the late backgrounds of a batch are reported, sanitized", [STUCK, STUCK], true],
    ["an empty late list adds no warning", [], false],
  ])("the batch loop: %s", async (_name, lateBackgrounds, warns) => {
    vi.mocked(produceDrawElementFrameBatch).mockResolvedValueOnce({
      encodeResults: [Promise.resolve(Buffer.from("ok"))],
      failedAt: null,
      lateBackgrounds,
    });
    const s = await session();

    await captureFramesBatchPipelined(s, [7], [7 / 30]);

    if (warns) expectOnlyTheSanitizedWarning(s);
    else expect(s.warnings).toEqual([]);
  });
});
