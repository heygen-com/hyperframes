import { spawn } from "node:child_process";
import type { Browser, Page } from "puppeteer-core";
import { c } from "../ui/colors.js";
import { resolveCompositionViewportFromHtml } from "../utils/compositionViewport.js";

const CHROME_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--enable-webgl",
  "--use-gl=angle",
  "--use-angle=swiftshader",
];

const SHADER_TRANSITIONS_TIMEOUT_MS = 90_000;
const CAPTURE_SETTLE_MS = 1500;

export interface SettledCompositionPage {
  browser: Browser;
  page: Page;
  // True when the runtime never signaled __renderReady within the timeout — the
  // capture proceeds anyway (possibly mid-animation), so callers can surface it.
  renderReadyTimedOut: boolean;
}

export interface OpenSettledCompositionPageOptions {
  renderReadyTimeoutMs: number;
  renderReadyWarningSuffix: string;
}

export interface FfmpegRunResult {
  code: number | null;
  stderr: string;
  timedOut: boolean;
}

function compositionRuntimeReadyInBrowser(): boolean {
  return Boolean(Reflect.get(window, "__renderReady"));
}

function shaderTransitionsReadyInBrowser(): boolean {
  function shaderTransitionRegistryReady(): boolean | undefined {
    const hf = Reflect.get(window, "__hf");
    if (typeof hf !== "object" || hf === null) return undefined;

    const shaderTransitions = Reflect.get(hf, "shaderTransitions");
    if (typeof shaderTransitions !== "object" || shaderTransitions === null) return undefined;

    for (const key of Object.keys(shaderTransitions)) {
      const entry = Reflect.get(shaderTransitions, key);
      if (typeof entry !== "object" || entry === null) return false;
      if (Reflect.get(entry, "ready") !== true) return false;
    }
    return true;
  }

  function shaderLoadingOverlayReady(): boolean {
    const overlay = document.querySelector("[data-hyper-shader-loading]");
    if (!overlay) return true;
    if (!(overlay instanceof HTMLElement)) return true;
    return window.getComputedStyle(overlay).display === "none";
  }

  return shaderTransitionRegistryReady() ?? shaderLoadingOverlayReady();
}

async function waitForCompositionSettle(
  page: Page,
  options: OpenSettledCompositionPageOptions,
): Promise<boolean> {
  const runtimeReady = await page
    .waitForFunction(compositionRuntimeReadyInBrowser, { timeout: options.renderReadyTimeoutMs })
    .then(() => true)
    .catch(() => false);

  if (!runtimeReady) {
    console.warn(
      `\n   ${c.warn("⚠")} Runtime did not become render-ready within ${options.renderReadyTimeoutMs}ms — ${options.renderReadyWarningSuffix}`,
    );
  }

  await page
    .waitForFunction(shaderTransitionsReadyInBrowser, {
      timeout: SHADER_TRANSITIONS_TIMEOUT_MS,
    })
    .catch(() => {
      console.warn(`   ${c.warn("⚠")} Shader transitions did not finish pre-rendering`);
    });

  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await new Promise((resolveSettle) => setTimeout(resolveSettle, CAPTURE_SETTLE_MS));
  return runtimeReady;
}

export async function openSettledCompositionPage(
  html: string,
  url: string,
  options: OpenSettledCompositionPageOptions,
): Promise<SettledCompositionPage> {
  const { ensureBrowser } = await import("../browser/manager.js");
  const browser = await ensureBrowser();
  const puppeteer = await import("puppeteer-core");

  let chromeBrowser: Browser | undefined;
  try {
    chromeBrowser = await puppeteer.default.launch({
      headless: true,
      executablePath: browser.executablePath,
      args: CHROME_LAUNCH_ARGS,
    });

    const page = await chromeBrowser.newPage();
    await page.setViewport(resolveCompositionViewportFromHtml(html));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
    const renderReadyTimedOut = !(await waitForCompositionSettle(page, options));
    return { browser: chromeBrowser, page, renderReadyTimedOut };
  } catch (err) {
    await chromeBrowser?.close().catch(() => {});
    throw err;
  }
}

export async function seekCompositionTimeline(
  page: Pick<Page, "evaluate">,
  timeSeconds: number,
): Promise<void> {
  await page.evaluate((t: number) => {
    const player = (window as any).__player;
    if (!player) return;
    const safe = Math.max(0, Number(t) || 0);
    if (typeof player.renderSeek === "function") {
      player.renderSeek(safe);
    } else if (typeof player.seek === "function") {
      player.seek(safe);
    }
    if ((window as any).gsap?.ticker?.tick) {
      (window as any).gsap.ticker.tick();
    }
  }, timeSeconds);

  await page.evaluate(`new Promise(function(r) {
    var settled = false;
    function finish() { if (settled) return; settled = true; r(); }
    window.setTimeout(finish, 100);
    requestAnimationFrame(function() { requestAnimationFrame(finish); });
  })`);
}

export async function runFfmpegOnce(
  ffmpegPath: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<FfmpegRunResult> {
  return await new Promise((resolvePromise) => {
    const ff = spawn(ffmpegPath, args);
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ff.kill("SIGTERM");
    }, timeoutMs);

    ff.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    ff.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stderr, timedOut });
    });
    ff.on("error", () => {
      clearTimeout(timer);
      resolvePromise({ code: null, stderr: "ffmpeg spawn failed", timedOut });
    });
  });
}
