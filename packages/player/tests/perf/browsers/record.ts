#!/usr/bin/env bun
// Records the screen while a film plays and counts how often each video tile changes on screen:
// what a viewer sees, independent of the browser's own decoder counters. macOS only (avfoundation).
// bun run tests/perf/browsers/record.ts --browsers safari,chrome
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../server.ts";
import { DRIVERS, startDriver, wd, type Browser } from "./webdriver.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../results/recordings");
// A tile counts as changed when its downscaled centre moves this much (0-255 grey levels, mean abs).
const CHANGE_THRESHOLD = 1.5;
const CROP = { w: 16, h: 9 };

type Case = { name: string; path: string; startsItself: boolean };
const CASES: Case[] = [
  {
    name: "player",
    path: "/host.html?fixture=10-video-grid&width=960&height=540",
    startsItself: false,
  },
  {
    name: "bare-runtime",
    path: "/fixtures/_control/bare.html?film=10-video-grid",
    startsItself: true,
  },
  {
    name: "native",
    path: "/fixtures/_control/index.html?media=grid-sample&n=10&rate=1",
    startsItself: true,
  },
];

// Each video's box in screen pixels, through the player's or the bare page's scaled iframe if there is one.
const RECTS_SCRIPT = `
  const host = document.getElementById("player");
  const frame = host ? host.shadowRoot.querySelector("iframe") : document.querySelector("iframe");
  const doc = frame ? frame.contentDocument : document;
  const box = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
  const scale = frame ? box.width / frame.offsetWidth : 1;
  const top = window.screenY + window.outerHeight - window.innerHeight;
  const dpr = window.devicePixelRatio;
  return [...doc.querySelectorAll("video")].map((v) => {
    const r = v.getBoundingClientRect();
    return [
      (window.screenX + box.left + r.left * scale) * dpr,
      (top + box.top + r.top * scale) * dpr,
      r.width * scale * dpr,
      r.height * scale * dpr,
    ];
  });`;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function startRecording(file: string, seconds: number) {
  return spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "avfoundation",
      "-capture_cursor",
      "0",
      "-framerate",
      "60",
      "-i",
      "Capture screen 0:none",
      "-t",
      String(seconds),
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "12",
      file,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
}

/** Per tile: changes per second while playing, and the longest stretch the tile showed one picture. */
function analyse(file: string, rects: number[][]) {
  const times = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v",
      "-show_entries",
      "frame=pts_time",
      "-of",
      "csv=p=0",
      "--",
      file,
    ],
    { encoding: "utf-8" },
  )
    .split("\n")
    .map((line) => line.replace(/,/g, "").trim())
    .filter((line) => line !== "")
    .map(Number)
    .filter((t) => Number.isFinite(t));
  const tiles = rects.map(([x, y, w, h]) => {
    const crop = `crop=${Math.round(w! / 2)}:${Math.round(h! / 2)}:${Math.round(x! + w! / 4)}:${Math.round(y! + h! / 4)}`;
    const raw = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        file,
        "-fps_mode",
        "passthrough",
        "-vf",
        `${crop},scale=${CROP.w}:${CROP.h},format=gray`,
        "-f",
        "rawvideo",
        "-",
      ],
      { maxBuffer: 1 << 28 },
    );
    const size = CROP.w * CROP.h;
    const changes: number[] = [];
    for (let f = 1; f * size < raw.length; f++) {
      let diff = 0;
      for (let i = 0; i < size; i++)
        diff += Math.abs(raw[f * size + i]! - raw[(f - 1) * size + i]!);
      if (diff / size > CHANGE_THRESHOLD) changes.push(times[f] ?? f / 60);
    }
    const meanLuma = raw.reduce((sum, v) => sum + v, 0) / Math.max(1, raw.length);
    return { changes, meanLuma };
  });
  const all = tiles.flatMap((t) => t.changes);
  const span = all.length ? Math.max(...all) - Math.min(...all) : 0;
  const perTile = tiles.map((t) => {
    const gaps = t.changes.slice(1).map((c, i) => c - t.changes[i]!);
    return {
      perSecond: span > 0 ? t.changes.length / span : 0,
      longestFreezeMs: Math.max(0, ...gaps) * 1000,
    };
  });
  const sorted = perTile.map((t) => t.perSecond).sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    captureFps: round(times.length / Math.max(1e-9, times[times.length - 1]! - times[0]!)),
    playingSeconds: round(span),
    tiles: tiles.length,
    darkTiles: tiles.filter((t) => t.meanLuma < 5).length,
    medianChangesPerSecond: round(sorted[Math.floor(sorted.length / 2)] ?? 0),
    minChangesPerSecond: round(sorted[0] ?? 0),
    longestFreezeMs: Math.round(Math.max(0, ...perTile.map((t) => t.longestFreezeMs))),
  };
}

