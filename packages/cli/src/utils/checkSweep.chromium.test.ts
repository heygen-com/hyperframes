// Real-Chromium pins for sweep_static and keepsMoving: paint the DOM signature cannot read must still count as motion.
// Skipped without a local Chrome; opt-in on Windows (HYPERFRAMES_BROWSER_TESTS=1), like the other Chromium suites.
import { existsSync } from "node:fs";
import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findSystemBrowser } from "../browser/manager.js";
import { createPageDriver } from "./checkBrowser.js";
import { DEFAULT_CHECK_OPTIONS, runAuditGrid } from "./checkPipeline.js";
import type { MotionSpecResolution } from "./checkTypes.js";
import type { MotionAssertion } from "./motionSpec.js";

function resolveExecutable(): string | undefined {
  for (const name of ["HYPERFRAMES_BROWSER_PATH", "PUPPETEER_EXECUTABLE_PATH"]) {
    const candidate = process.env[name];
    if (candidate && existsSync(candidate)) return candidate;
  }
  return findSystemBrowser()?.executablePath;
}

const executablePath = resolveExecutable();
const RUNS_CHROMIUM =
  !!executablePath &&
  (process.platform !== "win32" || process.env.HYPERFRAMES_BROWSER_TESTS === "1");
const BROWSER_LAUNCH_TIMEOUT_MS = 120_000;

// A 6 s film whose only motion is what `draw(t)` paints; `window.__hf` is the seek target check drives.
function film(body: string, draw: string): string {
  return `<!doctype html><html><head><style>
    html, body { margin: 0; width: 640px; height: 360px; overflow: hidden; background: #0a0a0a; }
  </style></head><body>
    <div id="root" data-composition-id="main" data-duration="6" data-width="640" data-height="360">${body}</div>
    <script>
      const draw = (t) => { ${draw} };
      window.__hf = { duration: 6, seek: draw };
      draw(0);
    </script>
  </body></html>`;
}

const MOVING_FILMS: [string, string][] = [
  [
    "an SVG mask whose circle radius grows",
    film(
      `<svg width="640" height="360"><defs><mask id="m"><rect width="640" height="360" fill="black"/>
        <circle id="hole" cx="320" cy="180" r="0" fill="white"/></mask></defs>
        <rect width="640" height="360" fill="#ff5a1f" mask="url(#m)"/></svg>`,
      `document.getElementById("hole").setAttribute("r", String(t * 60));`,
    ),
  ],
  [
    "a stroke-dashoffset line reveal",
    film(
      `<svg width="640" height="360"><path id="line" d="M40 180 C 200 20, 440 340, 600 180"
        stroke="#fff" stroke-width="4" fill="none" stroke-dasharray="800" stroke-dashoffset="800"/></svg>`,
      `document.getElementById("line").setAttribute("stroke-dashoffset", String(800 - t * 130));`,
    ),
  ],
  [
    "a thin line drawn on a 2D canvas",
    film(
      `<canvas id="c" width="640" height="360"></canvas>`,
      `const ctx = document.getElementById("c").getContext("2d");
       ctx.clearRect(0, 0, 640, 360); ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 1; ctx.beginPath();
       ctx.moveTo(40, 180); ctx.lineTo(40 + t * 90, 180 - t * 20); ctx.stroke();`,
    ),
  ],
  [
    "a WebGL canvas whose clear color fades",
    film(
      `<canvas id="c" width="640" height="360"></canvas>`,
      `const gl = document.getElementById("c").getContext("webgl");
       gl.clearColor(t / 6, 0.2, 0.4, 1); gl.clear(gl.COLOR_BUFFER_BIT);`,
    ),
  ],
];

const STILL_FILM = film(
  `<h1 style="margin: 0; padding: 140px 0 0 200px; color: #fff; font: 600 48px sans-serif">Still</h1>`,
  "",
);

