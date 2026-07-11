import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureRegionCrop,
  clampCropRegion,
  installPageFunctionGuard,
  padCropRegion,
  parseZoomTarget,
  resolveCliChromeGpuMode,
  resolveCropRegion,
  runFfmpegOnce,
  seekCompositionTimeline,
  type CompositionSeekPage,
} from "./captureCompositionFrame.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "hf-capture-frame-test-"));
}

function fakeSeekPage() {
  const evaluate = vi.fn(
    async (
      _pageFunction: Parameters<CompositionSeekPage["evaluate"]>[0],
      _value?: number,
      _fallbackToBridgeAndTimelines?: boolean,
    ): Promise<unknown> => undefined,
  );
  const waitForFunction = vi.fn(
    async (_pageFunction: () => boolean, _options: { timeout: number }): Promise<unknown> =>
      undefined,
  );
  const page: CompositionSeekPage = { evaluate, waitForFunction };
  return { page, evaluate, waitForFunction };
}

function runBrowserSeek(evaluate: ReturnType<typeof fakeSeekPage>["evaluate"]): void {
  const seekInBrowser = evaluate.mock.calls[0]?.[0];
  if (typeof seekInBrowser !== "function") throw new Error("Expected a browser seek function");
  Reflect.apply(seekInBrowser, undefined, evaluate.mock.calls[0]?.slice(1) ?? []);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("seekCompositionTimeline", () => {
  it("keeps the raced double-frame settle and adds a bounded font wait by default", async () => {
    const { page, evaluate, waitForFunction } = fakeSeekPage();

    await seekCompositionTimeline(page, 1.25);

    expect(waitForFunction).not.toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(evaluate).toHaveBeenNthCalledWith(1, expect.any(Function), 1.25, false);
    expect(evaluate.mock.calls[1]?.[0]).toContain("window.setTimeout(finish, 100)");
    // Post-seek font settle: a seek can reveal glyphs whose unicode-range
    // subsets only start loading after the next layout (CJK snapshot reports).
    expect(evaluate).toHaveBeenNthCalledWith(3, expect.any(Function), 500);
  });

  it("waitForFontsMs: 0 disables the post-seek font wait", async () => {
    const { page, evaluate } = fakeSeekPage();

    await seekCompositionTimeline(page, 1.25, { waitForFontsMs: 0 });

    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("prefers renderSeek so the runtime synchronizes clip visibility", async () => {
    const { page, evaluate } = fakeSeekPage();
    const renderSeek = vi.fn();
    const bridgeSeek = vi.fn();
    const playerSeek = vi.fn();
    const timelineSeek = vi.fn();
    vi.stubGlobal("window", {
      __player: { renderSeek, seek: playerSeek },
      __hf: { seek: bridgeSeek },
      __timelines: { main: { seek: timelineSeek } },
    });

    await seekCompositionTimeline(page, 2.25);
    runBrowserSeek(evaluate);

    expect(renderSeek).toHaveBeenCalledWith(2.25);
    expect(bridgeSeek).not.toHaveBeenCalled();
    expect(playerSeek).not.toHaveBeenCalled();
    expect(timelineSeek).not.toHaveBeenCalled();
  });

  function fakeBridgeOnlySeekPage() {
    const { page, evaluate } = fakeSeekPage();
    const bridgeSeek = vi.fn();
    const tickerTick = vi.fn();
    vi.stubGlobal("window", { __hf: { seek: bridgeSeek }, gsap: { ticker: { tick: tickerTick } } });
    return { page, evaluate, bridgeSeek, tickerTick };
  }

  it("keeps bridge and raw fallbacks disabled for default capture callers", async () => {
    const { page, evaluate, bridgeSeek, tickerTick } = fakeBridgeOnlySeekPage();

    await seekCompositionTimeline(page, 2.5);
    runBrowserSeek(evaluate);

    expect(bridgeSeek).not.toHaveBeenCalled();
    expect(tickerTick).not.toHaveBeenCalled();
  });

  it("opts into the bridge before player and raw timeline fallbacks", async () => {
    const { page, evaluate, bridgeSeek, tickerTick } = fakeBridgeOnlySeekPage();

    await seekCompositionTimeline(page, 2.5, { fallbackToBridgeAndTimelines: true });
    runBrowserSeek(evaluate);

    expect(bridgeSeek).toHaveBeenCalledWith(2.5);
    expect(tickerTick).toHaveBeenCalledOnce();
  });

  it("opts into pausing and seeking raw timelines when no preferred target exists", async () => {
    const { page, evaluate } = fakeSeekPage();
    const pause = vi.fn();
    const seek = vi.fn();
    vi.stubGlobal("window", { __timelines: { main: { pause, seek } } });

    await seekCompositionTimeline(page, 1.75, { fallbackToBridgeAndTimelines: true });
    runBrowserSeek(evaluate);

    expect(pause).toHaveBeenCalledOnce();
    expect(seek).toHaveBeenCalledWith(1.75);
  });

  it("supports validate settling without adding an animation-frame or font wait", async () => {
    vi.useFakeTimers();
    const { page, evaluate, waitForFunction } = fakeSeekPage();

    const pending = seekCompositionTimeline(page, 3, {
      fallbackToBridgeAndTimelines: true,
      waitForPreferredSeekTargetMs: 500,
      animationFrameSettle: "none",
      waitForFontsMs: 0,
      settleMs: 150,
    });
    await vi.advanceTimersByTimeAsync(150);
    await pending;

    expect(waitForFunction).toHaveBeenCalledWith(expect.any(Function), { timeout: 500 });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), 3, true);
  });

  it("supports layout's ordered double-frame, bounded font, and sleep settles", async () => {
    vi.useFakeTimers();
    const { page, evaluate } = fakeSeekPage();

    const pending = seekCompositionTimeline(page, 4, {
      fallbackToBridgeAndTimelines: true,
      animationFrameSettle: "double",
      waitForFontsMs: 500,
      settleMs: 120,
    });
    await vi.advanceTimersByTimeAsync(120);
    await pending;

    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(evaluate).toHaveBeenNthCalledWith(1, expect.any(Function), 4, true);
    expect(evaluate).toHaveBeenNthCalledWith(2, expect.any(Function));
    expect(evaluate).toHaveBeenNthCalledWith(3, expect.any(Function), 500);
  });
});

describe("resolveCliChromeGpuMode", () => {
  it("preserves validate's software-only opt-in mapping", () => {
    expect(resolveCliChromeGpuMode("software")).toBe("software");
    expect(resolveCliChromeGpuMode("hardware")).toBe("hardware");
    expect(resolveCliChromeGpuMode("auto")).toBe("hardware");
    expect(resolveCliChromeGpuMode("")).toBe("hardware");
  });
});

describe("screenshot Chrome arguments", () => {
  it("leaves shared capture and layout on the engine's software default", () => {
    const defaultScreenshotArgs =
      /args:\s*buildChromeArgs\(\s*\{[^}]*captureMode:\s*"screenshot"[^}]*\}\s*\),/;
    const captureSource = readFileSync(
      new URL("./captureCompositionFrame.ts", import.meta.url),
      "utf8",
    );
    const layoutSource = readFileSync(new URL("../commands/layout.ts", import.meta.url), "utf8");

    // openSettledCompositionPage threads the caller's optional browserGpuMode;
    // callers that omit it (snapshot, compare) fall through to the engine's
    // software default for screenshot capture.
    expect(captureSource).toMatch(
      /args:\s*buildChromeArgs\(\s*\{[^}]*captureMode:\s*"screenshot"[^}]*\},\s*\{\s*browserGpuMode:\s*options\.browserGpuMode\s*\},?\s*\),/,
    );
    expect(layoutSource).toMatch(defaultScreenshotArgs);
  });
});

