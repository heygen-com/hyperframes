#!/usr/bin/env bun
// Heavy-film bench for real Safari and Chrome over plain WebDriver; both run bench-page.js on one machine.
// Needs safaridriver (`sudo safaridriver --enable`) or chromedriver, and the media from make-media.sh.
// bun run tests/perf/browsers/run.ts --browsers safari,chrome --runs 2 [--fixtures a,b]
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { percentile } from "../runner.ts";
import { bench } from "./bench-page.js";
import { startServer } from "../server.ts";
import { DRIVERS, startDriver, wd, type Browser } from "./webdriver.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(HERE, "../results");
const PLAY_MS = 8_000;
const SEEK_FRACTIONS = [0.1, 0.7, 0.2, 0.8, 0.3, 0.9, 0.4, 0.6, 0.5, 0.05];
const WORK_BUDGET_MS = 8;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
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
  mediaReads: Partial<Record<(typeof MEDIA_READS)[number], number>>;
  audioCaptures: number;
};

// Only finite numbers and explicit booleans from the browser reach disk; strings it reports go to the log.
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;

const MEDIA_READS = [
  "currentTime",
  "buffered",
  "played",
  "seekable",
  "readyState",
  "paused",
  "duration",
  "seeking",
  "ended",
  "volume",
  "muted",
  "playbackRate",
  "networkState",
  "error",
] as const;

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
    audioCaptures: num(page.audioCaptures),
    mediaReads: Object.fromEntries(MEDIA_READS.map((k) => [k, num(page.mediaReads[k] ?? 0)])),
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

type PerVideo = {
  dropped: number;
  total: number;
  steeredFraction?: number;
  rate?: number;
  rateBlocked?: boolean;
  lagLate?: number;
};

/** Decoder drops of rate-steered videos against the rest of the same page, so runner noise hits both alike. */
function dropsBySteering(perVideo: PerVideo[] | undefined) {
  const sums = { steered: [0, 0, 0, 0], unsteered: [0, 0, 0, 0] };
  for (const v of perVideo ?? []) {
    const steered =
      v.rateBlocked !== undefined
        ? v.rateBlocked !== true
        : v.steeredFraction !== undefined
          ? v.steeredFraction > 0.5
          : Math.abs((num(v.rate) ?? 1) - 1) > 1e-6;
    const sum = steered ? sums.steered : sums.unsteered;
    sum[0] += num(v.dropped) ?? 0;
    sum[1] += num(v.total) ?? 0;
    sum[2] += 1;
    sum[3] += num(v.lagLate) ?? 0;
  }
  const pct = ([dropped, total]: number[]) => (total ? num((dropped! / total) * 100) : null);
  return {
    steeredVideos: sums.steered[2],
    steeredDropPct: pct(sums.steered),
    unsteeredDropPct: pct(sums.unsteered),
    steeredLagMs: sums.steered[2] ? num((sums.steered[3] / sums.steered[2]) * 1000) : null,
    unsteeredLagMs: sums.unsteered[2] ? num((sums.unsteered[3] / sums.unsteered[2]) * 1000) : null,
  };
}

type ProxyReport = {
  proxyState?: { owner: number; count: number; playing: number };
  rasterMarks?: { before: number; atPlay: number };
  uiState?: { runningAnimations: number; loaderVisible: boolean; loaderHiding: boolean };
  hostOps?: { play: number; seek: number };
};

function proxyColumns(page: ProxyReport) {
  return {
    proxyOwnerParent: num(page.proxyState?.owner),
    proxies: num(page.proxyState?.count),
    proxiesPlaying: num(page.proxyState?.playing),
    hostPlays: num(page.hostOps?.play),
    hostSeeks: num(page.hostOps?.seek),
    rasterMarksBefore: num(page.rasterMarks?.before),
    rasterMarksAtPlay: num(page.rasterMarks?.atPlay),
    uiRunningAnimations: num(page.uiState?.runningAnimations),
    loaderVisible: page.uiState?.loaderVisible === true,
    loaderHiding: page.uiState?.loaderHiding === true,
  };
}

