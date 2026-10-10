import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TimeoutError, type Page } from "puppeteer-core";
import {
  captureFullPagePlate,
  captureScrollScreenshots,
  MAX_PLATE_HEIGHT_PX,
  pngHeight,
} from "./screenshotCapture.js";
import { CaptureDirRefusedError } from "./captureErrors.js";

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A real 1920x800 PNG header, so the produced-height guard sees something valid.
function pngBuffer(height: number, width = 1920): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

// The mocks declare their parameters so `mock.calls[i][0]` is a real slot — a zero-arg
// vi.fn() types its call tuple as [] and indexing it is a compile error.
// `docHeight` is what the in-function measurement returns; the plate reads the page height
// itself now rather than trusting a value the caller measured before scrolling.
function fakePage(
  { docHeight = 8000, plateHeight = 8000 }: { docHeight?: number; plateHeight?: number } = {},
  overrides: Record<string, unknown> = {},
) {
  const evaluate = vi.fn(async (script?: unknown) => {
    if (String(script).includes("scrollHeight")) return docHeight;
    if (script === "window.innerHeight") return 1080;
  });
  const screenshot = vi.fn(async (_opts?: unknown) => pngBuffer(plateHeight));
  const waitForNetworkIdle = vi.fn(async () => undefined);
  return {
    page: {
      evaluate,
      screenshot,
      waitForNetworkIdle,
      ...overrides,
    } as unknown as Page,
    evaluate,
    screenshot,
    waitForNetworkIdle,
  };
}

describe("captureFullPagePlate — the scroll shot's plate", () => {
  it("writes one full-page png and returns its relative path", async () => {
    const dir = tempDir("hf-plate-");
    const { page, screenshot } = fakePage({ docHeight: 10962, plateHeight: 10962 });

    const out = await captureFullPagePlate(page, dir);

    expect(out).toEqual({ kind: "captured", file: "screenshots/full-page.png" });
    expect(screenshot).toHaveBeenCalledWith({ type: "png", fullPage: true });
    expect(pngHeight(readFileSync(join(dir, "full-page.png")))).toBe(10962);
  });

  it("stays 1x: it never touches the viewport's deviceScaleFactor", async () => {
    const dir = tempDir("hf-plate-");
    const setViewport = vi.fn(async () => undefined);
    const { page } = fakePage({}, { setViewport });

    await captureFullPagePlate(page, dir);

    // A 2x plate would exceed the cap on exactly the long pages that want a scroll shot.
    expect(setViewport).not.toHaveBeenCalled();
  });

  it("skips a page taller than Chrome can capture, instead of writing a clipped plate", async () => {
    const dir = tempDir("hf-plate-");
    const { page, screenshot } = fakePage({ docHeight: MAX_PLATE_HEIGHT_PX + 1 });

    const out = await captureFullPagePlate(page, dir);

    expect(out).toEqual({ kind: "omitted", reason: "height-limit" });
    expect(screenshot).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "full-page.png"))).toBe(false);
  });

  it("neutralises sticky/fixed chrome for the shot and restores it afterwards", async () => {
    const dir = tempDir("hf-plate-");
    const { page, evaluate, screenshot } = fakePage();

    await captureFullPagePlate(page, dir);

    const scripts = evaluate.mock.calls.map((c) => String(c[0]));
    // neutralise, height probe, restore — the probe sits after neutralisation because
    // forcing fixed/sticky to `static` puts those elements back in flow and grows the page.
    expect(scripts).toHaveLength(3);
    expect(scripts[0]).toContain("'fixed'");
    expect(scripts[0]).toContain("'sticky'");
    expect(scripts[0]).toContain("data-hf-plate-position");
    expect(scripts[1]).toContain("scrollHeight");
    // Then hand the page back unchanged: the caller keeps reading the DOM after this.
    expect(scripts[2]).toContain("removeAttribute");
    expect(scripts[2]).toContain("data-hf-plate-position");
    expect(evaluate.mock.invocationCallOrder[1]).toBeLessThan(
      screenshot.mock.invocationCallOrder[0]!,
    );
    expect(screenshot.mock.invocationCallOrder[0]).toBeLessThan(
      evaluate.mock.invocationCallOrder[2]!,
    );
  });

  it("restores the page even when the screenshot throws", async () => {
    const dir = tempDir("hf-plate-");
    const screenshot = vi.fn(async (_opts?: unknown) => {
      throw new Error("capture failed");
    });
    const { page, evaluate } = fakePage({}, { screenshot });

    await expect(captureFullPagePlate(page, dir)).rejects.toThrow("capture failed");
    // A page left with every sticky element forced static would corrupt the extraction
    // passes that run after this one.
    expect(String(evaluate.mock.calls.at(-1)?.[0])).toContain("removeAttribute");
  });
});

