#!/usr/bin/env bun
// Plays two edits in headless Chrome and prints numbers for five playback problems (see analyze.ts).
// Flags: --edit primary|tentake|both, --runs 5, --audio sink|none|both, --blocked, --out DIR.
// sink is a PulseAudio null sink at 48 kHz, none no device, blocked makes unmuted play() reject.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "../perf/runner.js";
import { analyze, median, type Dump, type Metrics } from "./analyze.ts";
import { buildEdit, compositionHtml, type EditSpec } from "./compositions.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAYER_PKG = resolve(HERE, "../..");
const REPO = resolve(PLAYER_PKG, "../..");
const MEDIA = join(HERE, "_media");
const PATHS = {
  player: join(PLAYER_PKG, "dist/hyperframes-player.global.js"),
  runtime: join(REPO, "packages/core/dist/hyperframe.runtime.iife.js"),
  gsap:
    [
      join(PLAYER_PKG, "node_modules/gsap/dist/gsap.min.js"),
      join(REPO, "node_modules/gsap/dist/gsap.min.js"),
    ].find(existsSync) ?? "",
};

const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? d) : d;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const RUNS = Number(arg("runs", "5"));
const EDITS = (
  arg("edit", "both") === "both" ? ["primary", "tentake"] : [arg("edit", "primary")]
) as EditSpec["name"][];
const AUDIO = arg("audio", "sink") === "both" ? ["sink", "none"] : [arg("audio", "sink")];
const BLOCKED = flag("blocked");
const OUT = resolve(arg("out", join(HERE, "results")));

function ensureMedia() {
  if (existsSync(join(MEDIA, "primary.mp4")) && existsSync(join(MEDIA, "tentake.mp4"))) return;
  execFileSync("bash", [join(HERE, "make-media.sh")], { stdio: "inherit" });
}

/** A PulseAudio null sink at 48 kHz, or no audio device at all. */
function audioEnv(mode: string) {
  if (mode === "none") {
    process.env.PULSE_SERVER = "unix:/nonexistent/pulse";
    delete process.env.PULSE_SINK;
    return;
  }
  delete process.env.PULSE_SERVER;
  spawnSync("pulseaudio", ["--start", "--exit-idle-time=-1"], { stdio: "ignore" });
  const sinks = spawnSync("pactl", ["list", "short", "sinks"], { encoding: "utf8" }).stdout ?? "";
  if (!sinks.includes("playbench")) {
    spawnSync(
      "pactl",
      ["load-module", "module-null-sink", "sink_name=playbench", "rate=48000", "format=s16le"],
      { stdio: "ignore" },
    );
  }
  process.env.PULSE_SINK = "playbench";
}