// The player with no per-frame probe: its decoder drops are the player's alone.
const COUNTERS_ONLY_FILMS = ["10-video-grid", "heavy-16x1080"];

// The same media played natively, and the same films run by the runtime in a bare iframe without the player element.
const CONTROLS: Array<{
  name: string;
  media?: string;
  n?: number;
  rate?: number;
  extra?: string;
  film?: string;
}> = [
  { name: "grid-native", media: "grid-sample", n: 10, rate: 1 },
  { name: "grid-runtime-bare", film: "10-video-grid" },
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

async function runFilm(
  base: string,
  browser: Browser,
  origin: string,
  fixture: string,
  countersOnly = false,
  emptyProxies = false,
  fullRaster = false,
  removeLoader = false,
) {
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
      args: [
        {
          playMs: PLAY_MS,
          seekFractions: SEEK_FRACTIONS,
          countersOnly,
          emptyProxies,
          fullRaster,
          removeLoader,
        },
      ],
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
      for (const [fixture, removeLoader] of COUNTERS_ONLY_FILMS.flatMap((f) => [
        [f, false] as const,
        [f, true] as const,
      ])) {
        for (let run = 1; run <= runs; run++) {
          const label = `${fixture} (counters only${removeLoader ? ", loader removed" : ""})`;
          try {
            const { page } = await runFilm(
              `http://127.0.0.1:${port}`,
              browser,
              server.origin,
              fixture,
              true,
              false,
              false,
              removeLoader,
            );
            const dropped = num(page.decoded.dropped) ?? 0;
            const total = num(page.decoded.total) ?? 0;
            const videos = num(page.videoCount) ?? 0;
            rows.push({
              browser,
              fixture: label,
              run,
              decoderDropped: dropped,
              decoderFrames: total,
              presentedFps: videos ? num((total - dropped) / videos / (PLAY_MS / 1000)) : null,
              ...dropsBySteering((page as { perVideo?: PerVideo[] }).perVideo),
              videoFrameCallbacks: num(
                (page as { frameReads?: { videoFrameCallbacks: number } }).frameReads
                  ?.videoFrameCallbacks,
              ),
              videoDraws: num(
                (page as { frameReads?: { videoDraws: number } }).frameReads?.videoDraws,
              ),
              ...proxyColumns(page as ProxyReport),
            });
            console.log(JSON.stringify(rows[rows.length - 1]));
          } catch (e) {
            rows.push({ browser, fixture: label, run, error: "failed, see the job log" });
            console.error(`[browsers] ${browser} ${label} run ${run} failed: ${e}`);
          }
        }
      }
      for (const c of CONTROLS) {
        try {
          const r = await readPage<{
            dropped: number;
            total: number;
            presentedFps: number;
            perVideo: PerVideo[];
            timelineMovesPerSecond?: number;
            rasterMarks?: number;
          }>(
            `http://127.0.0.1:${port}`,
            browser,
            c.film
              ? `${server.origin}/fixtures/_control/bare.html?film=${c.film}${c.extra ?? ""}`
              : `${server.origin}/fixtures/_control/index.html?media=${c.media}&n=${c.n}&rate=${c.rate}${c.extra ?? ""}`,
            "__control",
          );
          rows.push({
            browser,
            fixture: `control:${c.name}`,
            run: 1,
            decoderDropped: num(r.dropped),
            presentedFps: num(r.presentedFps),
            decoderFrames: num(r.total),
            ...dropsBySteering(r.perVideo),
            timelineMovesPerSecond: num(r.timelineMovesPerSecond),
            rasterMarksAtPlay: num(r.rasterMarks),
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
  "steeredVideos",
  "steeredDropPct",
  "unsteeredDropPct",
  "steeredLagMs",
  "unsteeredLagMs",
  "videoFrameCallbacks",
  "videoDraws",
  "timelineMovesPerSecond",
  "proxyOwnerParent",
  "proxies",
  "proxiesPlaying",
  "hostPlays",
  "hostSeeks",
  "rasterMarksBefore",
  "rasterMarksAtPlay",
  "uiRunningAnimations",
  "loaderVisible",
  "loaderHiding",
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
