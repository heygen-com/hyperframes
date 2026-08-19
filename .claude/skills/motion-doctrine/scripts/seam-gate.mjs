#!/usr/bin/env node
// seam-gate.mjs — numeric Seam Gate verifier for HyperFrames films (motion-doctrine).
// Zero npm dependencies: drives chrome-headless-shell over raw CDP (node >= 22).
//
//   verify  node seam-gate.mjs verify --ledger ledger.json --project <dir> [--json]
//           node seam-gate.mjs verify --ledger ledger.json --url http://localhost:5244
//   probe   node seam-gate.mjs probe --t 44.8 --project <dir>   # list movers around a cut
//
// --project spawns a FRESH preview server (avoids the stale-bundle cache) with
// HYPERFRAME_RUNTIME_URL unset. --url reuses a running server: restart it after
// comp edits or you verify a stale build.
// Ledger schema: see references/seam-gate.md next to this skill.

import { spawn } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------- args ----------
const argv = process.argv.slice(2);
const mode = argv[0];
function flag(name, dflt) {
  const i = argv.indexOf("--" + name);
  return i >= 0 ? argv[i + 1] : dflt;
}
const has = (name) => argv.includes("--" + name);
if (!["verify", "probe"].includes(mode)) {
  console.error(
    "usage: seam-gate.mjs verify --ledger ledger.json (--project <dir> | --url <preview-url>) [--json]",
  );
  console.error(
    "       seam-gate.mjs probe --t <seconds> (--project <dir> | --url <preview-url>) [--window 0.1]",
  );
  process.exit(2);
}

const FPS = Number(flag("fps", 30));
const DT = 1 / FPS;
const VIS = 0.04; // cumulative opacity below this = invisible
const EPS_XY = 15; // px/s — slower than this = "static"
const EPS_Z = 0.04; // effective-scale units/s
const SPEED_RATIO = 3; // entry/exit velocity ratio beyond this = WARN
const CARRIER_POS_TOL = 12; // px center offset
const CARRIER_SIZE_TOL = 0.05;

const cleanup = [];
process.on("exit", () =>
  cleanup.forEach((fn) => {
    try {
      fn();
    } catch {}
  }),
);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

// ---------- preview server ----------
async function httpOk(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  let base = flag("url", null);
  if (!base) {
    const project = flag("project", null);
    if (!project) throw new Error("need --url or --project");
    const port = 5380 + Math.floor(Math.random() * 20);
    const env = { ...process.env };
    delete env.HYPERFRAME_RUNTIME_URL; // wrong value fails silently as 200 HTML
    const cmd = flag("server-cmd", `npx --yes hyperframes preview --no-open --port ${port}`);
    const child = spawn("sh", ["-c", cmd.replace(/\{port\}/g, String(port))], {
      cwd: project,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    cleanup.push(() => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    });
    base = `http://localhost:${port}`;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (await httpOk(base + "/api/projects")) break;
      if (child.exitCode !== null) throw new Error("preview server exited early");
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!(await httpOk(base + "/api/projects")))
      throw new Error("preview server never became ready");
  }
  base = base.replace(/\/$/, "");
  let compUrl = flag("comp-url", null);
  if (!compUrl) {
    const r = await fetch(base + "/api/projects");
    const j = await r.json();
    const id = j?.projects?.[0]?.id;
    if (!id) throw new Error("could not resolve project id from /api/projects");
    compUrl = `${base}/api/projects/${id}/preview/comp/index.html`;
  }
  return compUrl;
}

// ---------- chrome ----------
function findChrome() {
  if (process.env.CHROME_PATH) return { bin: process.env.CHROME_PATH, headlessFlag: true };
  const cache = join(homedir(), ".cache", "puppeteer");
  for (const kind of ["chrome-headless-shell", "chrome"]) {
    const root = join(cache, kind);
    if (!existsSync(root)) continue;
    const versions = readdirSync(root).sort().reverse();
    for (const v of versions) {
      const vdir = join(root, v);
      for (const plat of readdirSync(vdir)) {
        const bin =
          kind === "chrome-headless-shell"
            ? join(vdir, plat, "chrome-headless-shell")
            : join(
                vdir,
                plat,
                "Google Chrome for Testing.app",
                "Contents",
                "MacOS",
                "Google Chrome for Testing",
              );
        if (existsSync(bin)) return { bin, headlessFlag: kind !== "chrome-headless-shell" };
      }
    }
  }
  const sys = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(sys)) return { bin: sys, headlessFlag: true };
  throw new Error("no Chrome found (set CHROME_PATH)");
}