/** How often the source itself changes at this crop and threshold: the most any tile can show. */
function sourceChangesPerSecond(file: string): number {
  const raw = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    file,
    "-t",
    "8",
    "-vf",
    `crop=iw/2:ih/2:iw/4:ih/4,scale=${CROP.w}:${CROP.h},format=gray`,
    "-f",
    "rawvideo",
    "-",
  ]);
  const size = CROP.w * CROP.h;
  let changes = 0;
  for (let f = 1; f * size < raw.length; f++) {
    let diff = 0;
    for (let i = 0; i < size; i++) diff += Math.abs(raw[f * size + i]! - raw[(f - 1) * size + i]!);
    if (diff / size > CHANGE_THRESHOLD) changes++;
  }
  return Math.round((changes / 8) * 10) / 10;
}

const browsers = arg("browsers", "safari,chrome").split(",") as Browser[];
mkdirSync(OUT, { recursive: true });
const server = startServer();
const rows: Array<Record<string, unknown>> = [];
try {
  for (const browser of browsers) {
    const port = 4544 + browsers.indexOf(browser);
    const driver = await startDriver(browser, port);
    const base = `http://127.0.0.1:${port}`;
    try {
      for (const c of CASES) {
        const session = await wd(base, "POST", "/session", {
          capabilities: { alwaysMatch: DRIVERS[browser].caps },
        });
        const s = `/session/${session.sessionId}`;
        const file = resolve(OUT, `${browser}-${c.name}.mp4`);
        try {
          await wd(base, "POST", `${s}/window/rect`, { x: 0, y: 0, width: 1024, height: 768 });
          let recorder;
          if (c.startsItself) {
            recorder = startRecording(file, 18);
            await wd(base, "POST", `${s}/url`, { url: server.origin + c.path });
            const deadline = Date.now() + 17_000;
            while (Date.now() < deadline) {
              const done = await wd(base, "POST", `${s}/execute/sync`, {
                script: "return window.__control",
                args: [],
              });
              if (done) break;
              await Bun.sleep(250);
            }
          } else {
            await wd(base, "POST", `${s}/url`, { url: server.origin + c.path });
            const deadline = Date.now() + 60_000;
            while (Date.now() < deadline) {
              const ready = await wd(base, "POST", `${s}/execute/sync`, {
                script: "return window.__playerAssetsReady === true",
                args: [],
              });
              if (ready) break;
              await Bun.sleep(250);
            }
            recorder = startRecording(file, 11);
            await Bun.sleep(1500);
            await wd(base, "POST", `${s}/execute/sync`, {
              script: 'document.getElementById("player").play()',
              args: [],
            });
            await Bun.sleep(9000);
          }
          const exited = recorder.exitCode === null ? once(recorder, "exit") : Promise.resolve();
          recorder.stdin?.write("q");
          await exited;
          const rects = (await wd(base, "POST", `${s}/execute/sync`, {
            script: RECTS_SCRIPT,
            args: [],
          })) as unknown[];
          const numeric = rects.map((r) =>
            Array.isArray(r)
              ? r.map((n) => (typeof n === "number" && Number.isFinite(n) ? n : 0))
              : [0, 0, 0, 0],
          );
          const row = { browser, case: c.name, ...analyse(file, numeric) };
          rows.push(row);
          console.log(JSON.stringify(row));
        } catch (e) {
          rows.push({ browser, case: c.name, error: "failed, see the job log" });
          console.error(`[record] ${browser} ${c.name} failed: ${e}`);
        } finally {
          await wd(base, "DELETE", s).catch(() => {});
        }
      }
    } finally {
      driver.kill();
    }
  }
} finally {
  await server.stop();
}

const cols = [
  "browser",
  "case",
  "captureFps",
  "playingSeconds",
  "tiles",
  "darkTiles",
  "medianChangesPerSecond",
  "minChangesPerSecond",
  "longestFreezeMs",
  "error",
];
const md = [
  `| ${cols.join(" | ")} |`,
  `|${cols.map(() => "---").join("|")}|`,
  ...rows.map(
    (r) => `| ${cols.map((k) => (r[k] === undefined ? "" : String(r[k]))).join(" | ")} |`,
  ),
].join("\n");
const ceiling = sourceChangesPerSecond(resolve(HERE, "../fixtures/10-video-grid/sample.mp4"));
writeFileSync(
  resolve(OUT, "screen.json"),
  JSON.stringify({ sourceChangesPerSecond: ceiling, rows }, null, 2) + "\n",
);
console.log(`source ceiling: ${ceiling} changes per second\n${md}`);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## What the screen shows\n\nThe source video changes ${ceiling} times per second at this crop, the most a tile can show.\n\n${md}\n`,
  );
