// Onion-skin motion screenshot: seek the LIVE timeline at N equal-time steps and
// project the REAL element at each step, so an agent can SELF-VERIFY motion (the
// rendered result — every channel: position, rotation, scale, opacity, colour),
// not just the authored x/y numbers. Reuses the headless-Chrome + static-server
// pattern from layout.ts.
//
// 3D is captured for free: zero-size marker children at the element's corners are
// projected by the browser, so a tilted/edge-on element renders as a real quad.
// Framing controls (samples / time window / fit / filmstrip) let the agent frame
// exactly what it's editing. All geometry + SVG live in ./motionShotLayout.ts
// (pure, tested); this file only drives the browser and SAMPLES.

import { writeFileSync } from "node:fs";
import {
  buildOnionSvg,
  parseAngle,
  resolveShotSelectors,
  sampleTimes,
  type OnionElement,
} from "./motionShotLayout.js";

export interface ShotRequest {
  /** CSS selector of the moving element to sample (e.g. "#dot"). */
  selector: string;
}

/** Returned by the in-browser selector resolver: which animated selectors a
 *  `--selector SCOPE` actually resolves to (scope itself, or its descendants),
 *  plus diagnostic context when nothing under the scope animates. */
interface ScopeResolution {
  /** Animated selectors to sample (subset of `requests`). */
  selectors: string[];
  /** True when the scope selector matched a real element in the DOM. */
  scopeExists: boolean;
}

export interface ShotOptions {
  /** Equal-time samples across the (windowed) timeline. Default 9. */
  samples?: number;
  /** "path" = ghosts at real positions + path; "strip" = filmstrip by time. */
  layout?: "path" | "strip";
  /** Zoom the motion to fill the frame. Default true. */
  fit?: boolean;
  /** Sample only this time window (seconds) — dense inspection of one phase. */
  from?: number | null;
  to?: number | null;
  /** Orbit camera: a preset (front|iso|top|side) or "yaw,pitch" degrees. */
  angle?: string;
  /** `--selector` scope: when the user focused one element, narrow `requests`
   *  to that element if it animates, else to its animated descendants (so a
   *  static `.clip` wrapper resolves to the animated children under it). */
  scopeSelector?: string | null;
}

interface PageSample {
  t: number;
  q: Array<{ x: number; y: number }>;
  c: { x: number; y: number };
  color: string;
  opacity: number;
}

// Runs IN THE BROWSER (serialized by page.evaluate). Make the element's ancestor
// chain preserve-3d, strip intermediate perspective, put one perspective on the
// composition root's parent (the lens) and rotate the root — so the element's own
// 3D is viewed from the requested angle on any composition shape (no #stage assumption).
function applyOrbitCamera(selectors: string[], cam: { yaw: number; pitch: number }): void {
  const first = document.querySelector(selectors[0] ?? "");
  const root =
    (first?.closest("[data-composition-id]") as HTMLElement | null) ??
    (document.querySelector("#stage") as HTMLElement | null) ??
    (document.body.firstElementChild as HTMLElement | null) ??
    document.body;
  for (const sel of selectors) {
    let n = document.querySelector(sel) as HTMLElement | null;
    while (n && n !== root) {
      n.style.transformStyle = "preserve-3d";
      n.style.perspective = "none";
      n = n.parentElement;
    }
  }
  root.style.transformStyle = "preserve-3d";
  root.style.perspective = "none";
  root.style.transformOrigin = "50% 50%";
  root.style.transform = `rotateX(${cam.pitch}deg) rotateY(${cam.yaw}deg)`;
  const lens = root.parentElement ?? document.body;
  lens.style.perspective = "1600px";
  lens.style.perspectiveOrigin = "50% 50%";
}