describe.skipIf(!RUNS_CHROMIUM)("frozen-sweep guard in Chromium", () => {
  let browser: Browser;

  beforeAll(async () => {
    const puppeteer = await import("puppeteer-core");
    browser = await puppeteer.default.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
  }, BROWSER_LAUNCH_TIMEOUT_MS);

  afterAll(async () => {
    await browser?.close();
  });

  // A page per film: setContent keeps the window, so one film's globals would leak into the next.
  async function onPage<T>(html: string, run: (page: Page) => Promise<T>): Promise<T> {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });
    await page.setContent(html);
    return run(page).finally(() => page.close());
  }

  async function findings(html: string, assertions: MotionAssertion[] = []) {
    const motion: MotionSpecResolution =
      assertions.length > 0
        ? { kind: "valid", path: "index.motion.json", spec: { assertions } }
        : { kind: "none" };
    const result = await onPage(html, (page) =>
      runAuditGrid(createPageDriver(page), { ...DEFAULT_CHECK_OPTIONS, contrast: false }, motion),
    );
    const messages = (issues: { code: string; message: string }[], code: string) =>
      issues.filter((issue) => issue.code === code).map((issue) => issue.message);
    return {
      sweep: messages(result.layoutIssues, "sweep_static"),
      frozen: messages(result.motionIssues, "motion_frozen"),
    };
  }

  it.each(MOVING_FILMS)("does not call %s static", async (_, html) => {
    expect((await findings(html)).sweep).toEqual([]);
  });

  it.each(MOVING_FILMS)("does not call %s frozen under keepsMoving", async (_, html) => {
    const result = await findings(html, [
      { kind: "keepsMoving" },
      { kind: "keepsMoving", withinSelector: "#root > :first-child" },
    ]);
    expect(result.frozen).toEqual([]);
  });

  it("still warns on, and keepsMoving still fails, a film where nothing on screen moves", async () => {
    const result = await findings(STILL_FILM, [{ kind: "keepsMoving" }]);
    // The last END_CARD_HOLD_SEC (3-6 s) may hold still, so the frozen span ends where it starts.
    expect(result.frozen).toEqual([expect.stringContaining("nothing moves between 0s and 3s")]);
    // A motion_frozen finding already names the symptom, so the sweep guard stays quiet.
    expect(result.sweep).toEqual([]);
    expect((await findings(STILL_FILM)).sweep).toEqual(["Nothing on screen moved under seek."]);
  });

  it("keeps a still title frozen under keepsMoving while the background behind it moves", async () => {
    const html = film(
      `<div id="bg" style="position: absolute; inset: 0; background: linear-gradient(90deg, #f40, #04f)"></div>
       <h1 id="title" style="position: absolute; left: 120px; top: 120px; margin: 0; padding: 40px;
         color: #fff; font: 600 48px sans-serif">Still</h1>`,
      `document.getElementById("bg").style.backgroundPosition = (t * 100) + "px 0";`,
    );
    const result = await findings(html, [{ kind: "keepsMoving", withinSelector: "#title" }]);
    expect(result.frozen).toEqual([expect.stringContaining("nothing moves within #title")]);
  });

  it("keeps a still title frozen under keepsMoving while the page's root background changes", async () => {
    const html = film(
      `<h1 id="title" style="position: absolute; left: 120px; top: 120px; margin: 0; padding: 40px;
         color: #fff; font: 600 48px sans-serif">Still</h1>`,
      `document.documentElement.style.background = "rgb(" + Math.round(t * 40) + ", 0, 80)";`,
    );
    const result = await findings(html, [{ kind: "keepsMoving", withinSelector: "#title" }]);
    expect(result.frozen).toEqual([expect.stringContaining("nothing moves within #title")]);
  });

  it("sees dark paint revealed inside a scope, where only its alpha tells it from the cleared page", async () => {
    const html = film(
      `<svg id="scene" width="640" height="360"><defs><mask id="dark"><rect width="640" height="360" fill="black"/>
        <circle id="hole" cx="320" cy="180" r="0" fill="white"/></mask></defs>
        <rect width="640" height="360" fill="#000" mask="url(#dark)"/></svg>`,
      `document.getElementById("hole").setAttribute("r", String(t * 60));`,
    );
    const result = await findings(html, [{ kind: "keepsMoving", withinSelector: "#scene" }]);
    expect(result.frozen).toEqual([]);
  });

  it("still warns on a canvas that animates by the wall clock, not by the seek", async () => {
    const html = film(
      `<canvas id="c" width="640" height="360"></canvas>
       <script>
         const loop = () => {
           const ctx = document.getElementById("c").getContext("2d");
           ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 640, 360);
           ctx.fillStyle = "#fff"; ctx.fillRect((performance.now() / 4) % 600, 160, 40, 40);
           requestAnimationFrame(loop);
         };
         loop();
       </script>`,
      "",
    );
    expect((await findings(html)).sweep).toEqual(["Nothing on screen moved under seek."]);
  });

  it("reads a still film's frames as unchanged across 10 seeks", async () => {
    const verdicts = await onPage(STILL_FILM, async (page) => {
      const driver = createPageDriver(page);
      await driver.initialize(false);
      const frames: string[] = [];
      for (let seek = 0; seek < 10; seek++) {
        await driver.seek(seek * 0.6, true);
        frames.push(await driver.captureFrame());
      }
      return Promise.all(frames.map((frame) => driver.framesDiffer(frames[0] ?? "", frame)));
    });
    expect(verdicts).toEqual(Array(10).fill(false));
  });

  it.each([
    ["one changed pixel as render noise", 1, false],
    ["a 5x5 square as motion", 5, true],
  ])("reads %s", async (_, size, moved) => {
    const html = film(
      `<canvas id="c" width="640" height="360"></canvas>`,
      `const ctx = document.getElementById("c").getContext("2d");
       ctx.clearRect(0, 0, 640, 360); if (t > 0) { ctx.fillStyle = "#fff"; ctx.fillRect(100, 100, ${size}, ${size}); }`,
    );
    const differ = await onPage(html, async (page) => {
      const driver = createPageDriver(page);
      await driver.initialize(false);
      await driver.seek(0, true);
      const before = await driver.captureFrame();
      await driver.seek(3, true);
      return driver.framesDiffer(before, await driver.captureFrame());
    });
    expect(differ).toBe(moved);
  });
});