async function launchChrome() {
  const { bin, headlessFlag } = findChrome();
  const args = [
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--mute-audio",
    "--hide-scrollbars",
    "--disable-extensions",
    "--window-size=1920,1080",
    "about:blank",
  ];
  if (headlessFlag) args.unshift("--headless=new");
  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
  cleanup.push(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("chrome DevTools endpoint timeout")), 20_000);
    child.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(t);
        resolve(m[1]);
      }
    });
    child.on("exit", () => reject(new Error("chrome exited: " + buf.slice(-400))));
  });
  return wsUrl;
}

// ---------- minimal CDP client ----------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error("ws connect failed"));
    });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method) {
        c.listeners.forEach((l) => l(msg));
      }
    };
    return c;
  }
  send(method, params = {}, sessionId, timeoutMs = 30_000) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(method + " timeout"));
        }
      }, timeoutMs);
    });
  }
  waitEvent(method, sessionId, timeoutMs = 30_000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("waiting " + method + " timeout")), timeoutMs);
      const l = (msg) => {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) {
          clearTimeout(t);
          this.listeners = this.listeners.filter((x) => x !== l);
          res(msg.params);
        }
      };
      this.listeners.push(l);
    });
  }
}

async function openPage(compUrl) {
  const cdp = await CDP.connect(await launchChrome());
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  const loaded = cdp.waitEvent("Page.loadEventFired", sessionId, 60_000);
  await cdp.send("Page.navigate", { url: compUrl }, sessionId);
  await loaded;
  const evalJs = async (expr, awaitPromise = false) => {
    const r = await cdp.send(
      "Runtime.evaluate",
      { expression: expr, returnByValue: true, awaitPromise },
      sessionId,
      60_000,
    );
    if (r.exceptionDetails)
      throw new Error(
        "page error: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text),
      );
    return r.result.value;
  };
  // wait for the HF runtime player
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await evalJs("!!(window.__playerReady && window.__renderReady && window.__player)")) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!(await evalJs("!!window.__player")))
    throw new Error("HF runtime player never appeared — is this a preview comp URL?");
  await evalJs("document.fonts.ready.then(()=>true)", true);
  await evalJs(HARNESS);
  return { evalJs };
}

// ---------- in-page harness ----------
const HARNESS = `window.__seamGate = {
  seek(t){ __player.pause(); __player.seek(t); void document.body.offsetHeight; },
  cumOp(el){
    let op = 1, n = el;
    while (n && n.nodeType === 1) {
      const c = getComputedStyle(n);
      if (c.display === "none" || c.visibility === "hidden") return 0;
      op *= parseFloat(c.opacity || "1");
      n = n.parentElement;
    }
    return op;
  },
  read(sel){
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const lw = el.offsetWidth || r.width || 1;
    const onscreen = r.right > 0 && r.bottom > 0 && r.left < 1920 && r.top < 1080;
    return { cx: r.x + r.width/2, cy: r.y + r.height/2, w: r.width, h: r.height,
             op: this.cumOp(el), es: r.width / lw, onscreen };
  },
  sample(t, sels){ this.seek(t); const o = {}; for (const s of sels) o[s] = this.read(s); return o; },
  pathOf(el){
    if (el.id) return "#" + CSS.escape(el.id);
    const hf = el.getAttribute && el.getAttribute("data-hf-id");
    if (hf) return '[data-hf-id="' + hf + '"]';
    let p = [], n = el, depth = 0;
    while (n && n.nodeType === 1 && depth < 5) {
      if (n.id) { p.unshift("#" + CSS.escape(n.id)); break; }
      const h2 = n.getAttribute("data-hf-id");
      if (h2) { p.unshift('[data-hf-id="' + h2 + '"]'); break; }
      const kids = n.parentElement ? [...n.parentElement.children] : [n];
      p.unshift(n.tagName.toLowerCase() + ":nth-child(" + (kids.indexOf(n) + 1) + ")");
      n = n.parentElement; depth++;
    }
    return p.join(">");
  },
  scan(t, rootSel, cap){
    this.seek(t);
    const root = document.querySelector(rootSel || "#root");
    if (!root) return [];
    const els = [root, ...root.querySelectorAll("*")].slice(0, cap || 900);
    const out = [];
    for (const el of els) {
      if (/^(SCRIPT|STYLE|AUDIO|LINK|META)$/.test(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 32 && r.height < 32) continue;
      const op = this.cumOp(el);
      const lw = el.offsetWidth || r.width || 1;
      out.push({ sel: this.pathOf(el), cx: r.x + r.width/2, cy: r.y + r.height/2,
                 w: r.width, h: r.height, op, es: r.width / lw });
    }
    return out;
  }
};true`;

