#!/usr/bin/env node
// Design-panel e2e smoke: drives agent-browser against a running preview of the
// design-panel-qa fixture and asserts selection + one representative input per
// panel section persists to disk.
//
// Usage:
//   1. Copy fixtures/design-panel-qa to a scratch dir OUTSIDE the repo.
//   2. Start the CLI there: node <repo>/packages/cli/dist/cli.js preview --no-open
//   3. STUDIO_URL=http://localhost:3002 PROJECT_DIR=<scratch dir> node design-panel.mjs
//
// Requires the agent-browser CLI on PATH. Exits non-zero on any failed cell.
// Automation notes (learned the hard way, see design-panel-qa-matrix.md):
// - Inspector defaults OFF on fresh load; the script toggles it on.
// - Selection commits on real CDP mouse events at canvas coordinates; element-ref
//   clicks on off-viewport nodes can hit sidebar helper buttons instead.
// - Commit fires on Enter/blur only when the draft differs from the last value.
// - Range inputs need input+change+pointerup; selects need change.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const STUDIO_URL = process.env.STUDIO_URL || "http://localhost:3002";
const PROJECT_DIR = process.env.PROJECT_DIR;
if (!PROJECT_DIR) {
  console.error("PROJECT_DIR env var is required (scratch copy of the design-panel-qa fixture)");
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function ab(...args) {
  try {
    return execFileSync("agent-browser", args, { encoding: "utf8", timeout: 30000 });
  } catch (e) {
    return "ERR: " + (e.stdout || "") + (e.stderr || e.message);
  }
}
function abEval(code) {
  const out = ab("eval", code).trim();
  let v;
  try {
    v = JSON.parse(out);
  } catch {
    return out;
  }
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}
function check(id, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? " " + detail : ""}`);
  if (!ok) failures += 1;
}
function disk(file, needle) {
  try {
    return readFileSync(`${PROJECT_DIR}/${file}`, "utf8").includes(needle);
  } catch {
    return false;
  }
}

const HELPERS = String.raw`
(() => {
  window.__patchLog = window.__patchLog || [];
  if (!window.__qaShim) {
    window.__qaShim = true;
    const orig = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      const isMut = url.includes('file-mutations') || url.includes('gsap-mutations') || (args[1] && args[1].method && args[1].method !== 'GET' && url.includes('/api/'));
      let body = null;
      if (isMut && args[1] && typeof args[1].body === 'string') body = args[1].body.slice(0, 1500);
      const res = await orig.apply(this, args);
      if (isMut) {
        const clone = res.clone();
        let respText = '';
        try { respText = (await clone.text()).slice(0, 300); } catch {}
        window.__patchLog.push({ t: Date.now(), url, status: res.status, req: body, resp: respText });
      }
      return res;
    };
  }
  const qa = {};
  qa.frame = () => {
    const frames = [];
    const collect = (root) => {
      for (const f of root.querySelectorAll('iframe')) { try { if (f.contentDocument && f.contentDocument.querySelector('#design-panel-qa')) frames.push(f); } catch {} }
      for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) collect(el.shadowRoot); }
    };
    collect(document);
    return frames.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] || null;
  };
  qa.coords = (sel) => {
    const f = qa.frame();
    if (!f) return null;
    const el = f.contentDocument.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    const scale = fr.width / 1920;
    const x = fr.x + (r.x + Math.min(r.width, 80) / 2) * scale;
    const y = fr.y + (r.y + Math.min(r.height, 60) / 2) * scale;
    if (x < fr.x || x > fr.x + fr.width || y < fr.y || y > fr.y + fr.height) return null;
    return [Math.round(x), Math.round(y)];
  };
  qa.lastSel = () => {
    const s = window.__patchLog.filter(p => p.url.includes('/selection')).slice(-1)[0];
    if (!s) return null;
    const req = s.req || '';
    if (req.includes('"selection":null')) return { nullSel: true };
    const m = (k) => { const r = new RegExp('"' + k + '":"([^"]*)"').exec(req); return r ? r[1] : null; };
    return { label: m('label'), selector: m('selector'), hfId: m('hfId'), src: m('sourceFile') };
  };
  qa.clear = () => { window.__patchLog.length = 0; return 'cleared'; };
  qa.sectionInputs = (title) => {
    const h3 = [...document.querySelectorAll('h3')].find(h => h.textContent.trim() === title);
    if (!h3) return null;
    const headerBtn = h3.closest('button') || h3;
    const inputs = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    walker.currentNode = headerBtn;
    let n;
    while ((n = walker.nextNode())) {
      if (n.tagName === 'H3' && n !== h3) break;
      if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT') inputs.push(n);
    }
    return inputs;
  };
  qa.ensureSection = (title) => {
    const h3 = [...document.querySelectorAll('h3')].find(h => h.textContent.trim() === title);
    if (!h3) return 'no section: ' + title;
    const inputs = qa.sectionInputs(title);
    if (inputs && inputs.length) return 'open';
    (h3.closest('button') || h3).click();
    return 'clicked';
  };
  qa.setEl = (el, value) => {
    if (el.tagName === 'SELECT') {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'select set';
    }
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (el.type === 'range') {
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    } else {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      el.blur();
    }
    return 'input set';
  };
  qa.setInputWhereValue = (title, current, value) => {
    const inputs = qa.sectionInputs(title);
    if (!inputs) return 'no section';
    const el = inputs.find(e => String(e.value) === current);
    if (!el) return 'no input with value ' + current + ' in ' + title;
    return qa.setEl(el, value);
  };
  qa.enableInspector = () => {
    if ([...document.querySelectorAll('h3, [class*="panel"]')].length && document.body.textContent.includes('Select an element')) return 'on';
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Inspector');
    if (!btn) return 'no inspector button';
    btn.click();
    return 'toggled';
  };
  window.__qa = qa;
  return 'qa ready';
})()`;

async function select(sel) {
  abEval("window.__qa.clear()");
  const coords = abEval(`window.__qa.coords(${JSON.stringify(sel)})`);
  if (!Array.isArray(coords)) return { error: "no coords" };
  ab("mouse", "move", String(coords[0]), String(coords[1]));
  ab("mouse", "down", "left");
  await sleep(150);
  ab("mouse", "up", "left");
  await sleep(1400);
  return abEval("window.__qa.lastSel()");
}
async function commit(section, whereValue, value) {
  abEval("window.__qa.clear()");
  abEval(`window.__qa.ensureSection(${JSON.stringify(section)})`);
  await sleep(600);
  const r = abEval(
    `window.__qa.setInputWhereValue(${JSON.stringify(section)}, ${JSON.stringify(whereValue)}, ${JSON.stringify(value)})`,
  );
  await sleep(2000);
  return r;
}

// fallow-ignore-next-line complexity
async function main() {
  ab("open", `${STUDIO_URL}/?v=e2e${Date.now()}`);
  await sleep(6000);
  abEval(HELPERS);
  abEval("window.__qa.enableInspector()");
  await sleep(1500);

  let s = await select("#qa-headline");
  check("select.headline", s && s.selector === "#qa-headline", JSON.stringify(s));
  let r = await commit("Text", "48px", "72px");
  check("text.size", disk("index.html", "font-size: 72px"), `set=${r}`);

  s = await select("#qa-shape");
  check("select.shape", s && s.selector === "#qa-shape", JSON.stringify(s));
  r = await commit("Transparency", "100", "80");
  check("style.opacity", disk("index.html", "opacity: 0.8"), `set=${r}`);
  r = await commit("Radius", "16", "24");
  check("style.radius", disk("index.html", "border-radius: 24px"), `set=${r}`);

  s = await select("#qa-video");
  check("select.video", s && s.selector === "#qa-video", JSON.stringify(s));
  r = await commit("Video", "50", "80");
  check("media.volume", disk("index.html", 'data-volume="0.8"'), `set=${r}`);

  s = await select("#qa-sub-title");
  check(
    "select.sub-title",
    s && s.selector === "#qa-sub-title" && s.src === "compositions/qa-sub.html",
    JSON.stringify(s),
  );
  r = await commit("Text", "36px", "48px");
  check("sub.text-size", disk("compositions/qa-sub.html", "font-size: 48px"), `set=${r}`);

  // Reload survival for the headline edit.
  ab("open", `${STUDIO_URL}/?v=r${Date.now()}`);
  await sleep(5000);
  abEval(HELPERS);
  const survived = abEval(
    `(() => { const f = window.__qa.frame(); const el = f && f.contentDocument.querySelector('#qa-headline'); return el ? f.contentWindow.getComputedStyle(el).fontSize : null; })()`,
  );
  check("reload.survival", survived === "72px", String(survived));

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error("RUNNER ERROR", e);
  process.exit(1);
});