// Launch headless Chrome, load the composition sized to its canvas, wait for the
// timelines + fonts to be ready. Returns the browser (caller closes it), page, size.
async function openCompositionPage(
  url: string,
  executablePath: string,
): Promise<{
  browser: import("puppeteer-core").Browser;
  page: import("puppeteer-core").Page;
  size: { width: number; height: number };
}> {
  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.default.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--enable-webgl",
      "--use-gl=angle",
      "--use-angle=swiftshader",
    ],
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
  const size = await page.evaluate(() => {
    const root = document.querySelector("[data-composition-id][data-width][data-height]");
    const w = root ? parseInt(root.getAttribute("data-width") ?? "", 10) : 0;
    const h = root ? parseInt(root.getAttribute("data-height") ?? "", 10) : 0;
    return {
      width: Number.isFinite(w) && w > 0 ? Math.min(w, 4096) : 1920,
      height: Number.isFinite(h) && h > 0 ? Math.min(h, 4096) : 1080,
    };
  });
  await page.setViewport(size);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
  await page
    .waitForFunction(() => !!(window as unknown as { __timelines?: unknown }).__timelines, {
      timeout: 10000,
    })
    .catch(() => {});
  await page
    .evaluate(async () => {
      const d = document as unknown as { fonts?: { ready?: Promise<unknown> } };
      if (d.fonts?.ready) await d.fonts.ready;
    })
    .catch(() => {});
  return { browser, page, size };
}

// Longest paused timeline duration (seconds) across all registered timelines.
function timelineDuration(page: import("puppeteer-core").Page): Promise<number> {
  return page.evaluate(() => {
    const tls = Object.values(
      (
        window as unknown as {
          __timelines?: Record<string, { duration?: () => number; totalDuration?: () => number }>;
        }
      ).__timelines ?? {},
    );
    let d = 0;
    for (const tl of tls) {
      try {
        d = Math.max(d, (tl.totalDuration?.() ?? tl.duration?.() ?? 0) as number);
      } catch {
        // skip
      }
    }
    return d;
  });
}

// In the live DOM, decide which animated selectors fall under `scope`: read
// whether the scope exists and, for each candidate, whether it is the scope or a
// descendant of it. The pure decision (motionShotLayout.resolveShotSelectors)
// runs Node-side on the booleans this returns, so it stays unit-testable.
async function resolveScopeInBrowser(
  page: import("puppeteer-core").Page,
  scope: string,
  candidates: string[],
): Promise<ScopeResolution> {
  const probe = await page.evaluate(
    (scopeSel: string, cands: string[]) => {
      let root: Element | null = null;
      try {
        root = document.querySelector(scopeSel);
      } catch {
        root = null;
      }
      const descendant = cands.map((sel) => {
        if (!root) return false;
        let el: Element | null = null;
        try {
          el = document.querySelector(sel);
        } catch {
          return false;
        }
        return !!el && (el === root || root.contains(el));
      });
      return { scopeExists: !!root, descendant };
    },
    scope,
    candidates,
  );
  const selectors = resolveShotSelectors(
    scope,
    candidates,
    (_s, target) => probe.descendant[candidates.indexOf(target)] === true,
  );
  return { selectors, scopeExists: probe.scopeExists };
}

/** Render `projectDir`'s index headless, sample each element's motion as a 3D
 *  onion-skin, screenshot to `outPath` (PNG). Returns the saved path. */
