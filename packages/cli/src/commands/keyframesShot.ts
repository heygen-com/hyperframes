// Screenshot a composition's element with its keyframe motion-path overlaid, so
// an agent can SELF-VERIFY the path visually (ground truth) alongside the ASCII
// surface. Reuses the headless-Chrome + static-server pattern from layout.ts.
//
// One frame, not a video: the full path is drawn as a static per-stroke overlay
// in the element's own x/y-offset space (home center + offset), the timeline is
// seeked to the end so the element sits at its final pose, then screenshotted.

import { writeFileSync } from "node:fs";

export interface ShotStroke {
  points: Array<{ x: number; y: number }>;
}
export interface ShotRequest {
  /** CSS selector of the moving element to overlay (e.g. "#dot"). */
  selector: string;
  /** Ordered strokes (multi-stroke trace) or a single path as one stroke. */
  strokes: ShotStroke[];
}

const STROKE_COLORS = [
  "#5eead4",
  "#fbbf24",
  "#f472b6",
  "#60a5fa",
  "#a3e635",
  "#fb923c",
  "#e879f9",
  "#34d399",
  "#f87171",
  "#a78bfa",
  "#22d3ee",
  "#facc15",
  "#4ade80",
  "#fb7185",
  "#c084fc",
  "#2dd4bf",
  "#38bdf8",
  "#fde047",
];

/** Render `projectDir`'s index headless, overlay each request's motion path on
 *  its element, screenshot to `outPath` (PNG). Returns the saved path. */
export async function captureMotionPathShot(
  projectDir: string,
  requests: ShotRequest[],
  outPath: string,
): Promise<string> {
  const { ensureBrowser } = await import("../browser/manager.js");
  const { serveStaticProjectHtml } = await import("../utils/staticProjectServer.js");
  const puppeteer = await import("puppeteer-core");
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");

  const html = await bundleToSingleHtml(projectDir);
  const server = await serveStaticProjectHtml(
    projectDir,
    html,
    "Failed to bind keyframes shot server",
  );
  let browserInstance: import("puppeteer-core").Browser | undefined;
  try {
    const browser = await ensureBrowser();
    browserInstance = await puppeteer.default.launch({
      headless: true,
      executablePath: browser.executablePath,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
      ],
    });
    const page = await browserInstance.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: 10000 });

    // Size the viewport to the composition.
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
    await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page
      .waitForFunction(() => !!(window as unknown as { __timelines?: unknown }).__timelines, {
        timeout: 10000,
      })
      .catch(() => {});
    try {
      await page.evaluate(async () => {
        const d = document as unknown as { fonts?: { ready?: Promise<unknown> } };
        if (d.fonts?.ready) await d.fonts.ready;
      });
    } catch {
      // fonts API not present — proceed
    }

    // Seek to the END of the timeline so the element rests at its final pose.
    await page.evaluate(() => {
      const seekEnd = (tl: {
        duration?: () => number;
        totalDuration?: () => number;
        pause?: () => void;
        seek?: (t: number) => void;
        progress?: (p: number) => void;
      }) => {
        try {
          tl.pause?.();
          const d = (tl.totalDuration?.() ?? tl.duration?.() ?? 0) as number;
          if (typeof tl.seek === "function") tl.seek(Math.max(0, d - 0.001));
          else tl.progress?.(0.999);
        } catch {
          // best-effort
        }
      };
      const win = window as unknown as {
        __timelines?: Record<string, Parameters<typeof seekEnd>[0]>;
      };
      Object.values(win.__timelines ?? {}).forEach(seekEnd);
    });
    await new Promise((r) => setTimeout(r, 120));

    // Draw the motion-path overlay for each request, in the element's own x/y
    // offset space: home = element's layout center at translate(0,0), so a path
    // point P maps to (home.x + P.x, home.y + P.y) in page pixels.
    await page.evaluate(
      (reqs: ShotRequest[], palette: string[]) => {
        const NS = "http://www.w3.org/2000/svg";
        const mk = (tag: string, attrs: Record<string, string>) => {
          const node = document.createElementNS(NS, tag);
          for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
          return node;
        };
        const svg = mk("svg", {
          style:
            "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647",
          viewBox: `0 0 ${window.innerWidth} ${window.innerHeight}`,
        });
        const defs = mk("defs", {});
        defs.innerHTML = `<filter id="kfglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>`;
        svg.appendChild(defs);
        const line = (pts: string, col: string, w: number, o: number, glow: boolean) =>
          svg.appendChild(
            mk("polyline", {
              points: pts,
              fill: "none",
              stroke: col,
              "stroke-width": String(w),
              "stroke-linejoin": "round",
              "stroke-linecap": "round",
              opacity: String(o),
              ...(glow ? { filter: "url(#kfglow)" } : {}),
            }),
          );
        const dot = (x: number, y: number, fill: string) =>
          svg.appendChild(mk("circle", { cx: String(x), cy: String(y), r: "7", fill }));

        // home = element layout center at translate(0,0); path point P → home + P.
        const home = (sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return null;
          const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2 - m.m41, y: r.top + r.height / 2 - m.m42 };
        };

        let colorIdx = 0;
        const drawReq = (req: ShotRequest) => {
          const h = home(req.selector);
          if (!h) return;
          for (const stroke of req.strokes) {
            const col = palette[colorIdx % palette.length] ?? "#5eead4";
            colorIdx++;
            const pts = stroke.points.map((p) => `${h.x + p.x},${h.y + p.y}`).join(" ");
            if (stroke.points.length >= 2) {
              line(pts, col, 16, 0.25, true); // soft glow
              line(pts, col, 6, 0.95, false); // crisp core
            }
            const first = stroke.points[0];
            const last = stroke.points[stroke.points.length - 1];
            if (first) dot(h.x + first.x, h.y + first.y, "#22c55e"); // start
            if (last && stroke.points.length > 1) dot(h.x + last.x, h.y + last.y, "#ef4444"); // end
          }
        };
        reqs.forEach(drawReq);
        document.body.appendChild(svg);
      },
      requests,
      STROKE_COLORS,
    );
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