describe("parseZoomTarget", () => {
  it("parses four comma-separated numbers as an exact region", () => {
    expect(parseZoomTarget("100,50,400,300")).toEqual({
      kind: "region",
      region: { x: 100, y: 50, width: 400, height: 300 },
    });
  });

  it("treats anything else as a CSS selector", () => {
    expect(parseZoomTarget("#headline")).toEqual({ kind: "selector", selector: "#headline" });
    expect(parseZoomTarget(".card:nth-of-type(2)")).toEqual({
      kind: "selector",
      selector: ".card:nth-of-type(2)",
    });
  });
});

describe("clampCropRegion / padCropRegion", () => {
  it("clamps a region to the canvas bounds", () => {
    expect(
      clampCropRegion({ x: -10, y: -10, width: 50, height: 50 }, { width: 30, height: 30 }),
    ).toEqual({
      x: 0,
      y: 0,
      width: 30,
      height: 30,
    });
  });

  it("pads a region on every side when it fits within the canvas", () => {
    expect(
      padCropRegion({ x: 500, y: 500, width: 100, height: 40 }, { width: 1920, height: 1080 }, 24),
    ).toEqual({ x: 476, y: 476, width: 148, height: 88 });
  });

  it("pads then clamps when padding would spill outside the canvas", () => {
    expect(
      padCropRegion({ x: 10, y: 10, width: 20, height: 20 }, { width: 200, height: 200 }, 24),
    ).toEqual({ x: 0, y: 0, width: 54, height: 54 });
  });
});