function host(editName: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>playbench host</title>
<style>html,body{margin:0;background:#000}hyperframes-player{width:360px;height:640px;display:block}</style></head>
<body>
<hyperframes-player id="player" controls src="/comp/${editName}.html" width="720" height="1280"></hyperframes-player>
<script>
  const player = document.getElementById("player");
  window.__pbOwnership = [];
  player.addEventListener("ready", () => (window.__pbReady = true));
  player.addEventListener("assetsready", () => (window.__pbAssets = true));
  player.addEventListener("ended", () => (window.__pbEndedAt = performance.timeOrigin + performance.now()));
  player.addEventListener("audioownershipchange", (e) => window.__pbOwnership.push([performance.timeOrigin + performance.now(), (e.detail && e.detail.owner) || String(e.detail)]));
  window.__pbPlay = () => { const t = performance.timeOrigin + performance.now(); player.play(); return t; };
</script>
<script src="/player/hyperframes-player.global.js"></script>
</body></html>`;
}

function serveMedia(file: string, req: Request): Response {
  const f = Bun.file(file);
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };
  if (!range) return new Response(f, { headers });
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), f.size - 1) : f.size - 1;
  headers["Content-Range"] = `bytes ${start}-${end}/${f.size}`;
  return new Response(f.slice(start, end + 1), { status: 206, headers });
}

function startServer(edits: Record<string, EditSpec>) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;
      const html = (body: string) =>
        new Response(body, {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      if (p === "/host.html") return html(host(url.searchParams.get("edit") ?? "primary"));
      const comp = /^\/comp\/(\w+)\.html$/.exec(p);
      if (comp && edits[comp[1]!]) return html(compositionHtml(edits[comp[1]!]!, "/media"));
      if (p.startsWith("/media/")) return serveMedia(join(MEDIA, p.slice(7)), req);
      const js = (path: string) =>
        new Response(Bun.file(path), {
          headers: { "Content-Type": "application/javascript", "Cache-Control": "no-store" },
        });
      if (p === "/player/hyperframes-player.global.js") return js(PATHS.player);
      if (p === "/vendor/hyperframe.runtime.iife.js") return js(PATHS.runtime);
      if (p === "/vendor/gsap.min.js") return js(PATHS.gsap);
      return new Response("not found", { status: 404 });
    },
  });
}

type Browser = Awaited<ReturnType<typeof launchBrowser>>;

async function playOnce(
  browser: Browser,
  origin: string,
  edit: EditSpec,
  instrument: string,
): Promise<{ metrics: Metrics; traces: { host: Dump; comp: Dump } }> {
  const page = await browser.newPage();
  try {
    await page.evaluateOnNewDocument(instrument);
    await page.goto(`${origin}/host.html?edit=${edit.name}${BLOCKED ? "&blocked=1" : ""}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () => (window as unknown as { __pbReady?: boolean }).__pbReady === true,
      { timeout: 60_000 },
    );
    await page
      .waitForFunction(() => (window as unknown as { __pbAssets?: boolean }).__pbAssets === true, {
        timeout: 60_000,
      })
      .catch(() => {});
    const playAt = (await page.evaluate(() =>
      (window as unknown as { __pbPlay: () => number }).__pbPlay(),
    )) as number;
    await page
      .waitForFunction(() => !!(window as unknown as { __pbEndedAt?: number }).__pbEndedAt, {
        timeout: (edit.duration + 30) * 1000,
      })
      .catch(() => {});
    const endedAt = (await page.evaluate(
      () => (window as unknown as { __pbEndedAt?: number }).__pbEndedAt ?? null,
    )) as number | null;
    const ownership = (await page.evaluate(
      () => (window as unknown as { __pbOwnership: [number, string][] }).__pbOwnership,
    )) as [number, string][];
    const dumps: Dump[] = [];
    for (const f of page.frames()) {
      const d = (await f.evaluate(
        () => (window as unknown as { __pbDump?: () => unknown }).__pbDump?.() ?? null,
      )) as Dump | null;
      if (d) dumps.push(d);
    }
    const hostDump = dumps.find((d) => d.kind === "host");
    const compDump = dumps.find((d) => d.kind === "comp");
    if (!hostDump || !compDump)
      throw new Error(
        `no ${hostDump ? "composition" : "host"} frame trace (frames: ${dumps.map((d) => d.kind).join(",")})`,
      );
    return {
      metrics: analyze({ edit, comp: compDump, host: hostDump, playAt, endedAt, ownership }),
      traces: { host: hostDump, comp: compDump },
    };
  } finally {
    await page.close();
  }
}

const fmt = (v: number | null | boolean) =>
  v === null ? "n/a" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);

/** median [min-max] over the runs, or a count over the runs for yes/no. */
function summarize(values: (number | boolean | null)[]): string {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (values.every((v) => typeof v === "boolean"))
    return `${values.filter(Boolean).length}/${values.length}`;
  if (!nums.length) return "n/a";
  const med = median(nums)!;
  return nums.length === 1
    ? fmt(med)
    : `${fmt(Math.round(med * 10) / 10)} [${fmt(Math.min(...nums))}-${fmt(Math.max(...nums))}]`;
}

