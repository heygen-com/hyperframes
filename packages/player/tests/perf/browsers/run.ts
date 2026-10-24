#!/usr/bin/env bun
// Heavy-film bench for real Safari and Chrome over plain WebDriver; both run bench-page.js on one machine.
// Needs safaridriver (`sudo safaridriver --enable`) or chromedriver, and the media from make-media.sh.
// bun run tests/perf/browsers/run.ts --browsers safari,chrome --runs 2 [--fixtures a,b]
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { percentile } from "../runner.ts";
import { bench } from "./bench-page.js";
import { startServer } from "../server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(HERE, "../results");
const PLAY_MS = 8_000;
const SEEK_FRACTIONS = [0.1, 0.7, 0.2, 0.8, 0.3, 0.9, 0.4, 0.6, 0.5, 0.05];
const WORK_BUDGET_MS = 8;

type Browser = "safari" | "chrome";

const DRIVERS: Record<
  Browser,
  { cmd: string; args: (port: number) => string[]; caps: object; procs: RegExp }
> = {
  safari: {
    cmd: "safaridriver",
    args: (port) => ["-p", String(port)],
    caps: { browserName: "safari" },
    procs: /\/(?:com\.apple\.WebKit\.\w+|Safari)$/,
  },
  chrome: {
    cmd: process.env.CHROMEDRIVER ?? "chromedriver",
    args: (port) => [`--port=${port}`],
    caps: {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: [
          "--autoplay-policy=no-user-gesture-required",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-background-timer-throttling",
        ],
      },
    },
    procs: /Google Chrome|Chromium/,
  },
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function wd(base: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as { value: any };
  if (!res.ok || json.value?.error) {
    throw new Error(`${method} ${path}: ${JSON.stringify(json.value).slice(0, 600)}`);
  }
  return json.value;
}

async function startDriver(browser: Browser, port: number): Promise<ChildProcess> {
  const spec = DRIVERS[browser];
  const proc = spawn(spec.cmd, spec.args(port), { stdio: "inherit" });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((await wd(`http://127.0.0.1:${port}`, "GET", "/status")).ready) return proc;
    } catch {}
    await Bun.sleep(200);
  }
  proc.kill();
  throw new Error(`${spec.cmd} did not become ready on port ${port}`);
}

/** Resident memory of the browser's own processes, in MB (WebDriver has no memory API Safari answers). */
function browserRssMb(procs: RegExp): number {
  const out = execFileSync("ps", ["-axo", "rss=,comm="], { encoding: "utf-8" });
  let kb = 0;
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (m && procs.test(m[2]!) && !/driver/i.test(m[2]!)) kb += Number(m[1]);
  }
  return kb / 1024;
}

type PageResult = {
  userAgent: string;
  devicePixelRatio: number;
  videoCount: number;
  mediaErrors: string[];
  idle: number[];
  frames: Array<{ ts: number; work: number | null; script: number | null; comp: number }>;
  decoded: { dropped: number; total: number };
  droppedTimeline: number[];
  videoStates: Array<Record<string, unknown>>;
  mediaOps: Record<"seek" | "rate" | "play" | "pause" | "load", number>;
  seeks: Array<{ target: number; ms: number; timedOut: boolean }>;
};

// Only finite numbers and explicit booleans from the browser reach disk; strings it reports go to the log.
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;

function pageDetail(page: PageResult) {
  return {
    videos: num(page.videoCount),
    mediaErrorCount: num(page.mediaErrors.length),
    droppedTimeline: page.droppedTimeline.map(num),
    mediaOps: {
      seek: num(page.mediaOps.seek),
      rate: num(page.mediaOps.rate),
      play: num(page.mediaOps.play),
      pause: num(page.mediaOps.pause),
      load: num(page.mediaOps.load),
    },
    videoStates: page.videoStates.map((v) => ({
      readyState: num(v.readyState),
      networkState: num(v.networkState),
      paused: v.paused === true,
      advanced: num(v.advanced),
      bufferedEnd: num(v.bufferedEnd),
      shown: v.shown === true,
    })),
    seeks: page.seeks.map((x) => ({
      target: num(x.target),
      ms: num(x.ms),
      timedOut: x.timedOut === true,
    })),
  };
}