describe("resolveCropRegion", () => {
  it("resolves a selector to its bbox, padded 24px and clamped", async () => {
    const page = { evaluate: vi.fn(async () => ({ x: 500, y: 500, width: 100, height: 40 })) };

    const region = await resolveCropRegion(
      page,
      { kind: "selector", selector: "#headline" },
      { width: 1920, height: 1080 },
    );

    expect(region).toEqual({ x: 476, y: 476, width: 148, height: 88 });
  });

  it("crops a region exactly, without padding, when it already fits the canvas", async () => {
    const page = { evaluate: vi.fn() };

    const region = await resolveCropRegion(
      page,
      { kind: "region", region: { x: 100, y: 50, width: 400, height: 300 } },
      { width: 1920, height: 1080 },
    );

    expect(region).toEqual({ x: 100, y: 50, width: 400, height: 300 });
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("throws a clear, loud error when the selector matches nothing", async () => {
    const page = { evaluate: vi.fn(async () => null) };

    await expect(
      resolveCropRegion(
        page,
        { kind: "selector", selector: "#missing" },
        { width: 640, height: 360 },
      ),
    ).rejects.toThrow("--zoom selector matched no element: #missing");
  });

  it("returns null when the clamped region is a sliver (element animated off-canvas)", async () => {
    // Element slid past the right edge: raw bbox is large, but clamping the
    // padded region to the canvas leaves ~1px — a useless crop.
    const page = { evaluate: vi.fn(async () => ({ x: 2500, y: 400, width: 600, height: 250 })) };

    const region = await resolveCropRegion(
      page,
      { kind: "selector", selector: "#gone-by-now" },
      { width: 1920, height: 1080 },
    );

    expect(region).toBeNull();
  });
});

describe("captureRegionCrop", () => {
  it("raises deviceScaleFactor for the clip shot, then restores the original viewport", async () => {
    const original = { width: 1920, height: 1080, deviceScaleFactor: 1 };
    const setViewport = vi.fn(async () => undefined);
    const screenshot = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const page = { viewport: () => original, setViewport, screenshot };
    const region = { x: 10, y: 20, width: 100, height: 50 };

    const buffer = await captureRegionCrop(page, region, 3);

    expect(setViewport).toHaveBeenNthCalledWith(1, { ...original, deviceScaleFactor: 3 });
    expect(screenshot).toHaveBeenCalledWith({ clip: region, type: "png" });
    expect(setViewport).toHaveBeenNthCalledWith(2, original);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(Array.from(buffer)).toEqual([1, 2, 3]);
  });

  it("honors an explicit scale other than the default", async () => {
    const original = { width: 800, height: 600 };
    const setViewport = vi.fn(async () => undefined);
    const screenshot = vi.fn(async () => new Uint8Array());
    const page = { viewport: () => original, setViewport, screenshot };

    await captureRegionCrop(page, { x: 0, y: 0, width: 10, height: 10 }, 2);

    expect(setViewport).toHaveBeenNthCalledWith(1, { ...original, deviceScaleFactor: 2 });
  });
});

describe("runFfmpegOnce", () => {
  it("returns the process exit code and collected stderr", async () => {
    const dir = tempDir();
    try {
      const script = join(dir, "fail.cjs");
      writeFileSync(script, 'process.stderr.write("ffmpeg failed"); process.exit(3);\n');

      const result = await runFfmpegOnce(process.execPath, [script], 1000);

      expect(result).toEqual({ code: 3, stderr: "ffmpeg failed", timedOut: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("terminates the process when the timeout elapses", async () => {
    const dir = tempDir();
    try {
      const script = join(dir, "hang.cjs");
      writeFileSync(script, "setTimeout(() => {}, 10000);\n");

      const result = await runFfmpegOnce(process.execPath, [script], 50);

      expect(result.timedOut).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("installPageFunctionGuard", () => {
  it("defines the keepNames __name shim in the page before any script runs", async () => {
    const evaluateOnNewDocument = vi.fn(async (_source: string) => undefined);

    await installPageFunctionGuard({ evaluateOnNewDocument });

    expect(evaluateOnNewDocument).toHaveBeenCalledOnce();
    const source = evaluateOnNewDocument.mock.calls[0]?.[0] ?? "";
    expect(source).toContain("self.__name");
    // The shim must be a no-op passthrough so wrapped functions stay callable.
    const shim = new Function(`const self = {}; ${source}; return self.__name;`)() as (
      fn: unknown,
    ) => unknown;
    const marker = () => 42;
    expect(shim(marker)).toBe(marker);
  });
});