const ROWS: [string, string, (m: Metrics) => number | boolean | null][] = [
  ["1", "frames past the out-point at cut 1", (m) => m.firstTakeOverrunFrames],
  ["1", "runs with frames past the out-point (cut 1)", (m) => m.firstTakeOverrunFrames > 0],
  ["1", "later cuts with frames past the out-point", (m) => m.cutsWithOverrun],
  ["1", "picture ahead of the playhead in the first 1.5 s (ms)", (m) => m.pictureAheadMs],
  ["1", "playhead still at 0 after play() (ms)", (m) => m.playheadStartMs],
  ["2", "joins", (m) => m.joins],
  ["2", "joins with a mid-play seek in the first 600 ms", (m) => m.joinsWithMidPlaySeek],
  ["2", "jump size median (ms)", (m) => m.jumpMedianMs],
  ["2", "jump size max (ms)", (m) => m.jumpMaxMs],
  ["2", "audio late at +50 ms, median (ms)", (m) => m.audioLateStartMedianMs],
  ["2", "joins whose audio was pre-seeked", (m) => m.joinsPreSeeked],
  [
    "3",
    "fade-out landing offset, median over takes (ms; negative = early)",
    (m) => (m.fadeOutOffsetsMs.length ? median(m.fadeOutOffsetsMs) : null),
  ],
  [
    "3",
    "fade-out landing offset, earliest take (ms)",
    (m) => (m.fadeOutOffsetsMs.length ? Math.min(...m.fadeOutOffsetsMs) : null),
  ],
  [
    "3",
    "fade-out landing offset, latest take (ms)",
    (m) => (m.fadeOutOffsetsMs.length ? Math.max(...m.fadeOutOffsetsMs) : null),
  ],
  ["3", "all lane points, median offset (ms)", (m) => m.automationOffsetMedianMs],
  ["3", "takes with a point more than 50 ms off", (m) => m.takesWithAutomationOff50],
  ["4", "cuts", (m) => m.cuts],
  ["4", "incoming second-frame gap median (ms)", (m) => m.secondFrameGapMedianMs],
  ["4", "incoming second-frame gap max (ms)", (m) => m.secondFrameGapMaxMs],
  [
    "4",
    "incoming picture behind the playhead, first 0.5 s, median over cuts (ms)",
    (m) => m.cutPictureLagMedianMs,
  ],
  [
    "4",
    "incoming picture behind the playhead, first 0.5 s, worst cut (ms)",
    (m) => m.cutPictureLagMaxMs,
  ],
  ["4", "playhead hold per cut median (ms)", (m) => m.playheadHoldMedianMs],
  ["4", "playhead hold per cut p90 (ms)", (m) => m.playheadHoldP90Ms],
  ["4", "cuts with a hold over 100 ms", (m) => m.holdsOver100],
  ["4", "played longer than the edit (ms)", (m) => m.playedLongerMs],
  ["5", "parent audio owner reached", (m) => m.ownershipParent],
  ["5", "takes heard from their own stretch of the file", (m) => m.takesHeard],
  ["5", "parent proxy seeks per second while it plays", (m) => m.proxySeeksPerSecond],
  ["5", "seconds the parent proxy played (edit is longer)", (m) => m.proxyPlayedSeconds],
];

async function main() {
  ensureMedia();
  const edits = Object.fromEntries(EDITS.map((n) => [n, buildEdit(n)]));
  const instrument = readFileSync(join(HERE, "instrument.js"), "utf8");
  const server = startServer(edits);
  const origin = `http://127.0.0.1:${server.port}`;
  mkdirSync(OUT, { recursive: true });
  const all: Record<string, Metrics[]> = {};
  try {
    for (const mode of AUDIO) {
      audioEnv(mode);
      const browser = await launchBrowser({ width: 1280, height: 900 });
      console.log(
        `\nChrome ${await browser.version()}, ${cpus().length} cpus, load ${loadavg()
          .map((l) => l.toFixed(1))
          .join(
            " ",
          )}, audio ${mode === "sink" ? "PulseAudio null sink 48 kHz" : "no device"}${BLOCKED ? ", autoplay blocked" : ""}, ${RUNS} runs each`,
      );
      try {
        for (const name of EDITS) {
          const edit = edits[name]!;
          const runs: Metrics[] = [];
          for (let i = 0; i < RUNS; i++) {
            const { metrics, traces } = await playOnce(browser, origin, edit, instrument);
            runs.push(metrics);
            if (i === 0)
              writeFileSync(
                join(OUT, `trace-${name}-${mode}${BLOCKED ? "-blocked" : ""}.json`),
                JSON.stringify(traces),
              );
            console.log(
              `  ${name} run ${i + 1}/${RUNS}: overrun ${metrics.firstTakeOverrunFrames} frames at cut 1, ${metrics.joinsWithMidPlaySeek}/${metrics.joins} joins with a mid-play seek`,
            );
          }
          all[`${name}/${mode}${BLOCKED ? "/blocked" : ""}`] = runs;
          console.log(
            `\n${name} edit (${edit.takes.length} takes, ${edit.duration} s, ${edit.fps} fps), audio ${mode}${BLOCKED ? ", autoplay blocked" : ""}: median [min-max] over ${RUNS} runs`,
          );
          console.log("| # | measure | result |\n|---|---|---|");
          for (const [n, label, get] of ROWS)
            console.log(`| ${n} | ${label} | ${summarize(runs.map(get))} |`);
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.stop(true);
  }
  writeFileSync(
    join(OUT, `metrics${BLOCKED ? "-blocked" : ""}.json`),
    JSON.stringify(all, null, 1),
  );
  console.log(`\nper-run numbers: ${join(OUT, `metrics${BLOCKED ? "-blocked" : ""}.json`)}`);
}

await main();