function score(page: PageResult) {
  const idleIntervals = page.idle.slice(1).map((t, i) => t - page.idle[i]!);
  const vsync = percentile(idleIntervals, 50);
  const intervals = page.frames.slice(1).map((f, i) => f.ts - page.frames[i]!.ts);
  const dropped = intervals.reduce(
    (n, d) => n + (d > vsync * 1.5 ? Math.round(d / vsync) - 1 : 0),
    0,
  );
  const work = page.frames.map((f) => f.work).filter((w): w is number => w !== null);
  const first = page.frames[0]!;
  const last = page.frames[page.frames.length - 1]!;
  const seekMs = page.seeks.map((s) => s.ms);
  const round = (n: number) => num(Math.round(n * 10) / 10);
  return {
    vsyncMs: round(vsync),
    frames: num(page.frames.length),
    droppedFrames: num(dropped),
    longestFrameMs: round(Math.max(...intervals)),
    p95FrameMs: round(percentile(intervals, 95)),
    maxWorkMs: round(Math.max(...work)),
    p95WorkMs: round(percentile(work, 95)),
    framesOverBudget: num(work.filter((w) => w > WORK_BUDGET_MS).length),
    p95ScriptMs: round(
      percentile(
        page.frames.map((f) => f.script ?? 0),
        95,
      ),
    ),
    clockRatio: num(
      Math.round((((last.comp - first.comp) * 1000) / (last.ts - first.ts)) * 1000) / 1000,
    ),
    decoderDropped: num(page.decoded.dropped),
    decoderFrames: num(page.decoded.total),
    mediaSeeks: num(page.mediaOps.seek),
    rateWrites: num(page.mediaOps.rate),
    presentedFps: page.videoCount
      ? round((page.decoded.total - page.decoded.dropped) / page.videoCount / (PLAY_MS / 1000))
      : null,
    seekP50Ms: round(percentile(seekMs, 50)),
    seekP95Ms: round(percentile(seekMs, 95)),
    seekTimeouts: num(page.seeks.filter((s) => s.timedOut === true).length),
  };
}

// The same media played natively, without the player: separates browser decoder drops from runtime-caused ones.
const CONTROLS = [
  { name: "grid-sample", media: "grid-sample", n: 10, rate: 1 },
  { name: "grid-sample-rate-1.03", media: "grid-sample", n: 10, rate: 1.03 },
  {
    name: "grid-sample-tick",
    media: "grid-sample",
    n: 10,
    rate: 1,
    extra: "&tick=1",
  },
  {
    name: "grid-sample-animate",
    media: "grid-sample",
    n: 10,
    rate: 1,
    extra: "&animate=scale",
  },
  {
    name: "grid-sample-translate",
    media: "grid-sample",
    n: 10,
    rate: 1,
    extra: "&animate=translate",
  },
  {
    name: "grid-sample-css",
    media: "grid-sample",
    n: 10,
    rate: 1,
    extra: "&animate=css",
  },
  { name: "16x1080", media: "h264-1080", n: 16, rate: 1 },
  { name: "alpha-webm", media: "alpha-vp9", n: 6, rate: 1 },
];

// Opens a page and returns the value it publishes on window[global] once it has one.
async function readPage<T>(
  base: string,
  browser: Browser,
  url: string,
  global: string,
): Promise<T> {
  const session = await wd(base, "POST", "/session", {
    capabilities: { alwaysMatch: DRIVERS[browser].caps },
  });
  const s = `/session/${session.sessionId}`;
  try {
    await wd(base, "POST", `${s}/url`, { url });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const r = await wd(base, "POST", `${s}/execute/sync`, {
        script: `return window.${global}`,
        args: [],
      });
      if (r?.error) throw new Error(r.error);
      if (r) return r as T;
      await Bun.sleep(500);
    }
    throw new Error(`${url} did not publish ${global} within 60 s`);
  } finally {
    await wd(base, "DELETE", s).catch(() => {});
  }
}

async function runFilm(base: string, browser: Browser, origin: string, fixture: string) {
  const session = await wd(base, "POST", "/session", {
    capabilities: { alwaysMatch: DRIVERS[browser].caps },
  });
  const s = `/session/${session.sessionId}`;
  let peakRssMb = 0;
  try {
    await wd(base, "POST", `${s}/window/rect`, { x: 0, y: 0, width: 1024, height: 768 });
    await wd(base, "POST", `${s}/url`, {
      url: `${origin}/host.html?fixture=${fixture}&width=960&height=540`,
    });
    await wd(base, "POST", `${s}/execute/sync`, {
      script: `window.__hfBench = ${bench.toString()};
        window.__bench = null;
        window.__hfBench(arguments[0]).then(
        (r) => { window.__bench = { ok: r }; },
        (e) => { window.__bench = { error: String(e && e.stack || e) }; });`,
      args: [{ playMs: PLAY_MS, seekFractions: SEEK_FRACTIONS }],
    });
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      peakRssMb = Math.max(peakRssMb, browserRssMb(DRIVERS[browser].procs));
      const r = await wd(base, "POST", `${s}/execute/sync`, {
        script: "return window.__bench",
        args: [],
      });
      if (r?.error) throw new Error(r.error);
      if (r?.ok) return { page: r.ok as PageResult, peakRssMb: Math.round(peakRssMb) };
      await Bun.sleep(500);
    }
    throw new Error("bench did not finish within 180 s");
  } finally {
    await wd(base, "DELETE", s).catch(() => {});
  }
}