// ---------- measurement helpers ----------
const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const visible = (m) => !!m && m.op > VIS && m.w * m.h > 16 && m.onscreen !== false;
function velocity(m1, m2, dt, axis) {
  if (!m1 || !m2) return null;
  if (axis === "x") return (m2.cx - m1.cx) / dt;
  if (axis === "y") return (m2.cy - m1.cy) / dt;
  return (m2.es - m1.es) / dt; // z
}
const eps = (axis) => (axis === "z" ? EPS_Z : EPS_XY);
const fmtV = (v, axis) =>
  v === null ? "n/a" : axis === "z" ? v.toFixed(3) + " es/s" : v.toFixed(0) + " px/s";

// ---------- verify ----------
async function verify() {
  const ledgerPath = flag("ledger", "ledger.json");
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const fps = ledger.fps || FPS,
    dt = 1 / fps;
  const compUrl = await ensureServer();
  const { evalJs } = await openPage(compUrl);
  const results = [];

  for (const seam of ledger.seams) {
    const rows = [];
    const add = (check, status, detail) => rows.push({ check, status, detail });
    const cut = seam.cut;
    const type = seam.type || "cut";
    const tA1 = Math.max(0, cut - 0.1),
      tA2 = Math.max(0, cut - dt);
    const tB1 = cut + dt,
      tB2 = cut + 0.1;
    const sels = [
      seam.exit?.selector,
      seam.entry?.selector,
      seam.carrier?.out,
      seam.carrier?.in,
    ].filter(Boolean);
    const S = {};
    for (const t of [tA1, tA2, tB1, tB2])
      S[t] = await evalJs(`__seamGate.sample(${t}, ${JSON.stringify([...new Set(sels)])})`);

    if (type === "cut") {
      const ex = seam.exit,
        en = seam.entry;
      // 0 — ledger row itself
      if (ex.axis !== en.axis || ex.dir !== en.dir)
        add(
          "ledger",
          "FAIL",
          `exit ${ex.axis}${ex.dir > 0 ? "+" : "-"} vs entry ${en.axis}${en.dir > 0 ? "+" : "-"} — mirrored/mixed vector in the PLAN`,
        );
      else add("ledger", "PASS", `${ex.axis}${ex.dir > 0 ? "+" : "-"} both sides`);

      for (const [side, cfg, m1, m2, t1, t2] of [
        ["exit", ex, S[tA1][ex.selector], S[tA2][ex.selector], tA1, tA2],
        ["entry", en, S[tB1][en.selector], S[tB2][en.selector], tB1, tB2],
      ]) {
        if (!m1 || !m2) {
          add(side, "FAIL", `selector ${cfg.selector} not found`);
          continue;
        }
        const v = velocity(m1, m2, t2 - t1, cfg.axis);
        const moving = Math.abs(v) >= eps(cfg.axis);
        const vizOk = side === "exit" ? visible(m1) : visible(m2);
        if (!vizOk)
          add(
            side + "-visible",
            "FAIL",
            `${cfg.selector} not visible in its window (op ${(side === "exit" ? m1 : m2)?.op?.toFixed(2)})`,
          );
        if (!moving)
          add(
            side + "-moving",
            "FAIL",
            `${cfg.selector} static at the cut (${fmtV(v, cfg.axis)}) — ${side === "exit" ? "exit settled before the boundary" : "entry starts from rest"}`,
          );
        else if (sgn(v) !== cfg.dir)
          add(
            side + "-direction",
            "FAIL",
            `${cfg.selector} moving ${fmtV(v, cfg.axis)} — opposite of ledger dir ${cfg.dir > 0 ? "+" : "-"}${cfg.axis === "z" ? " (mirrored zoom)" : ""}`,
          );
        else
          add(
            side + "-vector",
            "PASS",
            `${fmtV(v, cfg.axis)} ${cfg.axis}${cfg.dir > 0 ? "+" : "-"}`,
          );
        if (side === "exit") seam.__vExit = v;
        else seam.__vEntry = v;
      }

      // speed match
      if (seam.__vExit != null && seam.__vEntry != null && Math.abs(seam.__vExit) > 0) {
        const ratio = Math.abs(seam.__vEntry) / Math.abs(seam.__vExit);
        if (ratio > SPEED_RATIO || ratio < 1 / SPEED_RATIO)
          add("speed-match", "WARN", `entry/exit velocity ratio ${ratio.toFixed(2)} (want ~1)`);
        else add("speed-match", "PASS", `ratio ${ratio.toFixed(2)}`);
      }

      // zero overlap
      const enPre = S[tA2][en.selector],
        exPost = S[tB1][ex.selector];
      if (visible(enPre))
        add(
          "zero-overlap",
          "FAIL",
          `incoming ${en.selector} already visible at cut-1f (op ${enPre.op.toFixed(2)}) while outgoing still on screen — reads as a dissolve`,
        );
      else if (visible(exPost))
        add(
          "zero-overlap",
          "FAIL",
          `outgoing ${ex.selector} still visible at cut+1f (op ${exPost.op.toFixed(2)})`,
        );
      else add("zero-overlap", "PASS", "one side visible per frame");

      // Z-sign scan: the incoming scene's OWN entrances must not fight the seam's Z sign
      if (en.axis === "z") {
        const scanRoot = en.scanRoot || en.selector;
        const s1 = await evalJs(`__seamGate.scan(${tB1}, ${JSON.stringify(scanRoot)})`);
        const s2 = await evalJs(`__seamGate.scan(${tB2}, ${JSON.stringify(scanRoot)})`);
        const m1 = new Map(s1.map((e) => [e.sel, e]));
        const offenders = [];
        for (const e2 of s2) {
          const e1 = m1.get(e2.sel);
          if (!e1 || e2.op <= 0.1) continue;
          const vs = (e2.es - e1.es) / (tB2 - tB1);
          if (Math.abs(vs) >= EPS_Z && sgn(vs) !== en.dir)
            offenders.push(`${e2.sel} (${vs.toFixed(3)} es/s)`);
        }
        if (offenders.length)
          add(
            "z-sign-scan",
            "FAIL",
            `elements scaling AGAINST the seam's Z sign in the entry window: ${offenders.slice(0, 5).join(", ")}${offenders.length > 5 ? ` +${offenders.length - 5} more` : ""}`,
          );
        else add("z-sign-scan", "PASS", "no sign-fighting entrances");
      }
    }

    // carrier continuity (any seam type that declares one; the whole check for match-cut/morph)
    if (seam.carrier) {
      const out = S[tA2][seam.carrier.out],
        inn = S[tB1][seam.carrier.in];
      if (!out || !inn) add("carrier", "FAIL", "carrier selector not found");
      else {
        const dx = Math.abs(out.cx - inn.cx),
          dy = Math.abs(out.cy - inn.cy);
        const ds = Math.abs(out.w - inn.w) / Math.max(out.w, 1);
        if (dx > CARRIER_POS_TOL || dy > CARRIER_POS_TOL)
          add(
            "carrier-position",
            "FAIL",
            `center off by ${dx.toFixed(0)},${dy.toFixed(0)}px across the cut`,
          );
        else if (ds > CARRIER_SIZE_TOL)
          add(
            "carrier-size",
            "FAIL",
            `size differs ${(ds * 100).toFixed(1)}% across the cut (ancestor scale?)`,
          );
        else
          add(
            "carrier",
            "PASS",
            `Δpos ${dx.toFixed(1)},${dy.toFixed(1)}px Δsize ${(ds * 100).toFixed(1)}%`,
          );
      }
    }

    if (type !== "cut" && !seam.carrier)
      add("carrier", "WARN", `type "${type}" without a carrier — nothing to verify`);

    results.push({ id: seam.id, cut, type, rows });
  }
  return results;
}

