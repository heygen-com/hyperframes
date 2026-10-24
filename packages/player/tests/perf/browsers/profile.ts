#!/usr/bin/env bun
// Profiles Safari natively (Instruments Time Profiler) while a film plays in the player, and sums the
// samples per process and per function, so the frame cost splits into style, layout, paint and compositing.
// macOS only. bun run tests/perf/browsers/profile.ts [--seconds 6]
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../server.ts";
import { DRIVERS, startDriver, wd } from "./webdriver.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../results/profile");
const TOP = 40;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

type Sample = {
  process: string;
  thread: string;
  timeNs: number;
  weightNs: number;
  frames: string[];
};

// xctrace's XML defines each thread, process, frame, backtrace and weight once (id="n") and later rows
// point back to it (ref="n"); a thread's process is only nested in its first definition.
function parseSamples(xml: string): Sample[] {
  const unescape = (v: string) =>
    v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const attr = (attrs: string, key: string) => {
    const v = new RegExp(`\\b${key}="([^"]*)"`).exec(attrs)?.[1];
    return v === undefined ? undefined : unescape(v);
  };
  const names = new Map<string, string>();
  const backtraces = new Map<string, string[]>();
  const threadProcess = new Map<string, string>();
  const samples: Sample[] = [];
  let row: Sample | null = null;
  let frames: string[] | null = null;
  let backtraceId: string | undefined;
  let threadId: string | undefined;
  for (const m of xml.matchAll(/<(\/?)([\w-]+)([^>]*?)(\/?)>/g)) {
    const [whole, closing, tag, attrs = "", selfClosing] = m;
    if (tag === "row") {
      if (closing && row) samples.push(row);
      row = closing ? null : { process: "", thread: "", timeNs: 0, weightNs: 0, frames: [] };
      continue;
    }
    if (!row) continue;
    if (closing) {
      if (tag === "backtrace" && frames) {
        if (backtraceId) backtraces.set(backtraceId, frames);
        row.frames = frames;
        frames = null;
      }
      if (tag === "thread") threadId = undefined;
      continue;
    }
    const id = attr(attrs, "id");
    const ref = attr(attrs, "ref");
    if (tag === "backtrace") {
      if (ref) row.frames = backtraces.get(ref) ?? [];
      else if (!selfClosing) {
        frames = [];
        backtraceId = id;
      }
    } else if (tag === "frame" && frames) {
      const name = ref ? names.get(ref) : attr(attrs, "name");
      if (id && name) names.set(id, name);
      frames.push(name ?? "?");
    } else if (tag === "thread") {
      row.thread = (ref ? names.get(ref) : attr(attrs, "fmt")) ?? "";
      if (id) names.set(id, row.thread);
      if (ref) row.process = threadProcess.get(ref) ?? "";
      else if (!selfClosing) threadId = id;
    } else if (tag === "process") {
      row.process = (ref ? names.get(ref) : attr(attrs, "fmt")) ?? "";
      if (id) names.set(id, row.process);
      if (threadId) threadProcess.set(threadId, row.process);
    } else if (tag === "weight" || tag === "sample-time") {
      const at = m.index! + whole.length;
      const value = ref ? names.get(ref) : xml.slice(at, xml.indexOf("<", at));
      if (id && value) names.set(id, value);
      if (tag === "weight") row.weightNs = Number(value) || 0;
      else row.timeNs = Number(value) || 0;
    }
  }
  return samples;
}

function top(entries: Map<string, number>, total: number) {
  return [...entries]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([name, ns]) => ({
      name: name.slice(0, 160),
      ms: Math.round(ns / 1e6),
      pct: Math.round((ns / total) * 1000) / 10,
    }));
}

