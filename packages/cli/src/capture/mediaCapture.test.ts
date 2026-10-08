import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "puppeteer-core";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureVideoManifest,
  remainingVideoDownloadTimeoutMs,
  renderLottiePreviews,
  saveLottieAnimations,
} from "./mediaCapture.js";
import { CaptureDirRefusedError } from "./captureErrors.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-media-budget-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

describe("Lottie capture budget", () => {
  it("keeps saved embedded-image animations in the manifest above the preview limit", async () => {
    const dir = tempDir();
    const lottieDir = join(dir, "assets", "lottie");
    mkdirSync(join(dir, "extracted"), { recursive: true });
    const pixels = Buffer.alloc(800 * 800 * 3);
    let seed = 73129;
    for (let i = 0; i < pixels.length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      pixels[i] = seed & 255;
    }
    const image = await sharp(pixels, { raw: { width: 800, height: 800, channels: 3 } })
      .png()
      .toBuffer();
    const data = {
      v: "5.12.2",
      nm: "Embedded image",
      w: 800,
      h: 800,
      fr: 30,
      ip: 0,
      op: 90,
      assets: [
        {
          id: "image",
          w: 800,
          h: 800,
          u: "",
          p: `data:image/png;base64,${image.toString("base64")}`,
          e: 1,
        },
      ],
      layers: [
        {
          ty: 2,
          ind: 1,
          refId: "image",
          sr: 1,
          ks: {
            o: { a: 0, k: 100 },
            r: { a: 0, k: 0 },
            p: { a: 0, k: [400, 400, 0] },
            a: { a: 0, k: [400, 400, 0] },
            s: { a: 0, k: [100, 100, 100] },
          },
          ip: 0,
          op: 90,
          st: 0,
          bm: 0,
        },
      ],
    };
    expect(
      await saveLottieAnimations(
        [{ url: "https://public.example/photo.json", data }],
        lottieDir,
        dir,
      ),
    ).toBe(1);
    const saved = readFileSync(join(lottieDir, "animation-0.json"), "utf8");
    expect(Buffer.byteLength(saved)).toBeGreaterThan(2_000_000);
    const newPage = vi.fn();
    const browser = { newPage } as unknown as Browser;

    await renderLottiePreviews(browser, lottieDir, dir);

    expect(newPage).not.toHaveBeenCalled();
    expect(
      JSON.parse(readFileSync(join(dir, "extracted", "lottie-manifest.json"), "utf8")),
    ).toEqual([
      {
        file: "assets/lottie/animation-0.json",
        name: "Embedded image",
        width: 800,
        height: 800,
        duration: 3,
        frameRate: 30,
        layers: 1,
      },
    ]);
    expect(readdirSync(join(lottieDir, "previews"))).toEqual([]);
    expect(readFileSync(join(lottieDir, "animation-0.json"), "utf8")).toBe(saved);
  });

  it("does not start another Lottie fetch after the live budget expires", async () => {
    const dir = tempDir();
    let remainingMs = 10_000;
    const fetchMock = vi.fn(async () => {
      remainingMs = 0;
      return new Response(JSON.stringify({ w: 100, h: 100, layers: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const saved = await saveLottieAnimations(
      [{ url: "https://one.example/a.json" }, { url: "https://two.example/b.json" }],
      dir,
      dir,
      { remainingMs: () => remainingMs },
    );

    expect(saved).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not open another Lottie preview page after the live budget expires", async () => {
    const dir = tempDir();
    const lottieDir = join(dir, "assets", "lottie");
    mkdirSync(join(dir, "extracted"), { recursive: true });
    mkdirSync(lottieDir, { recursive: true });
    const lottie = JSON.stringify({ w: 100, h: 100, fr: 30, ip: 0, op: 30, layers: [] });
    writeFileSync(join(lottieDir, "a.json"), lottie);
    writeFileSync(join(lottieDir, "b.json"), lottie);

    let remainingMs = 10_000;
    const previewPage = {
      setRequestInterception: vi.fn(async () => undefined),
      on: vi.fn(),
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const newPage = vi.fn(async () => {
      remainingMs = 0;
      return previewPage;
    });
    const browser = { newPage } as unknown as Browser;

    await renderLottiePreviews(browser, lottieDir, dir, { remainingMs: () => remainingMs });

    expect(newPage).toHaveBeenCalledTimes(1);
    expect(previewPage.setViewport).not.toHaveBeenCalled();
    expect(previewPage.screenshot).not.toHaveBeenCalled();
  });

  it("omits a preview path when the budget expires after Lottie readiness", async () => {
    const dir = tempDir();
    const lottieDir = join(dir, "assets", "lottie");
    mkdirSync(join(dir, "extracted"), { recursive: true });
    mkdirSync(lottieDir, { recursive: true });
    writeFileSync(
      join(lottieDir, "logo.json"),
      JSON.stringify({
        nm: "Logo",
        w: 100,
        h: 100,
        fr: 30,
        ip: 0,
        op: 30,
        layers: [],
      }),
    );

    const screenshot = vi.fn(async () => undefined);
    const previewPage = {
      setRequestInterception: vi.fn(async () => undefined),
      on: vi.fn(),
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      screenshot,
      close: vi.fn(async () => undefined),
    };
    const browser = { newPage: vi.fn(async () => previewPage) } as unknown as Browser;
    let budgetChecks = 0;

    await renderLottiePreviews(browser, lottieDir, dir, {
      remainingMs: () => (++budgetChecks < 4 ? 10_000 : 0),
    });

    const manifest = JSON.parse(
      readFileSync(join(dir, "extracted", "lottie-manifest.json"), "utf-8"),
    );
    expect(screenshot).not.toHaveBeenCalled();
    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatchObject({
      file: "assets/lottie/logo.json",
      name: "Logo",
      width: 100,
      height: 100,
    });
    expect(manifest[0]).not.toHaveProperty("preview");
    expect(existsSync(join(lottieDir, "previews", "logo-preview.png"))).toBe(false);
  });
});

describe("video capture live budget", () => {
  it("does not preview or download when the budget expires during DOM sampling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const dir = tempDir();
    mkdirSync(join(dir, "extracted"), { recursive: true });
    const descriptor = {
      src: "https://video.example/hero.mp4",
      filename: "hero.mp4",
      width: 640,
      height: 360,
      sourceWidth: 640,
      sourceHeight: 360,
      top: 0,
      left: 0,
      heading: "Hero",
      caption: "Demo",
      ariaLabel: "",
    };
    const screenshot = vi.fn(async () => Buffer.from("preview"));
    const evaluate = vi.fn(async (expression: unknown) =>
      typeof expression === "function" ? { x: 0, y: 0, width: 640, height: 360 } : [descriptor],
    );
    const page = { evaluate, screenshot } as unknown as Page;
    const fetchMock = vi.fn(
      async () =>
        new Response(Buffer.alloc(2048), {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const capture = captureVideoManifest(page, dir, () => {}, {
      sampleMs: 10_000,
      downloadBudgetMs: 10_000,
      remainingMs: () => Math.max(0, 1_000 - Date.now()),
    });
    await vi.runAllTimersAsync();
    await capture;

    expect(screenshot).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("remainingVideoDownloadTimeoutMs", () => {
  it("caps a video request to the remaining capture budget", () => {
    expect(remainingVideoDownloadTimeoutMs(1_000, 5_000, 4_500)).toBe(1_500);
  });

  it("returns zero after the aggregate budget is exhausted", () => {
    expect(remainingVideoDownloadTimeoutMs(1_000, 5_000, 6_001)).toBe(0);
  });

  it("retains the existing per-request ceiling when more budget remains", () => {
    expect(remainingVideoDownloadTimeoutMs(1_000, 300_000, 2_000)).toBe(120_000);
  });
});

describe("Lottie capture rejects unsafe persistence", () => {
  it("does not write corrupt archives as raw Lottie files", async () => {
    const dir = tempDir();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not a zip")),
    );
    expect(
      await saveLottieAnimations([{ url: "https://public.example/bad.lottie" }], dir, dir),
    ).toBe(0);
    expect(readdirSync(dir)).toEqual([]);
  });
  it("does not publish truthy non-array layers", async () => {
    const dir = tempDir();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"w":100,"h":100,"layers":true}')),
    );
    expect(await saveLottieAnimations([{ url: "https://public.example/bad.json" }], dir, dir)).toBe(
      0,
    );
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("media previews replace pre-planted links", () => {
  const PNG = Buffer.from("\x89PNG preview");

  it.skipIf(process.platform === "win32")(
    "writes a Lottie preview without following a pre-planted symlink",
    async () => {
      const dir = tempDir();
      const lottieDir = join(dir, "assets", "lottie");
      const previewPath = join(lottieDir, "previews", "logo-preview.png");
      const victim = join(dir, "victim.txt");
      mkdirSync(join(dir, "extracted"), { recursive: true });
      mkdirSync(join(lottieDir, "previews"), { recursive: true });
      writeFileSync(
        join(lottieDir, "logo.json"),
        JSON.stringify({ w: 100, h: 100, fr: 30, ip: 0, op: 30, layers: [] }),
      );
      writeFileSync(victim, "do not touch");
      symlinkSync(victim, previewPath);
      const previewPage = {
        setRequestInterception: vi.fn(async () => undefined),
        on: vi.fn(),
        setViewport: vi.fn(async () => undefined),
        setContent: vi.fn(async () => undefined),
        evaluate: vi.fn(async () => undefined),
        waitForFunction: vi.fn(async () => undefined),
        screenshot: vi.fn(async () => PNG),
        close: vi.fn(async () => undefined),
      };
      const browser = { newPage: vi.fn(async () => previewPage) } as unknown as Browser;

      await renderLottiePreviews(browser, lottieDir, dir);

      expect(readFileSync(victim, "utf8")).toBe("do not touch");
      expect(readFileSync(previewPath)).toEqual(PNG);
      expect(lstatSync(previewPath).isSymbolicLink()).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "writes a video preview without following a pre-planted symlink",
    async () => {
      const dir = tempDir();
      const previewPath = join(dir, "assets", "videos", "previews", "video-0-preview.png");
      const victim = join(dir, "victim.txt");
      mkdirSync(join(dir, "extracted"), { recursive: true });
      mkdirSync(join(dir, "assets", "videos", "previews"), { recursive: true });
      writeFileSync(victim, "do not touch");
      symlinkSync(victim, previewPath);
      const descriptor = {
        src: "https://video.example/hero.mp4",
        filename: "hero.mp4",
        width: 640,
        height: 360,
        sourceWidth: 640,
        sourceHeight: 360,
        top: 0,
        left: 0,
        heading: "Hero",
        caption: "Demo",
        ariaLabel: "",
      };
      const evaluate = vi.fn(async (expression: unknown) =>
        typeof expression === "function" ? { x: 0, y: 0, width: 640, height: 360 } : [descriptor],
      );
      const page = { evaluate, screenshot: vi.fn(async () => PNG) } as unknown as Page;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 404 })),
      );

      await captureVideoManifest(page, dir, () => {});

      expect(readFileSync(victim, "utf8")).toBe("do not touch");
      expect(readFileSync(previewPath)).toEqual(PNG);
      expect(lstatSync(previewPath).isSymbolicLink()).toBe(false);
    },
  );
});

describe("media folders refuse a planted directory link (#4304)", () => {
  // captureVideoManifest keeps any http(s) video it finds; only the URL matters here.
  const descriptor = { src: "https://video.example/planted.mp4", filename: "planted.mp4" };

  function plantedCapture(link: string): { dir: string; outside: string } {
    const dir = tempDir();
    const outside = join(dir, "outside");
    mkdirSync(outside);
    mkdirSync(join(dir, "extracted"));
    mkdirSync(join(dir, link, ".."), { recursive: true });
    symlinkSync(outside, join(dir, link));
    return { dir, outside };
  }

  // Creating symlinks needs elevated rights on Windows.
  it.skipIf(process.platform === "win32").each(["assets/videos", "assets/videos/previews"])(
    "does not write the video manifest through a planted %s link",
    async (link) => {
      const { dir, outside } = plantedCapture(link);
      const screenshot = vi.fn();
      const page = { evaluate: vi.fn(async () => [descriptor]), screenshot } as unknown as Page;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 404 })),
      );

      await expect(captureVideoManifest(page, dir, () => {})).rejects.toThrow(
        CaptureDirRefusedError,
      );
      expect(readdirSync(outside)).toEqual([]);
      expect(screenshot).not.toHaveBeenCalled();
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a dangling assets/videos link before its previews folder",
    async () => {
      const dir = tempDir();
      const target = join(dir, "missing");
      mkdirSync(join(dir, "assets"), { recursive: true });
      symlinkSync(target, join(dir, "assets", "videos"));
      const page = {
        evaluate: vi.fn(async () => [descriptor]),
        screenshot: vi.fn(),
      } as unknown as Page;

      await expect(captureVideoManifest(page, dir, () => {})).rejects.toThrow(
        CaptureDirRefusedError,
      );
      expect(existsSync(target)).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "does not save Lottie files through a planted assets/lottie link",
    async () => {
      const { dir, outside } = plantedCapture("assets/lottie");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        saveLottieAnimations(
          [{ url: "https://public.example/a.json" }],
          join(dir, "assets", "lottie"),
          dir,
        ),
      ).rejects.toThrow(CaptureDirRefusedError);
      expect(readdirSync(outside)).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.skipIf(process.platform === "win32")(
    "does not render Lottie previews through a planted previews link",
    async () => {
      const { dir, outside } = plantedCapture("assets/lottie/previews");
      const browser = { newPage: vi.fn() } as unknown as Browser;

      await expect(
        renderLottiePreviews(browser, join(dir, "assets", "lottie"), dir),
      ).rejects.toThrow(CaptureDirRefusedError);
      expect(readdirSync(outside)).toEqual([]);
      expect(browser.newPage).not.toHaveBeenCalled();
    },
  );
});