describe("captureScrollScreenshots limits", () => {
  it.each([1, 3, 21, 105])("caps all screenshot files at %i including the plate", async (limit) => {
    vi.useFakeTimers();
    const dir = tempDir("hf-scroll-limit-");
    const { page } = fakePage(
      { docHeight: 16000 },
      {
        evaluate: vi.fn(async (expression: unknown) => {
          if (String(expression).includes("scrollHeight")) return 16000;
          if (expression === "window.innerHeight") return 100;
        }),
      },
    );
    try {
      const capture = captureScrollScreenshots(page, dir, { maxScreenshots: limit });
      await vi.runAllTimersAsync();
      const { files } = await capture;
      expect(files).toHaveLength(limit);
      expect(readdirSync(join(dir, "screenshots"))).toHaveLength(limit);
      if (limit === 1) expect(files).toEqual(["screenshots/scroll-000.png"]);
      else expect(files).toContain("screenshots/full-page.png");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("captureScrollScreenshots interruptions", () => {
  it.each([
    [new TimeoutError("protocolTimeout"), "request-timeout"],
    [new Error("target closed"), "internal-error"],
  ])("preserves saved files when the next screenshot fails with %s", async (error, reason) => {
    vi.useFakeTimers();
    const dir = tempDir("hf-scroll-interrupted-");
    const screenshot = vi.fn().mockResolvedValueOnce(pngBuffer(1080)).mockRejectedValue(error);
    const { page } = fakePage(
      {},
      {
        screenshot,
      },
    );
    try {
      const capture = captureScrollScreenshots(page, dir, { maxScreenshots: 3 });
      await vi.runAllTimersAsync();
      const result = await capture;
      expect(result.files).toEqual(["screenshots/scroll-000.png"]);
      expect(readdirSync(join(dir, "screenshots"))).toEqual(["scroll-000.png"]);
      expect(result.interruption).toEqual({ reason, message: error.message });
    } finally {
      vi.useRealTimers();
    }
  });

  it("publishes written paths while the next native screenshot is still pending", async () => {
    vi.useFakeTimers();
    const dir = tempDir("hf-scroll-pending-");
    const files: string[] = [];
    let interrupt!: (error: Error) => void;
    const screenshot = vi
      .fn()
      .mockResolvedValueOnce(pngBuffer(1080))
      .mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            interrupt = reject;
          }),
      );
    const { page } = fakePage(
      {},
      {
        screenshot,
      },
    );
    try {
      const capture = captureScrollScreenshots(page, dir, { maxScreenshots: 3, files });
      await vi.advanceTimersByTimeAsync(1200);
      expect(files).toEqual(["screenshots/scroll-000.png"]);
      interrupt(new TimeoutError("protocolTimeout"));
      const result = await capture;
      expect(result.files).toBe(files);
      expect(result.interruption?.reason).toBe("request-timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("publishes a written plate before position restoration finishes", async () => {
    vi.useFakeTimers();
    const dir = tempDir("hf-plate-pending-");
    const files: string[] = [];
    let restore!: () => void;
    const { page } = fakePage(
      {},
      {
        evaluate: vi.fn(async (script: unknown) => {
          if (String(script).includes("removeAttribute")) {
            await new Promise<void>((resolve) => {
              restore = resolve;
            });
          }
          if (String(script).includes("scrollHeight")) return 1080;
          if (script === "window.innerHeight") return 1080;
        }),
      },
    );
    try {
      const capture = captureScrollScreenshots(page, dir, { maxScreenshots: 3, files });
      await vi.advanceTimersByTimeAsync(1000);
      expect(files).toEqual(["screenshots/scroll-000.png", "screenshots/full-page.png"]);
      restore();
      expect((await capture).files).toBe(files);
    } finally {
      vi.useRealTimers();
    }
  });

  it("covers a one-pixel viewport without a zero scroll step", async () => {
    vi.useFakeTimers();
    const dir = tempDir("hf-scroll-tiny-viewport-");
    const { page } = fakePage(
      {},
      {
        evaluate: vi.fn(async (script: unknown) => {
          if (String(script).includes("scrollHeight")) return 20;
          if (script === "window.innerHeight") return 1;
        }),
      },
    );
    try {
      const capture = captureScrollScreenshots(page, dir, { maxScreenshots: 3 });
      await vi.runAllTimersAsync();
      const result = await capture;
      expect(result.files).toEqual([
        "screenshots/scroll-000.png",
        "screenshots/scroll-100.png",
        "screenshots/full-page.png",
      ]);
      expect(result.interruption).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("captureScrollScreenshots — capture budget", () => {
  it("does not begin page work when the post-navigation budget is exhausted", async () => {
    const dir = tempDir("hf-scroll-budget-");
    const evaluate = vi.fn(async () => 1080);
    const screenshot = vi.fn(async () => pngBuffer(1080));
    const page = { evaluate, screenshot } as unknown as Page;

    const result = await captureScrollScreenshots(page, dir, { remainingMs: () => 0 });
    const files = result.files;
    expect(result.interruption?.reason).toBe("budget-exhausted");

    expect(files).toEqual([]);
    expect(evaluate).not.toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
  });

  it("re-checks the budget after settling and before each viewport screenshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const dir = tempDir("hf-scroll-expiring-budget-");
    const evaluate = vi.fn(async (expression: unknown) => {
      const source = String(expression);
      if (source.includes("Math.max(document.body.scrollHeight")) return 1080;
      if (source === "window.innerHeight") return 1080;
      return undefined;
    });
    const screenshot = vi.fn(async () => pngBuffer(1080));
    const page = {
      evaluate,
      screenshot,
      waitForNetworkIdle: vi.fn(async () => undefined),
    } as unknown as Page;

    try {
      const capture = captureScrollScreenshots(page, dir, {
        remainingMs: () => Math.max(0, 600 - Date.now()),
      });
      await vi.runAllTimersAsync();
      const { files } = await capture;

      expect(files).toEqual([]);
      expect(screenshot).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("captureFullPagePlate — capture budget", () => {
  it("re-checks the budget immediately before the full-page screenshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const dir = tempDir("hf-plate-expiring-budget-");
    const screenshot = vi.fn(async () => pngBuffer(8000));
    const evaluate = vi.fn(async (expression: unknown) => {
      if (String(expression).includes("scrollHeight")) {
        vi.setSystemTime(100);
        return 8000;
      }
      return undefined;
    });
    const page = { evaluate, screenshot } as unknown as Page;

    try {
      const plate = await captureFullPagePlate(page, dir, {
        remainingMs: () => Math.max(0, 50 - Date.now()),
      });

      expect(plate).toEqual({ kind: "omitted", reason: "budget-exhausted" });
      expect(screenshot).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("captureFullPagePlate — guards against a silently clipped plate", () => {
  it("measures the height itself, after lazy content has grown the page", async () => {
    const dir = tempDir("hf-plate-");
    // A page that measured 9000 before scrolling but is 20000 once lazy images land: the
    // pre-scroll number would have passed the guard and emitted a clipped plate.
    const { page, screenshot } = fakePage({ docHeight: 20000 });

    expect(await captureFullPagePlate(page, dir)).toEqual({
      kind: "omitted",
      reason: "height-limit",
    });
    expect(screenshot).not.toHaveBeenCalled();
  });

  it("discards a plate Chrome clipped, even when the measurement passed", async () => {
    const dir = tempDir("hf-plate-");
    // Measurement said 16000, but the capture itself triggered more loading and came back
    // over the cap. Emitting it would be undetectable downstream.
    const { page } = fakePage({ docHeight: 16000, plateHeight: MAX_PLATE_HEIGHT_PX + 500 });

    expect(await captureFullPagePlate(page, dir)).toEqual({
      kind: "omitted",
      reason: "height-limit",
    });
    expect(existsSync(join(dir, "full-page.png"))).toBe(false);
  });

  it("survives a restore that throws — the real error is what propagates", async () => {
    const dir = tempDir("hf-plate-");
    let call = 0;
    const evaluate = vi.fn(async (script?: unknown) => {
      call++;
      if (String(script).includes("scrollHeight")) return 8000;
      if (String(script).includes("removeAttribute")) throw new Error("page crashed");
      return undefined;
    });
    const screenshot = vi.fn(async (_opts?: unknown) => {
      throw new Error("capture failed");
    });
    const page = { evaluate, screenshot } as unknown as Page;

    // Without the try/catch in `finally`, "page crashed" would mask "capture failed".
    await expect(captureFullPagePlate(page, dir)).rejects.toThrow("capture failed");
    expect(call).toBeGreaterThanOrEqual(3);
  });
});

describe("pngHeight", () => {
  it("reads the height out of the IHDR chunk", () => {
    expect(pngHeight(pngBuffer(10962))).toBe(10962);
  });

  it("returns null for anything that is not a PNG", () => {
    expect(pngHeight(Buffer.from("not a png at all, definitely not"))).toBeNull();
    expect(pngHeight(Buffer.alloc(4))).toBeNull();
  });
});

describe("captureFullPagePlate — the guard sees the post-neutralisation page (Magi's case)", () => {
  it("skips when the initial height is under the cap but the final height is over it", async () => {
    const dir = tempDir("hf-plate-");
    // Pre-traversal the page measured 9000. Lazy content and un-fixing the sticky header push
    // it over the cap by the time the plate would be shot. Probing before either step would
    // have passed the guard and emitted a clipped plate.
    let neutralised = false;
    const evaluate = vi.fn(async (script?: unknown) => {
      const src = String(script);
      if (src.includes("'sticky'")) {
        neutralised = true;
        return undefined;
      }
      if (src.includes("scrollHeight")) return neutralised ? 20000 : 9000;
      return undefined;
    });
    const screenshot = vi.fn(async (_opts?: unknown) => pngBuffer(20000));
    const page = { evaluate, screenshot } as unknown as Page;

    expect(await captureFullPagePlate(page, dir)).toEqual({
      kind: "omitted",
      reason: "height-limit",
    });
    expect(screenshot).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "full-page.png"))).toBe(false);
    // Bailing out early must still hand the page back unmodified.
    expect(String(evaluate.mock.calls.at(-1)?.[0])).toContain("removeAttribute");
  });
});

describe("captureScrollScreenshots — consent-click page reload (#4923)", () => {
  // The click-evaluate script is the one containing `el.click()`; the overlay
  // sweep contains `createTreeWalker`. While `reloading` is set, evaluate
  // throws like a real page mid-navigation until the idle wait settles it.
  function settledSize(src: string) {
    if (src.includes("scrollHeight")) return 2160;
    if (src === "window.innerHeight") return 1080;
    return undefined;
  }
  function scrollablePage(
    evaluate: ReturnType<typeof vi.fn>,
    waitForNetworkIdle: ReturnType<typeof vi.fn>,
  ) {
    const screenshot = vi.fn(async (_opts?: unknown) => pngBuffer(1080));
    const page = { evaluate, screenshot, waitForNetworkIdle } as unknown as Page;
    return { page, evaluate, waitForNetworkIdle };
  }
  function reloadingPage() {
    let reloading = false;
    const evaluate = vi.fn(async (script?: unknown) => {
      const src = String(script);
      if (src.includes("el.click()")) {
        reloading = true;
        return undefined;
      }
      if (reloading) {
        throw new Error("Execution context was destroyed, most likely because of a navigation");
      }
      return settledSize(src);
    });
    const waitForNetworkIdle = vi.fn(async () => {
      reloading = false;
    });
    return scrollablePage(evaluate, waitForNetworkIdle);
  }

  it("waits out a click-triggered reload before measuring the page", async () => {
    const dir = tempDir("hf-scroll-reload-");
    const { page, evaluate, waitForNetworkIdle } = reloadingPage();

    const files = await captureScrollScreenshots(page, dir);

    expect(files.length).toBeGreaterThan(0);
    expect(waitForNetworkIdle).toHaveBeenCalled();
    const firstIdle = waitForNetworkIdle.mock.invocationCallOrder[0]!;
    const heightProbe = evaluate.mock.calls.findIndex((c) => String(c[0]).includes("scrollHeight"));
    expect(heightProbe).toBeGreaterThanOrEqual(0);
    expect(evaluate.mock.invocationCallOrder[heightProbe]!).toBeGreaterThan(firstIdle);
  });

  it("re-runs the overlay sweep on the reloaded document", async () => {
    const dir = tempDir("hf-scroll-reload-sweep-");
    const { page, evaluate } = reloadingPage();

    await captureScrollScreenshots(page, dir);

    const scripts = evaluate.mock.calls.map((c) => String(c[0]));
    const clickIdx = scripts.findIndex((s) => s.includes("el.click()"));
    const sweepIdx = scripts.findIndex((s) => s.includes("createTreeWalker"));
    const heightIdx = scripts.findIndex((s) => s.includes("scrollHeight"));
    expect(clickIdx).toBeGreaterThanOrEqual(0);
    // Clicks, then the sweep on the settled document, then the height probe —
    // a sweep that ran pre-reload would have been wiped with the old document.
    expect(clickIdx).toBeLessThan(sweepIdx);
    expect(sweepIdx).toBeLessThan(heightIdx);
  });

  it("does not stall when the clicks leave the page in place", async () => {
    const dir = tempDir("hf-scroll-no-reload-");
    const { page, waitForNetworkIdle } = fakePage();

    const files = await captureScrollScreenshots(page, dir);

    // The document reports parsed on the first probe, so the settle pays
    // exactly one idle wait and the run still finishes.
    expect(files.length).toBeGreaterThan(0);
    expect(waitForNetworkIdle).toHaveBeenCalledTimes(1);
  });

  // Puppeteer's waitForNetworkIdle counts a request only until its response
  // headers arrive, so it resolves while a reloaded document is still
  // parsing. waitForNavigation cannot help there — it deadlocks when armed
  // after the navigation commits — so the settle also polls readyState.
  function loadingDocumentPage() {
    let loading = false;
    const evaluate = vi.fn(async (script?: unknown) => {
      const src = String(script);
      if (src.includes("el.click()")) {
        loading = true;
        return undefined;
      }
      if (src.includes("readyState")) {
        if (!loading) return false;
        // The document finishes parsing while the settle loop waits for it.
        queueMicrotask(() => {
          loading = false;
        });
        return true;
      }
      if (loading) {
        throw new Error("Execution context was destroyed, most likely because of a navigation");
      }
      return settledSize(src);
    });
    return scrollablePage(
      evaluate,
      vi.fn(async () => undefined),
    );
  }

  it("waits out a reloaded document that is still parsing after network idle", async () => {
    const dir = tempDir("hf-scroll-loading-doc-");
    const { page, evaluate, waitForNetworkIdle } = loadingDocumentPage();

    const files = await captureScrollScreenshots(page, dir);

    expect(files.length).toBeGreaterThan(0);
    // A second idle wait runs once the document finishes loading, before the
    // height probe measures the rebuilt page.
    expect(waitForNetworkIdle).toHaveBeenCalledTimes(2);
    const lastIdle = waitForNetworkIdle.mock.invocationCallOrder.at(-1)!;
    const heightProbe = evaluate.mock.calls.findIndex((c) => String(c[0]).includes("scrollHeight"));
    expect(evaluate.mock.invocationCallOrder[heightProbe]!).toBeGreaterThan(lastIdle);
  });
});

describe("captureScrollScreenshots — planted screenshots link (#4304)", () => {
  // Creating symlinks needs elevated rights on Windows.
  it.skipIf(process.platform === "win32")(
    "refuses a planted screenshots/ symlink before touching the page",
    async () => {
      const dir = tempDir("hf-scroll-planted-");
      const outside = join(dir, "outside");
      mkdirSync(outside);
      symlinkSync(outside, join(dir, "screenshots"));
      const { page, evaluate, screenshot } = fakePage();

      await expect(captureScrollScreenshots(page, dir)).rejects.toThrow(CaptureDirRefusedError);

      expect(readdirSync(outside)).toEqual([]);
      expect(evaluate).not.toHaveBeenCalled();
      expect(screenshot).not.toHaveBeenCalled();
    },
  );
});
