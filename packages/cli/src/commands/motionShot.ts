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
  ghostAlphas,
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
  /** Rendered ("ghost") onion-skin: capture the canvas pixels at each sample and
   *  composite them as translucent ghosts (older fainter → newest solid) — the
   *  canvas/WebGL motion the bbox-marker onion can't see. Requires a <canvas>. */
  ghost?: boolean;
}

interface PageSample {
  t: number;
  q: Array<{ x: number; y: number }>;
  c: { x: number; y: number };
  color: string;
  opacity: number;
}

type OrbitCamera = { yaw: number; pitch: number };
type FrameSize = { width: number; height: number };

// Runs IN THE BROWSER (serialized by page.evaluate). Make the element's ancestor
// chain preserve-3d, strip intermediate perspective, put one perspective on the
// composition root's parent (the lens) and rotate the root — so the element's own
// 3D is viewed from the requested angle on any composition shape (no #stage assumption).
function applyOrbitCamera(selectors: string[], cam: OrbitCamera): void {
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

// Runs IN THE BROWSER. Composite N real painted frames (data URLs) onto a black
// canvas with per-frame opacity (older fainter → newest solid) so canvas/WebGL
// motion reads as a rendered onion-skin trail. Returns the composite as a PNG
// data URL. Used by the `--ghost` mode.
function compositeGhostFrames(
  frames: string[],
  alphas: number[],
  W: number,
  H: number,
  label: string,
): Promise<string> {
  return new Promise((resolve) => {
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d");
    if (!ctx) {
      resolve("");
      return;
    }
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    let i = 0;
    const step = () => {
      if (i >= frames.length) {
        ctx.globalAlpha = 1;
        ctx.font = "600 22px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillStyle = "#86c2ff";
        ctx.fillText(label, 24, 38);
        resolve(cv.toDataURL("image/png"));
        return;
      }
      const img = new Image();
      img.onload = () => {
        ctx.globalAlpha = alphas[i] ?? 1;
        ctx.drawImage(img, 0, 0, W, H);
        i += 1;
        step();
      };
      img.onerror = () => {
        i += 1;
        step();
      };
      img.src = frames[i] ?? "";
    };
    step();
  });
}

// Runs IN THE BROWSER. Self-contained (only `tt` + window/document — never a
// Node-side closure variable), pauses/seeks every adapter to time `tt`: GSAP
// `__timelines`, the Web Animations API, `__hfAnime` instances, then dispatches
// `hf-seek` and nudges the three/GSAP render hooks. This one routine backs BOTH
// the ghost-frame capture and the marker sampler below — see installSeekHelper
// for why it's installed as a page global instead of being duplicated inline
// (Puppeteer's page.evaluate only serializes the single function passed to it,
// so a Node-side function can't be *called* from inside another evaluate
// callback; it can only be reused by installing its source as a real page
// global once, up front).
function seekAllAdaptersInBrowser(tt: number): void {
  const tryCall = (fn: () => void): void => {
    try {
      fn();
    } catch {
      /* best-effort */
    }
  };
  const w = window as unknown as {
    __player?: { renderSeek?: (t: number) => void; seek?: (t: number) => void };
    __hfThreeTime?: number;
    __hfThreeRender?: () => void;
    __hfAnime?: Array<{ pause?: () => void; seek?: (timeMs: number) => void }>;
    gsap?: { ticker?: { tick?: () => void } };
    __timelines?: Record<
      string,
      {
        pause?: () => void;
        seek?: (t: number) => void;
        totalTime?: (t: number, s: boolean) => void;
      }
    >;
  };
  const timeMs = Math.max(0, tt * 1000);

  tryCall(() => {
    if (typeof w.__player?.renderSeek === "function") w.__player.renderSeek(tt);
    else if (typeof w.__player?.seek === "function") w.__player.seek(tt);
  });

  Object.values(w.__timelines ?? {}).forEach((tl) => {
    tryCall(() => {
      tl.pause?.();
      if (typeof tl.totalTime === "function") {
        tl.totalTime(tt + 0.001, true);
        tl.totalTime(tt, false);
      } else {
        tl.seek?.(tt);
      }
    });
  });

  tryCall(() => {
    if (typeof document.getAnimations === "function") {
      for (const animation of document.getAnimations()) {
        tryCall(() => {
          animation.currentTime = timeMs;
        });
        tryCall(() => animation.pause());
      }
    }
  });

  for (const instance of w.__hfAnime ?? []) {
    tryCall(() => {
      instance.pause?.();
      instance.seek?.(timeMs);
    });
  }

  tryCall(() => {
    w.__hfThreeTime = tt;
    window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time: tt } }));
    w.__hfThreeRender?.();
    w.gsap?.ticker?.tick?.();
  });
}