// Main-thread CPU in each 60 Hz frame window: what a frame actually costs the page, idle waits excluded.
function busyPerFrame(samples: Sample[]) {
  const windowNs = 1e9 / 60;
  const busy = new Map<number, number>();
  for (const s of samples) {
    const w = Math.floor(s.timeNs / windowNs);
    busy.set(w, (busy.get(w) ?? 0) + s.weightNs / 1e6);
  }
  const first = Math.min(...busy.keys());
  const last = Math.max(...busy.keys());
  const ms = Array.from({ length: last - first + 1 }, (_, i) => busy.get(first + i) ?? 0).sort(
    (a, b) => a - b,
  );
  const at = (q: number) =>
    Math.round(ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]! * 10) / 10;
  return {
    windows: ms.length,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    maxMs: at(1),
    over8Ms: ms.filter((v) => v > 8).length,
  };
}

function summarize(samples: Sample[], seconds: number) {
  const perProcess = new Map<string, number>();
  for (const s of samples) {
    const name = s.process.replace(/\s*\(\d+\)$/, "");
    perProcess.set(name, (perProcess.get(name) ?? 0) + s.weightNs);
  }
  const groups: Record<string, (s: Sample) => boolean> = {
    "WebContent main thread": (s) => /WebContent/.test(s.process) && /Main Thread/i.test(s.thread),
    "WebContent other threads": (s) =>
      /WebContent/.test(s.process) && !/Main Thread/i.test(s.thread),
    "GPU process": (s) => /WebKit\.GPU/.test(s.process),
  };
  const detail = Object.entries(groups).map(([group, match]) => {
    const picked = samples.filter(match);
    const total = picked.reduce((sum, s) => sum + s.weightNs, 0) || 1;
    const self = new Map<string, number>();
    const inclusive = new Map<string, number>();
    for (const s of picked) {
      self.set(s.frames[0] ?? "?", (self.get(s.frames[0] ?? "?") ?? 0) + s.weightNs);
      for (const f of new Set(s.frames)) inclusive.set(f, (inclusive.get(f) ?? 0) + s.weightNs);
    }
    return {
      group,
      msPerSecond: Math.round(total / 1e6 / seconds),
      inclusive: top(inclusive, total),
      self: top(self, total),
    };
  });
  const main = samples.filter((s) => /WebContent/.test(s.process) && /Main Thread/i.test(s.thread));
  return {
    mainThreadPerFrame: main.length ? busyPerFrame(main) : null,
    perProcessMsPerSecond: Object.fromEntries(
      [...perProcess]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([name, ns]) => [name, Math.round(ns / 1e6 / seconds)]),
    ),
    detail,
  };
}