export async function captureMotionPathShot(
  projectDir: string,
  requestsIn: ShotRequest[],
  outPath: string,
  opts: ShotOptions = {},
): Promise<string> {
  let requests = requestsIn;
  const samples = Math.max(1, Math.min(60, opts.samples ?? 9));
  const layout = opts.layout ?? "path";
  const fit = opts.fit ?? true;
  const camera = parseAngle(opts.angle);

  const { ensureBrowser } = await import("../browser/manager.js");
  const { serveStaticProjectHtml } = await import("../utils/staticProjectServer.js");
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");

  const html = await bundleToSingleHtml(projectDir);
  const server = await serveStaticProjectHtml(
    projectDir,
    html,
    "Failed to bind motion shot server",
  );
  let browserInstance: import("puppeteer-core").Browser | undefined;
  try {
    const browser = await ensureBrowser();
    const opened = await openCompositionPage(server.url, browser.executablePath);
    browserInstance = opened.browser;
    const { page, size } = opened;

    // --selector scope: the focused element is often a STATIC wrapper (`.clip`)
    // whose animated children carry the tweens. Resolve, in the live DOM, to the
    // scope itself if it animates, else its animated descendants — so the shot
    // works on the standard composition shape instead of erroring.
    if (opts.scopeSelector) {
      const resolved = await resolveScopeInBrowser(
        page,
        opts.scopeSelector,
        requests.map((r) => r.selector),
      );
      if (!resolved.scopeExists) {
        throw new Error(`--shot: --selector '${opts.scopeSelector}' matched no element.`);
      }
      if (resolved.selectors.length === 0) {
        const nearest = requests
          .slice(0, 5)
          .map((r) => r.selector)
          .join(", ");
        throw new Error(
          `--shot: nothing animates under '${opts.scopeSelector}'. Nearest animated elements: ${nearest || "(none)"}.`,
        );
      }
      requests = resolved.selectors.map((selector) => ({ selector }));
    }

    const times = sampleTimes(
      await timelineDuration(page),
      samples,
      opts.from ?? null,
      opts.to ?? null,
    );

    // Orbit camera as its own step (keeps the sampler simple), only when angled.
    if (camera.yaw !== 0 || camera.pitch !== 0) {
      await page.evaluate(
        applyOrbitCamera,
        requests.map((r) => r.selector),
        camera,
      );
    }

    // Sample: seek to each time, read every element's projected corners. Marker
    // children (zero-size) inherit the element's full transform chain, so their
    // screen positions ARE the 3D projection of each corner.
    const elements = (await page.evaluate(
      (selectors: string[], ts: number[]) => {
        const tls = Object.values(
          (
            window as unknown as {
              __timelines?: Record<string, { pause?: () => void; seek?: (t: number) => void }>;
            }
          ).__timelines ?? {},
        );
        const seekAll = (t: number) =>
          tls.forEach((tl) => {
            try {
              tl.pause?.();
              tl.seek?.(t);
            } catch {
              // best-effort
            }
          });

        const rigs = selectors.map((sel) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return null;
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          const local: Array<[number, number]> = [
            [0, 0],
            [w, 0],
            [w, h],
            [0, h],
            [w / 2, h / 2],
          ];
          const markers = local.map(([lx, ly]) => {
            const m = document.createElement("div");
            m.style.cssText = `position:absolute;left:${lx}px;top:${ly}px;width:0;height:0;pointer-events:none`;
            el.appendChild(m);
            return m;
          });
          return { el, markers };
        });
        const out = selectors.map((selector) => ({ selector, samples: [] as PageSample[] }));
        for (const t of ts) {
          seekAll(t);
          rigs.forEach((rig, i) => {
            if (!rig) return;
            const pts = rig.markers.map((m) => {
              const r = m.getBoundingClientRect();
              return { x: r.left, y: r.top };
            });
            const cs = getComputedStyle(rig.el);
            out[i]!.samples.push({
              t: Math.round(t * 1000) / 1000,
              q: pts.slice(0, 4),
              c: pts[4]!,
              color: cs.backgroundColor,
              opacity: parseFloat(cs.opacity) || 0,
            });
          });
        }
        rigs.forEach((rig) => {
          if (rig) rig.el.style.visibility = "hidden";
        });
        return out.filter((o) => o.samples.length > 0);
      },
      requests.map((r) => r.selector),
      times,
    )) as OnionElement[];

    const windowStr =
      opts.from != null || opts.to != null ? `  ·  t ${times[0]}–${times[times.length - 1]}s` : "";
    const camLabel =
      camera.yaw === 0 && camera.pitch === 0
        ? "front"
        : `yaw ${camera.yaw}° pitch ${camera.pitch}°`;
    const label = `${camLabel}  ·  ${layout === "strip" ? "filmstrip" : fit ? "zoom-fit" : "1:1"}  ·  ${times.length} frames${windowStr}`;
    const svg = buildOnionSvg(elements, {
      layout,
      fit,
      width: size.width,
      height: size.height,
      label,
    });

    await page.evaluate((markup: string) => {
      document.body.insertAdjacentHTML("beforeend", markup);
    }, svg);
    await new Promise((r) => setTimeout(r, 60));

    const buf = await page.screenshot({ type: "png" });
    if (!buf) throw new Error("screenshot returned no data");
    writeFileSync(outPath, buf as Uint8Array);
    return outPath;
  } finally {
    await browserInstance?.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