const browsers = arg("browsers", "safari,chrome").split(",") as Browser[];
const runs = Number(arg("runs", "2"));
const fixtures = arg(
  "fixtures",
  readdirSync(resolve(HERE, "../fixtures"))
    .filter((f) => f.startsWith("heavy-") || f === "10-video-grid" || f === "gsap-heavy")
    .join(","),
).split(",");

mkdirSync(RESULTS_DIR, { recursive: true });
const server = startServer();
const rows: Array<Record<string, unknown>> = [];
let failed = false;
try {
  for (const browser of browsers) {
    const port = 4444 + browsers.indexOf(browser);
    const driver = await startDriver(browser, port);
    try {
      try {
        const box = await readPage<{
          cases: Array<{ name: string; width: number; height: number; ok: boolean }>;
          ratioHeightOnlyWidth: number;
        }>(
          `http://127.0.0.1:${port}`,
          browser,
          `${server.origin}/fixtures/_control/player-box.html`,
          "__box",
        );
        const wrong = box.cases.filter((c) => !c.ok);
        console.log(
          `[browsers] ${browser} aspect-ratio block with only a height: ${box.ratioHeightOnlyWidth}px wide`,
        );
        for (const c of box.cases)
          console.log(`[browsers] ${browser} player box ${c.name}: ${c.width}x${c.height}`);
        if (wrong.length) throw new Error(`${wrong.length} embeds got the wrong box`);
        rows.push({ browser, fixture: "player-box", run: 1 });
      } catch (e) {
        failed = true;
        rows.push({ browser, fixture: "player-box", run: 1, error: "failed, see the job log" });
        console.error(`[browsers] ${browser} player box failed: ${e}`);
      }
      for (const fixture of fixtures) {
        for (let run = 1; run <= runs; run++) {
          try {
            const { page, peakRssMb } = await runFilm(
              `http://127.0.0.1:${port}`,
              browser,
              server.origin,
              fixture,
            );
            const row = {
              browser,
              fixture,
              run,
              ...score(page),
              peakRssMb,
              detail: pageDetail(page),
            };
            rows.push(row);
            console.log(JSON.stringify({ ...row, detail: undefined }));
            console.log(
              `[browsers] ${browser} ${page.userAgent}; media errors: ${page.mediaErrors.join(", ") || "none"}`,
            );
          } catch (e) {
            failed = true;
            rows.push({ browser, fixture, run, error: "failed, see the job log" });
            console.error(`[browsers] ${browser} ${fixture} run ${run} failed: ${e}`);
          }
        }
      }
      for (const c of CONTROLS) {
        try {
          const r = await readPage<{ dropped: number; total: number; presentedFps: number }>(
            `http://127.0.0.1:${port}`,
            browser,
            `${server.origin}/fixtures/_control/index.html?media=${c.media}&n=${c.n}&rate=${c.rate}${c.extra ?? ""}`,
            "__control",
          );
          rows.push({
            browser,
            fixture: `control:${c.name}`,
            run: 1,
            decoderDropped: num(r.dropped),
            presentedFps: num(r.presentedFps),
            decoderFrames: num(r.total),
          });
          console.log(JSON.stringify(rows[rows.length - 1]));
        } catch (e) {
          rows.push({
            browser,
            fixture: `control:${c.name}`,
            run: 1,
            error: "failed, see the job log",
          });
          console.error(`[browsers] ${browser} control ${c.name} failed: ${e}`);
        }
      }
    } finally {
      driver.kill();
    }
  }
} finally {
  await server.stop();
}

writeFileSync(resolve(RESULTS_DIR, "browsers.json"), JSON.stringify(rows, null, 2) + "\n");
const cols = [
  "browser",
  "fixture",
  "run",
  "droppedFrames",
  "longestFrameMs",
  "p95FrameMs",
  "maxWorkMs",
  "p95WorkMs",
  "framesOverBudget",
  "p95ScriptMs",
  "clockRatio",
  "decoderDropped",
  "decoderFrames",
  "presentedFps",
  "mediaSeeks",
  "rateWrites",
  "seekP50Ms",
  "seekP95Ms",
  "seekTimeouts",
  "peakRssMb",
  "error",
];
const md = [
  `| ${cols.join(" | ")} |`,
  `|${cols.map(() => "---").join("|")}|`,
  ...rows.map(
    (r) =>
      `| ${cols.map((c) => (r[c] === undefined ? "" : String(r[c]).slice(0, 80))).join(" | ")} |`,
  ),
].join("\n");
writeFileSync(resolve(RESULTS_DIR, "browsers.md"), md + "\n");
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Heavy films: ${browsers.join(" vs ")}\n\n${md}\n`,
  );
process.exit(failed ? 1 : 0);