// The long film's tiles have no will-change and a box shadow; each arm takes one of those away.
const ARMS = [
  { name: "heavy-long-gsap", film: "heavy-long-gsap", css: "" },
  {
    name: "heavy-long-gsap, tiles will-change",
    film: "heavy-long-gsap",
    css: ".dot { will-change: transform; }",
  },
  {
    name: "heavy-long-gsap, no tile shadow",
    film: "heavy-long-gsap",
    css: ".dot { box-shadow: none; }",
  },
  { name: "gsap-heavy", film: "gsap-heavy", css: "" },
];
const seconds = Number(arg("seconds", "6"));
mkdirSync(OUT, { recursive: true });
const server = startServer();
const port = 4460;
const driver = await startDriver("safari", port);
const base = `http://127.0.0.1:${port}`;
const report: Record<string, unknown> = {};
try {
  for (const { name, film, css } of ARMS) {
    const session = await wd(base, "POST", "/session", {
      capabilities: { alwaysMatch: DRIVERS.safari.caps },
    });
    const s = `/session/${session.sessionId}`;
    try {
      await wd(base, "POST", `${s}/window/rect`, { x: 0, y: 0, width: 1024, height: 768 });
      await wd(base, "POST", `${s}/url`, {
        url: `${server.origin}/host.html?fixture=${film}&width=960&height=540`,
      });
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const ready = await wd(base, "POST", `${s}/execute/sync`, {
          script:
            "return window.__playerError || (window.__playerReady && window.__playerAssetsReady)",
          args: [],
        });
        if (typeof ready === "string") throw new Error(ready);
        if (ready) break;
        await Bun.sleep(250);
      }
      await wd(base, "POST", `${s}/execute/sync`, {
        script: `const doc = document.getElementById("player").shadowRoot.querySelector("iframe").contentDocument;
          if (arguments[0]) doc.head.append(Object.assign(doc.createElement("style"), { textContent: arguments[0] }));
          window.__frames = 0;
          (function count() { window.__frames++; requestAnimationFrame(count); })();
          window.__since = performance.now();
          document.getElementById("player").play();`,
        args: [css],
      });
      await Bun.sleep(1000);
      const slug = name.replace(/[^a-z0-9]+/gi, "-");
      const trace = resolve(OUT, `${slug}.trace`);
      execFileSync(
        "sudo",
        [
          "-n",
          "xcrun",
          "xctrace",
          "record",
          "--template",
          "Time Profiler",
          "--all-processes",
          "--time-limit",
          `${seconds}s`,
          "--output",
          trace,
          "--no-prompt",
        ],
        { stdio: "inherit" },
      );
      const fps = await wd(base, "POST", `${s}/execute/sync`, {
        script:
          "return Math.round((window.__frames / (performance.now() - window.__since)) * 10000) / 10",
        args: [],
      });
      const xmlPath = resolve(OUT, `${slug}.xml`);
      execFileSync("sudo", ["-n", "chmod", "-R", "a+rwX", trace]);
      execFileSync("xcrun", [
        "xctrace",
        "export",
        "--input",
        trace,
        "--output",
        xmlPath,
        "--xpath",
        '/trace-toc/run[@number="1"]/data/table[@schema="time-profile"]',
      ]);
      const summary = { fps, ...summarize(parseSamples(readFileSync(xmlPath, "utf8")), seconds) };
      report[name] = summary;
      // The same paused moment in every arm, to compare how sharp the tiles render.
      await wd(base, "POST", `${s}/execute/async`, {
        script: `const done = arguments[arguments.length - 1];
          const player = document.getElementById("player");
          player.pause();
          player.seek(30);
          setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(done)), 500);`,
        args: [],
      });
      const png = await wd(base, "GET", `${s}/screenshot`);
      writeFileSync(resolve(OUT, `${slug}.png`), Buffer.from(png as string, "base64"));
      console.log(
        `[profile] ${name}: ${fps} fps, main thread per frame ${JSON.stringify(summary.mainThreadPerFrame)}`,
      );
    } finally {
      await wd(base, "DELETE", s).catch(() => {});
    }
  }
} finally {
  driver.kill();
  await server.stop();
}

writeFileSync(resolve(OUT, "profile.json"), JSON.stringify(report, null, 2) + "\n");
const md = Object.entries(report)
  .map(([film, r]) => {
    const { fps, mainThreadPerFrame, perProcessMsPerSecond, detail } = r as {
      fps: number;
    } & ReturnType<typeof summarize>;
    const rows = detail
      .map(
        (d) =>
          `#### ${d.group}: ${d.msPerSecond} ms of CPU per second\n\n| inclusive % | function |\n|---|---|\n` +
          d.inclusive
            .map((f) => `| ${f.pct} | ${f.name.replace(/\\/g, "\\\\").replace(/\|/g, "\\|")} |`)
            .join("\n"),
      )
      .join("\n\n");
    return `### ${film}\n\n${fps} fps; main-thread CPU per frame: ${JSON.stringify(mainThreadPerFrame)}\n\nCPU ms per second by process: ${JSON.stringify(perProcessMsPerSecond)}\n\n${rows}`;
  })
  .join("\n\n");
writeFileSync(resolve(OUT, "profile.md"), md + "\n");
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Safari profile\n\n${md}\n`);
