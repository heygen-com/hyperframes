#!/usr/bin/env node
// reextract-design.mjs — re-run designStyleExtractor.ts offline against a capture's saved page.html (via CDP).
//   node reextract-design.mjs --capture ../stripe-capture [--chrome <path>]

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const die = (m) => {
  console.error(`✗ ${m}`);
  process.exit(1);
};

const captureDir = resolve(arg("capture", ""));
if (!captureDir || !existsSync(captureDir)) die(`--capture <dir> required (got ${captureDir})`);
const pageHtml = join(captureDir, "extracted/page.html");
if (!existsSync(pageHtml))
  die(`no extracted/page.html in ${captureDir} — cannot re-extract offline`);
const outPath = join(captureDir, "extracted/design-styles.json");

const CHROME = arg("chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
if (!existsSync(CHROME)) die(`Chrome not found at ${CHROME} — pass --chrome <path>`);

// ── source the extraction script from the engine (single source of truth) ────────
const extractorTs = resolve("../packages/cli/src/capture/designStyleExtractor.ts");
const tsSrc = existsSync(extractorTs)
  ? readFileSync(extractorTs, "utf8")
  : die(`engine extractor not found at ${extractorTs}`);
const m = tsSrc.match(/EXTRACT_DESIGN_STYLES_SCRIPT\s*=\s*`([\s\S]*?)`;/);
if (!m) die("could not locate EXTRACT_DESIGN_STYLES_SCRIPT template literal in engine source");
// the .ts stores the script as a template literal with escaped backslashes (\\( etc.); re-interpret
// it as a template literal to recover the runtime string the engine actually evaluates.
const script = new Function(`return \`${m[1]}\``)();

// ── minimal CDP-over-WebSocket client (no deps) ──────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpEval(ws, expression, { returnByValue = true, awaitPromise = false } = {}) {
  return sendCmd(ws, "Runtime.evaluate", { expression, returnByValue, awaitPromise });
}

let msgId = 0;
const pending = new Map();
function sendCmd(ws, method, params = {}) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rej(new Error(`CDP ${method} timed out`));
      }
    }, 30000);
  });
}

async function run() {
  const profile = mkdtempSync(join(tmpdir(), "reextract-"));
  const fileUrl = `file://${pageHtml}`;
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--window-size=1920,1080",
    fileUrl,
  ]);

  // Chrome prints "DevTools listening on ws://127.0.0.1:<port>/devtools/browser/..." to stderr.
  const port = await new Promise((res, rej) => {
    let buf = "";
    const to = setTimeout(() => rej(new Error("timed out waiting for DevTools endpoint")), 15000);
    chrome.stderr.on("data", (d) => {
      buf += d.toString();
      const mm = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (mm) {
        clearTimeout(to);
        res(Number(mm[1]));
      }
    });
    chrome.on("exit", (c) => rej(new Error(`Chrome exited early (code ${c})`)));
  });

  // Find the page target's WebSocket URL.
  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = list.find((t) => t.type === "page" && String(t.url).startsWith("file://"));
      if (target?.webSocketDebuggerUrl) wsUrl = target.webSocketDebuggerUrl;
    } catch {
      // devtools http not ready yet
    }
    if (!wsUrl) await sleep(150);
  }
  if (!wsUrl) throw new Error("no page target found via /json/list");

  const ws = new WebSocket(wsUrl);
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message));
      else res(msg.result);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("ws connect failed")), { once: true });
  });

  // Wait for the saved DOM to finish parsing (offline: remote assets 404, but CSS is inlined so
  // computed styles resolve). Cap the wait so a hanging resource can't stall us.
  for (let i = 0; i < 40; i++) {
    const r = await cdpEval(ws, "document.readyState");
    if (r?.result?.value === "complete") break;
    await sleep(150);
  }
  await sleep(300);

  const out = await cdpEval(ws, script, { returnByValue: true });
  if (out?.exceptionDetails) throw new Error(`extractor threw: ${out.exceptionDetails.text}`);
  const styles = out.result.value;

  // offline extract is faithful except typography (unstyled text leaks Chrome defaults) — keep the live type ramp.
  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
  const merged = { ...styles };
  if (Array.isArray(existing.typography) && existing.typography.length) {
    merged.typography = existing.typography;
  }
  writeFileSync(outPath, JSON.stringify(merged, null, 2));
  ws.close();
  chrome.kill("SIGKILL");

  console.log(
    `✓ re-extracted ${outPath} — buttons:${styles.buttons.length} cards:${styles.cards.length} backgrounds:${styles.backgrounds?.length ?? 0} (typography preserved)`,
  );
}

run().catch((e) => die(e.message));