// ---------- probe ----------
async function probe() {
  const t = Number(flag("t"));
  if (!Number.isFinite(t)) throw new Error("probe needs --t <seconds>");
  const win = Number(flag("window", 0.1));
  const compUrl = await ensureServer();
  const { evalJs } = await openPage(compUrl);
  const dt = DT;
  const scans = {};
  for (const tt of [t - win, t - dt, t + dt, t + win])
    scans[tt] = await evalJs(`__seamGate.scan(${Math.max(0, tt)}, "#root")`);
  const join = (a, b) => {
    const m = new Map(a.map((e) => [e.sel, e]));
    return b.map((e2) => ({ e1: m.get(e2.sel), e2 })).filter((p) => p.e1);
  };
  const movers = (a, b, span) =>
    join(a, b)
      .map(({ e1, e2 }) => ({
        sel: e2.sel,
        vx: (e2.cx - e1.cx) / span,
        vy: (e2.cy - e1.cy) / span,
        vs: (e2.es - e1.es) / span,
        op1: e1.op,
        op2: e2.op,
        w: e2.w,
        h: e2.h,
      }))
      .filter(
        (m) =>
          (m.op1 > VIS || m.op2 > VIS) &&
          (Math.abs(m.vx) > EPS_XY ||
            Math.abs(m.vy) > EPS_XY ||
            Math.abs(m.vs) > EPS_Z ||
            Math.abs(m.op2 - m.op1) > 0.1),
      )
      .sort(
        (x, y) =>
          Math.abs(y.vx) +
          Math.abs(y.vy) +
          Math.abs(y.vs) * 800 -
          (Math.abs(x.vx) + Math.abs(x.vy) + Math.abs(x.vs) * 800),
      )
      .slice(0, 14);
  const fmt = (m) =>
    `  ${m.sel.padEnd(44)} vx ${m.vx.toFixed(0).padStart(6)}  vy ${m.vy.toFixed(0).padStart(6)}  vscale ${m.vs.toFixed(3).padStart(7)}  op ${m.op1.toFixed(2)}→${m.op2.toFixed(2)}  (${m.w.toFixed(0)}×${m.h.toFixed(0)})`;
  console.log(`\nPROBE @ ${t}s (window ±${win}s, 1f = ${dt.toFixed(3)}s)`);
  console.log(`\n— OUTGOING side (${(t - win).toFixed(2)} → ${(t - dt).toFixed(2)}) — movers:`);
  movers(scans[t - win], scans[t - dt], win - dt).forEach((m) => console.log(fmt(m)));
  console.log(`\n— INCOMING side (${(t + dt).toFixed(2)} → ${(t + win).toFixed(2)}) — movers:`);
  movers(scans[t + dt], scans[t + win], win - dt).forEach((m) => console.log(fmt(m)));
  console.log(
    `\nUse these selectors + signs to write the ledger row (x-: left, y-: up, scale+: push, scale-: pull).`,
  );
}

// ---------- main ----------
try {
  if (mode === "probe") {
    await probe();
  } else {
    const results = await verify();
    if (has("json")) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      let fails = 0,
        warns = 0;
      for (const r of results) {
        const bad = r.rows.filter((x) => x.status === "FAIL").length;
        fails += bad;
        warns += r.rows.filter((x) => x.status === "WARN").length;
        console.log(
          `\n■ ${r.id}  (cut @${r.cut}s, ${r.type})  ${bad ? "✗ " + bad + " FAIL" : "✓"}`,
        );
        for (const row of r.rows)
          console.log(`   ${row.status.padEnd(4)} ${row.check.padEnd(16)} ${row.detail}`);
      }
      console.log(
        `\n${fails ? "SEAM GATE: FAILED" : "SEAM GATE: PASSED"} — ${fails} fail, ${warns} warn across ${results.length} seams`,
      );
    }
    process.exit(results.some((r) => r.rows.some((x) => x.status === "FAIL")) ? 1 : 0);
  }
  process.exit(0);
} catch (e) {
  console.error("seam-gate error:", e.message);
  process.exit(2);
}