// Installs seekAllAdaptersInBrowser as a real `window` global, once per page
// load. Both the ghost-frame capture and the marker sampler then call it via a
// plain property access instead of re-declaring its body — see the function's
// own doc comment for why a page global (rather than a Node-side reference) is
// required here.
async function installSeekHelper(page: import("puppeteer-core").Page): Promise<void> {
  await page.evaluate(`window.__hfSeekAllAdapters = ${seekAllAdaptersInBrowser.toString()};`);
}

// Launch headless Chrome, load the composition sized to its canvas, wait for the
// timelines + fonts to be ready. Returns the browser (caller closes it), page, size.
async function openCompositionPage(
  url: string,
  executablePath: string,
): Promise<{
  browser: import("puppeteer-core").Browser;
  page: import("puppeteer-core").Page;
  size: FrameSize;
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
  await installSeekHelper(page);
  return { browser, page, size };
}

// Longest seekable duration (seconds) across registered timelines, player/root
// duration, CSS/WAAPI animations, and Anime.js instances.
function timelineDuration(page: import("puppeteer-core").Page): Promise<number> {
  return page.evaluate(() => {
    const finiteSeconds = (value: unknown): number => {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const finiteMsToSeconds = (value: unknown): number => {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) && n > 0 ? n / 1000 : 0;
    };
    const w = window as unknown as {
      __player?: { getDuration?: () => number };
      __timelines?: Record<string, { duration?: () => number; totalDuration?: () => number }>;
      __hfAnime?: Array<{ duration?: number | string; totalDuration?: number | string }>;
    };

    const timelinesDuration = (): number => {
      let d = 0;
      for (const tl of Object.values(w.__timelines ?? {})) {
        try {
          d = Math.max(d, (tl.totalDuration?.() ?? tl.duration?.() ?? 0) as number);
        } catch {
          // skip
        }
      }
      return d;
    };

    const animationDurationSeconds = (animation: Animation): number => {
      const timing = animation.effect?.getTiming?.();
      if (!timing) return 0;
      const durationMs = Number(timing.duration);
      const iterations = Number(timing.iterations ?? 1);
      if (!Number.isFinite(durationMs) || !Number.isFinite(iterations)) return 0;
      const delayMs = Number(timing.delay ?? 0);
      const endDelayMs = Number(timing.endDelay ?? 0);
      return finiteMsToSeconds(Math.max(0, delayMs) + durationMs * iterations + endDelayMs);
    };

    const waapiDuration = (): number => {
      if (typeof document.getAnimations !== "function") return 0;
      let d = 0;
      try {
        for (const animation of document.getAnimations()) {
          d = Math.max(d, animationDurationSeconds(animation));
        }
      } catch {
        // skip
      }
      return d;
    };

    const animeDuration = (): number => {
      let d = 0;
      for (const instance of w.__hfAnime ?? []) {
        d = Math.max(d, finiteMsToSeconds(instance.totalDuration ?? instance.duration));
      }
      return d;
    };

    let d = finiteSeconds(w.__player?.getDuration?.());
    const root = document.querySelector("[data-composition-id][data-duration]");
    if (root) d = Math.max(d, finiteSeconds(root.getAttribute("data-duration")));
    return Math.max(d, timelinesDuration(), waapiDuration(), animeDuration());
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

// --selector scope: the focused element is often a STATIC wrapper (`.clip`)
// whose animated children carry the tweens. Resolve, in the live DOM, to the
// scope itself if it animates, else its animated descendants — so the shot
// works on the standard composition shape instead of erroring.
async function resolveScopedRequests(
  page: import("puppeteer-core").Page,
  requests: ShotRequest[],
  scopeSelector: string,
): Promise<ShotRequest[]> {
  const resolved = await resolveScopeInBrowser(
    page,
    scopeSelector,
    requests.map((r) => r.selector),
  );
  if (!resolved.scopeExists) {
    throw new Error(`--shot: --selector '${scopeSelector}' matched no element.`);
  }
  if (resolved.selectors.length === 0) {
    const nearest = requests
      .slice(0, 5)
      .map((r) => r.selector)
      .join(", ");
    throw new Error(
      `--shot: nothing animates under '${scopeSelector}'. Nearest animated elements: ${nearest || "(none)"}.`,
    );
  }
  return resolved.selectors.map((selector) => ({ selector }));
}

// In-tick capture: seek the timeline (fires the composition's onUpdate render
// synchronously via the shared window.__hfSeekAllAdapters) + nudge the
// three-adapter, then drawImage every <canvas> onto an offscreen canvas in the
// SAME tick — before the browser clears the GL drawing buffer (works without
// preserveDrawingBuffer; page.screenshot can't see the GL buffer here).
function captureGhostFrame(page: import("puppeteer-core").Page, t: number): Promise<string> {
  return page.evaluate((tt: number) => {
    (window as unknown as { __hfSeekAllAdapters?: (time: number) => void }).__hfSeekAllAdapters?.(
      tt,
    );
    const root = (document.querySelector("[data-composition-id]") ?? document.body) as HTMLElement;
    const rb = root.getBoundingClientRect();
    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.round(rb.width));
    off.height = Math.max(1, Math.round(rb.height));
    const octx = off.getContext("2d");
    for (const cv of Array.from(document.querySelectorAll("canvas"))) {
      const r = cv.getBoundingClientRect();
      try {
        octx?.drawImage(cv, r.left - rb.left, r.top - rb.top, r.width, r.height);
      } catch {
        /* tainted / not ready — skip */
      }
    }
    return off.toDataURL("image/png");
  }, t);
}

// Shared by both onion-skin modes: rotate the composition to the requested
// orbit angle (a no-op at the front angle), and format that angle for the
// frame's caption label.
async function applyOrbitCameraIfAngled(
  page: import("puppeteer-core").Page,
  requests: ShotRequest[],
  camera: OrbitCamera,
): Promise<void> {
  if (camera.yaw === 0 && camera.pitch === 0) return;
  await page.evaluate(
    applyOrbitCamera,
    requests.map((r) => r.selector),
    camera,
  );
}

function cameraLabel(camera: OrbitCamera): string {
  return camera.yaw === 0 && camera.pitch === 0
    ? "front"
    : `yaw ${camera.yaw}° pitch ${camera.pitch}°`;
}

// Rendered ("ghost") onion-skin: screenshot the REAL painted stage at each
// sample and composite them as translucent ghosts. This is the onion-skin for
// canvas/WebGL motion the marker sampler is blind to (the markers project a
// bbox; the pixels are the motion). Works for any visual composition, but
// requires a <canvas> (DOM/SVG transform motion already shows up in the
// default marker onion).
async function captureGhostOnionSkin(
  page: import("puppeteer-core").Page,
  requests: ShotRequest[],
  times: number[],
  size: FrameSize,
  camera: OrbitCamera,
  outPath: string,
): Promise<string> {
  await applyOrbitCameraIfAngled(page, requests, camera);
  const hasCanvas = await page.evaluate(() => document.querySelectorAll("canvas").length > 0);
  if (!hasCanvas) {
    throw new Error(
      "--ghost renders a canvas/WebGL motion trail, but this composition has no <canvas>. Use the default --shot onion for DOM/SVG transform motion.",
    );
  }
  const frames: string[] = [];
  for (const t of times) {
    frames.push(await captureGhostFrame(page, t));
  }
  const label = `${cameraLabel(camera)}  ·  rendered onion  ·  ${times.length} frames  ·  t ${times[0]}–${times[times.length - 1]}s`;
  const dataUrl = (await page.evaluate(
    compositeGhostFrames,
    frames,
    ghostAlphas(frames.length),
    size.width,
    size.height,
    label,
  )) as string;
  const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, "");
  if (!b64) throw new Error("ghost composite returned no data");
  writeFileSync(outPath, Buffer.from(b64, "base64"));
  return outPath;
}

// Default (marker) onion-skin: seek to each sample time, read every element's
// projected corners. Marker children (zero-size) inherit the element's full
// transform chain, so their screen positions ARE the 3D projection of each
// corner — this is how 3D comes "for free" without an #stage assumption.
async function captureMarkerOnionSkin(
  page: import("puppeteer-core").Page,
  requests: ShotRequest[],
  times: number[],
  size: FrameSize,
  camera: OrbitCamera,
  frame: { layout: "path" | "strip"; fit: boolean; hasWindow: boolean },
  outPath: string,
): Promise<string> {
  // Orbit camera as its own step (keeps the sampler simple), only when angled.
  await applyOrbitCameraIfAngled(page, requests, camera);

  const elements = (await page.evaluate(
    (selectors: string[], ts: number[]) => {
      const seek = (window as unknown as { __hfSeekAllAdapters?: (t: number) => void })
        .__hfSeekAllAdapters;

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
        seek?.(t);
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

  const windowStr = frame.hasWindow ? `  ·  t ${times[0]}–${times[times.length - 1]}s` : "";
  const label = `${cameraLabel(camera)}  ·  ${frame.layout === "strip" ? "filmstrip" : frame.fit ? "zoom-fit" : "1:1"}  ·  ${times.length} frames${windowStr}`;
  const svg = buildOnionSvg(elements, {
    layout: frame.layout,
    fit: frame.fit,
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

    if (opts.scopeSelector && !opts.ghost) {
      requests = await resolveScopedRequests(page, requests, opts.scopeSelector);
    }

    const times = sampleTimes(
      await timelineDuration(page),
      samples,
      opts.from ?? null,
      opts.to ?? null,
    );

    if (opts.ghost) {
      return await captureGhostOnionSkin(page, requests, times, size, camera, outPath);
    }

    return await captureMarkerOnionSkin(
      page,
      requests,
      times,
      size,
      camera,
      { layout, fit, hasWindow: opts.from != null || opts.to != null },
      outPath,
    );
  } finally {
    await browserInstance?.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
