#!/usr/bin/env bun
// Plays an edit in WebKit and counts how often the playhead stands still at the cuts.
// Flags: --edit tentake|primary, --runs 3, --browser webkit|manual, --port 8099.
// webkit drives Playwright's WebKit (`playwright-core` and `playwright-core install webkit`); manual only serves
// /host.html and waits for a real Safari to open it, click Play and post the result.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEdit, compositionHtml, type EditSpec } from "./compositions.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAYER_PKG = resolve(HERE, "../..");
const REPO = resolve(PLAYER_PKG, "../..");
const MEDIA = join(HERE, "_media");
const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? d) : d;
};
const edit = buildEdit(arg("edit", "tentake") as EditSpec["name"]);
const RUNS = Number(arg("runs", "3"));
const STOP_MS = 50;

const gsap = [
  join(PLAYER_PKG, "node_modules/gsap/dist/gsap.min.js"),
  join(REPO, "node_modules/gsap/dist/gsap.min.js"),
].find(existsSync)!;
const file = (p: string, type: string) =>
  new Response(Bun.file(p), { headers: { "Content-Type": type, "Cache-Control": "no-store" } });

const HOST = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;background:#000}hyperframes-player{width:360px;height:640px;display:block}button{font-size:28px}</style>
<button id="go">Play</button>
<hyperframes-player id="p" src="/comp.html" width="720" height="1280"></hyperframes-player>
<script>
  var p = document.getElementById("p"), samples = [], t0 = 0, done = false;
  function finish() {
    if (done) return; done = true;
    var body = JSON.stringify({ t0: t0, end: performance.now(), samples: samples });
    fetch("/result", { method: "POST", body: body }).then(function () { window.__done = true; });
  }
  p.addEventListener("ended", finish);
  document.getElementById("go").onclick = function () {
    t0 = performance.now(); p.play();
    (function tick() {
      if (done) return;
      var w = p.shadowRoot.querySelector("iframe").contentWindow, t = w.__player && w.__player.getTime ? w.__player.getTime() : p.currentTime;
      var els = [].filter.call(w.document.querySelectorAll("audio"), function (a) { return !a.paused; }).map(function (a) { return a.id + ":" + a.currentTime.toFixed(2) + (a.seeking ? "S" : "") + a.readyState; }).join(" ");
      samples.push([performance.now(), t, els]);
      if (performance.now() - t0 > ${(edit.duration + 20) * 1000}) return finish();
      requestAnimationFrame(tick);
    })();
  };
</script>
<script src="/player.js"></script>`;

type Result = { t0: number; end: number; samples: [number, number, string?][] };

/** Stops are runs where the playhead stood still for more than STOP_MS, each tied to the cut it started at. */
export function measure(r: Result, cuts: number[]) {
  const s = r.samples;
  const stops: { at: number; ms: number }[] = [];
  let from = 0;
  for (let i = 1; i <= s.length; i++) {
    if (i < s.length && s[i]![1] === s[from]![1]) continue;
    const ms = (i < s.length ? s[i]![0] : r.end) - s[from]![0];
    if (ms > STOP_MS && s[from]![1] > 0.5) stops.push({ at: s[from]![1], ms });
    from = i;
  }
  const perCut = cuts.map((c) => stops.filter((x) => x.at >= c - 0.3 && x.at < c + 1.5));
  const played = (r.end - r.t0) / 1000;
  return {
    stops: stops.length,
    stopsPerCut: stops.length / cuts.length,
    longestMs: Math.round(Math.max(0, ...stops.map((x) => x.ms))),
    cutsWithStop: perCut.filter((c) => c.length).length,
    cuts: cuts.length,
    last: s.length ? Math.round(s[s.length - 1]![1] * 100) / 100 : 0,
    worst: [...stops]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 4)
      .map((x) => `${x.at.toFixed(2)}s:${Math.round(x.ms)}ms`),
    overrunS: Math.round((played - edit.duration) * 10) / 10,
  };
}

const results: Result[] = [];
const TRACE = process.argv.includes("--trace");
let resolveResult: (() => void) | null = null;
const server = Bun.serve({
  port: Number(arg("port", "0")),
  async fetch(req) {
    const p = new URL(req.url).pathname;
    const html = (b: string) => new Response(b, { headers: { "Content-Type": "text/html" } });
    if (p === "/host.html") return html(HOST);
    if (p === "/comp.html") return html(compositionHtml(edit, "/media"));
    if (p === "/player.js")
      return file(join(PLAYER_PKG, "dist/hyperframes-player.global.js"), "text/javascript");
    if (p === "/vendor/hyperframe.runtime.iife.js")
      return file(join(REPO, "packages/core/dist/hyperframe.runtime.iife.js"), "text/javascript");
    if (p === "/vendor/gsap.min.js") return file(gsap, "text/javascript");
    if (p === "/result") {
      results.push((await req.json()) as Result);
      resolveResult?.();
      return new Response("ok");
    }
    if (p.startsWith("/media/")) {
      const f = Bun.file(join(MEDIA, p.slice(7)));
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
      const h: Record<string, string> = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" };
      if (!m) return new Response(f, { headers: h });
      const a = Number(m[1]);
      const b = m[2] ? Math.min(Number(m[2]), f.size - 1) : f.size - 1;
      h["Content-Range"] = `bytes ${a}-${b}/${f.size}`;
      return new Response(f.slice(a, b + 1), { status: 206, headers: h });
    }
    return new Response("not found", { status: 404 });
  },
});
const cuts = edit.takes.slice(1).map((t) => t.start);
const origin = `http://127.0.0.1:${server.port}`;

async function drivePlaywright() {
  const name = "playwright-core"; // not a dependency: installed by hand, so kept out of the type check
  const { webkit } = (await import(name)) as { webkit: any }; // oxlint-disable-line no-explicit-any
  const browser = await webkit.launch();
  console.log(`WebKit ${browser.version()}`);
  for (let i = 0; i < RUNS; i++) {
    const page = await browser.newPage();
    await page.goto(`${origin}/host.html`);
    await page.waitForFunction(() => document.querySelector("hyperframes-player") !== null);
    await page.waitForTimeout(8000); // media load
    const done = new Promise<void>((r) => (resolveResult = r));
    await page.click("#go");
    await done;
    await page.close();
  }
  await browser.close();
}

if (arg("browser", "webkit") === "webkit") await drivePlaywright();
else {
  console.log(`open ${origin}/host.html in Safari, click Play (${RUNS} runs)`);
  while (results.length < RUNS) await new Promise<void>((r) => (resolveResult = r));
}
console.log(`${edit.name}: ${edit.takes.length} takes, ${edit.duration} s, ${RUNS} runs`);
for (const [i, r] of results.entries()) {
  console.log(`run ${i + 1}`, JSON.stringify(measure(r, cuts)));
  if (TRACE) {
    const w = measure(r, cuts).worst[0];
    const at = w ? Number(w.split("s:")[0]) : 0;
    const j = r.samples.findIndex((x) => x[1] >= at);
    for (const x of r.samples.slice(Math.max(0, j - 6), j + 40))
      console.log(`  ${(x[0] - r.t0).toFixed(0)}ms t=${x[1].toFixed(3)} ${x[2]}`);
  }
}
server.stop(true);
process.exit(0);
