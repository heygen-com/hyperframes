import { openComposition } from "@hyperframes/sdk";
import { createFileAdapter } from "./fileAdapter.js";
import type { Composition, GsapTweenSpec, PreviewAdapter, FindQuery } from "@hyperframes/sdk";
import { parseGsapScriptAcorn } from "@hyperframes/core/gsap-parser-acorn";
import type { GsapAnimation } from "@hyperframes/core";
import gsapRaw from "gsap/dist/gsap.min.js?raw";

// ── Demo composition ──────────────────────────────────────────────────────────

const DEMO_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width:1280px;height:720px;background:#111827;position:relative;" data-duration="6">
  <style>.badge{background:#3b82f6;border-radius:6px;}</style>
  <div data-hf-id="hf-headline" style="position:absolute;top:200px;left:140px;font-size:72px;font-weight:700;color:#f9fafb;font-family:system-ui,sans-serif;">SDK Playground</div>
  <div data-hf-id="hf-sub" style="position:absolute;top:300px;left:142px;font-size:28px;color:#9ca3af;font-family:system-ui,sans-serif;">@hyperframes/sdk &middot; Phase 3b</div>
  <div data-hf-id="hf-badge" class="badge" style="position:absolute;top:390px;left:142px;padding:10px 24px;font-size:20px;font-weight:600;color:#fff;font-family:system-ui,sans-serif;">v0.6</div>
  <script>
var tl = gsap.timeline({ paused: true });
var headline = document.querySelector("[data-hf-id='hf-headline']");
var sub = document.querySelector("[data-hf-id='hf-sub']");
var badge = document.querySelector("[data-hf-id='hf-badge']");
tl.from(headline, { y: 40, opacity: 0, duration: 0.7, ease: "power3.out" }, 0);
tl.from(sub, { y: 20, opacity: 0, duration: 0.5, ease: "power3.out" }, 0.2);
tl.from(badge, { scale: 0.85, opacity: 0, duration: 0.4, ease: "back.out(1.5)" }, 0.4);
window.__timelines = window.__timelines || {};
window.__timelines["demo"] = tl;
  </script>
</div>`.trim();

// ── App state ─────────────────────────────────────────────────────────────────

let comp: Composition | null = null;
let playgroundPreview: PlaygroundPreview | null = null;
let selectedId: string | null = null;
let playMode = false;
let patchCount = 0;
let activeTab: "properties" | "ops" = "properties";
let lastTweenId = "";
let updateTimer: ReturnType<typeof setTimeout> | undefined;
let timelineDuration = 0;
let prevPlayPct = 0;

// ── Small value helpers ─────────────────────────────────────────────────────

/** parseFloat with a numeric fallback — isolates the `?? / ||` so callers stay simple. */
function numOr(value: string | number | undefined, fallback: number): number {
  const n = typeof value === "number" ? value : parseFloat(value ?? "");
  return isNaN(n) ? fallback : n;
}

/** Coerce a raw input string to a number when it parses, else keep the string. */
function coerceNum(raw: string): string | number {
  const n = Number(raw);
  return isNaN(n) ? raw : n;
}

function getFrame(): HTMLIFrameElement {
  return document.getElementById("preview-frame") as HTMLIFrameElement;
}

function postToFrame(message: unknown): void {
  getFrame().contentWindow?.postMessage(message, "*");
}

// ── Preview adapter ───────────────────────────────────────────────────────────

class PlaygroundPreview implements PreviewAdapter {
  private handlers: Array<(ids: string[]) => void> = [];

  elementAtPoint(_x: number, _y: number) {
    return null;
  }
  applyDraft(_id: string, _props: { dx?: number; dy?: number; width?: number; height?: number }) {}
  commitPreview() {}
  cancelPreview() {}

  select(ids: string[], _opts?: { additive?: boolean }) {
    for (const h of this.handlers) h([...ids]);
  }

  on(event: "selection", handler: (ids: string[]) => void): () => void {
    if (event !== "selection") return () => {};
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }
}

// ── Preview iframe ────────────────────────────────────────────────────────────

// Bridge script injected into the preview iframe. Pure string — runs in the
// sandboxed iframe, talks to the parent over postMessage.
const BRIDGE_SCRIPT = `<script>
(function(){
  var _sel=null;
  var _playing=false;
  // drag-aware pointer handling: click = no movement, drag = reposition
  var _drag=null;
  document.addEventListener('mousedown',function(e){
    var el=e.target;
    while(el&&!el.getAttribute('data-hf-id'))el=el.parentElement;
    if(!el)return;
    _drag={id:el.getAttribute('data-hf-id'),el:el,sx:e.clientX,sy:e.clientY,
           ox:parseFloat(el.style.left)||0,oy:parseFloat(el.style.top)||0,moved:false};
  },true);
  document.addEventListener('mousemove',function(e){
    if(!_drag)return;
    var dx=e.clientX-_drag.sx,dy=e.clientY-_drag.sy;
    if(!_drag.moved&&Math.abs(dx)<3&&Math.abs(dy)<3)return;
    _drag.moved=true;
    _drag.el.style.left=(_drag.ox+dx)+'px';
    _drag.el.style.top=(_drag.oy+dy)+'px';
  },true);
  document.addEventListener('mouseup',function(e){
    if(!_drag)return;
    var dx=e.clientX-_drag.sx,dy=e.clientY-_drag.sy;
    if(_drag.moved){
      parent.postMessage({type:'hf:dragend',id:_drag.id,dx:dx,dy:dy},'*');
    } else {
      parent.postMessage({type:'hf:click',id:_drag.id},'*');
    }
    _drag=null;
  },true);
  document.addEventListener('click',function(e){
    // if no hf-id ancestor → deselect
    var el=e.target;
    while(el&&!el.getAttribute('data-hf-id'))el=el.parentElement;
    if(!el)parent.postMessage({type:'hf:deselect'},'*');
  },true);
  function tick(){
    var tls=window.__timelines||{};
    var t=0;
    Object.values(tls).forEach(function(tl){if(tl&&tl.time)t=Math.max(t,tl.time());});
    parent.postMessage({type:'hf:time',time:t},'*');
    if(_playing)requestAnimationFrame(tick);
  }
  window.addEventListener('message',function(e){
    if(!e.data)return;
    if(e.data.type==='hf:select'){
      if(_sel){_sel.style.outline='';_sel.style.outlineOffset='';}
      _sel=e.data.id?document.querySelector('[data-hf-id="'+e.data.id+'"]'):null;
      if(_sel){_sel.style.outline='2px solid #3b82f6';_sel.style.outlineOffset='1px';}
    }
    if(e.data.type==='hf:seek'){
      var tls=window.__timelines||{};
      Object.values(tls).forEach(function(t){if(t&&t.seek)t.seek(e.data.time,false);});
    }
    if(e.data.type==='hf:play'){
      _playing=true;
      var tls=window.__timelines||{};
      Object.values(tls).forEach(function(t){if(t&&t.play)t.play();});
      requestAnimationFrame(tick);
    }
    if(e.data.type==='hf:pause'){
      _playing=false;
      var tls=window.__timelines||{};
      Object.values(tls).forEach(function(t){if(t&&t.pause)t.pause();});
    }
  });
  setTimeout(function(){
    var tls=window.__timelines||{};
    var dur=0;
    Object.values(tls).forEach(function(t){if(t&&t.totalDuration)dur=Math.max(dur,t.totalDuration());});
    parent.postMessage({type:'hf:duration',duration:dur},'*');
    // Seek to end so preview shows final state (not GSAP from-values at t=0)
    if(dur>0){Object.values(tls).forEach(function(t){if(t&&t.seek)t.seek(dur,false);});}
  },120);
})();
</script>`;

function buildSrcdoc(html: string, selId: string | null): string {
  // Baked-in highlight covers the initial render; postMessage updates it live without reload
  const highlight = selId
    ? `[data-hf-id="${selId}"]{outline:2px solid #3b82f6!important;outline-offset:1px;}`
    : "";
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<style>*{margin:0;padding:0}body{overflow:hidden;background:#000}${highlight}</style>
<script>${gsapRaw}</script>
</head><body>
${html}
${BRIDGE_SCRIPT}
</body></html>`;
}

function schedulePreviewUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(updatePreviewNow, 350);
}

function updatePreviewNow() {
  if (!comp) return;
  getFrame().srcdoc = buildSrcdoc(comp.serialize(), selectedId);
}

function sendSelectionToIframe(id: string | null) {
  postToFrame({ type: "hf:select", id });
}

function updatePreviewScale() {
  const outer = document.getElementById("preview-scaler-outer")!;
  const inner = document.getElementById("preview-scaler-inner")!;
  const scale = outer.offsetWidth / 1280;
  inner.style.transform = `scale(${scale})`;
  outer.style.height = `${720 * scale}px`;
}

// ── Log ───────────────────────────────────────────────────────────────────────

const LOG_COLORS: Record<string, string> = {
  patch: "#60a5fa",
  undo: "#fbbf24",
  redo: "#fbbf24",
  selectionchange: "#a78bfa",
  "persist:error": "#f87171",
  op: "#34d399",
  info: "#6b7280",
};

function logBody(data: unknown): HTMLElement {
  if (typeof data === "string") {
    const span = document.createElement("span");
    span.style.color = "#9ca3af";
    span.textContent = data;
    return span;
  }
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(data, null, 2);
  return pre;
}

function logEntry(type: string, data: unknown) {
  const logEl = document.getElementById("log-entries")!;
  const color = LOG_COLORS[type] ?? "#9ca3af";
  const d = document.createElement("div");
  d.className = "log-entry";
  d.style.borderLeftColor = color;
  const typeSpan = document.createElement("span");
  typeSpan.className = "log-type";
  typeSpan.style.color = color;
  typeSpan.textContent = `[${type}]`;
  d.appendChild(typeSpan);
  d.appendChild(logBody(data));
  logEl.prepend(d);
  while (logEl.children.length > 300) logEl.lastElementChild?.remove();
}

// ── Timeline ──────────────────────────────────────────────────────────────────

const TRACK_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#f87171", "#06b6d4"];

function selectorToHfId(selector: string): string | null {
  const m = /\[data-hf-id=['"]([^'"]+)['"]\]/.exec(selector);
  if (m) return m[1];
  if (/^#/.test(selector.trim())) return selector.trim().slice(1);
  return null;
}

function gsapScriptOf(html: string): string | null {
  const m = /<script[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  return m && m[1] ? m[1] : null;
}

function bucketFor(map: Map<string, GsapAnimation[]>, key: string): GsapAnimation[] {
  let b = map.get(key);
  if (!b) {
    b = [];
    map.set(key, b);
  }
  return b;
}

function groupAnimationsById(
  animations: GsapAnimation[],
): { id: string; label: string; tweens: GsapAnimation[] }[] {
  const byId = new Map<string, GsapAnimation[]>();
  for (const anim of animations) {
    const id = selectorToHfId(anim.targetSelector) ?? anim.targetSelector;
    bucketFor(byId, id).push(anim);
  }
  return Array.from(byId.entries()).map(([id, tweens]) => ({ id, label: id, tweens }));
}

function parseTimelineData(): { id: string; label: string; tweens: GsapAnimation[] }[] {
  if (!comp) return [];
  const script = gsapScriptOf(comp.serialize());
  if (!script) return [];
  return groupAnimationsById(parseGsapScriptAcorn(script).animations);
}

/** Prefer element-level timing attrs (written by setTiming) over the GSAP parse. */
function computeTiming(
  ds: string | undefined,
  de: string | undefined,
  fbStart: number,
  fbDur: number,
): { start: number; d: number } {
  const start = ds === undefined ? fbStart : parseFloat(ds);
  const d = ds === undefined || de === undefined ? fbDur : parseFloat(de) - parseFloat(ds);
  return { start, d };
}

function resolveTweenTiming(anim: GsapAnimation, trackId: string): { start: number; d: number } {
  const fbStart = anim.resolvedStart ?? 0;
  const fbDur = numOr(anim.duration as number | undefined, 0.4);
  const el = comp ? comp.getElement(trackId) : null;
  if (!el) return { start: fbStart, d: fbDur };
  return computeTiming(el.attributes["data-start"], el.attributes["data-end"], fbStart, fbDur);
}

function buildTweenBlock(
  anim: GsapAnimation,
  track: { id: string; label: string },
  color: string,
  dur: number,
): HTMLDivElement {
  const { start, d } = resolveTweenTiming(anim, track.id);
  const block = document.createElement("div");
  block.className = "tl-block";
  block.style.left = `${(start / dur) * 100}%`;
  block.style.width = `${Math.max((d / dur) * 100, 1.5)}%`;
  block.style.background = color;
  block.title = `${anim.method}(${track.label}) @${start.toFixed(2)}s dur:${d.toFixed(2)}s`;
  block.dataset.tweenId = anim.id;
  block.dataset.start = String(start);
  block.dataset.duration = String(d);
  block.dataset.trackId = track.id;
  block.appendChild(makeHandle("tl-handle-l", "trim-start"));
  block.appendChild(makeHandle("tl-handle-r", "trim-end"));
  return block;
}

function makeHandle(side: string, drag: string): HTMLDivElement {
  const h = document.createElement("div");
  h.className = `tl-handle ${side}`;
  h.dataset.drag = drag;
  return h;
}

function buildTrackRow(
  track: { id: string; label: string; tweens: GsapAnimation[] },
  index: number,
  dur: number,
): HTMLDivElement {
  const color = TRACK_COLORS[index % TRACK_COLORS.length];
  const row = document.createElement("div");
  row.className = "tl-row";
  const labelEl = document.createElement("div");
  labelEl.className = "tl-label";
  labelEl.textContent = track.label;
  row.appendChild(labelEl);
  const trackArea = document.createElement("div");
  trackArea.className = "tl-track";
  for (const anim of track.tweens) trackArea.appendChild(buildTweenBlock(anim, track, color, dur));
  row.appendChild(trackArea);
  return row;
}

function renderTimeline() {
  const tracksEl = document.getElementById("tl-tracks");
  if (!tracksEl) return;
  const dur = timelineDuration > 0 ? timelineDuration : 1;
  tracksEl.innerHTML = "";
  parseTimelineData().forEach((track, i) => tracksEl.appendChild(buildTrackRow(track, i, dur)));
}

// ── Element list ──────────────────────────────────────────────────────────────

function buildElItem(el: { id: string; tag: string; text: string | null }): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "el-item" + (el.id === selectedId ? " selected" : "");
  item.innerHTML =
    `<span class="el-tag">&lt;${el.tag}&gt;</span>` +
    `<span class="el-id">${el.id}</span>` +
    (el.text ? `<span class="el-text">${el.text}</span>` : "");
  item.addEventListener("click", () => setSelection(el.id));
  return item;
}

function renderElementList() {
  if (!comp) return;
  const list = document.getElementById("element-list")!;
  list.innerHTML = "";
  const elements = comp.getElements().filter((e) => !e.attributes["data-hf-root"]);
  for (const el of elements) list.appendChild(buildElItem(el));
}

// ── Selection ─────────────────────────────────────────────────────────────────

function setSelection(id: string | null) {
  selectedId = id;
  document.getElementById("sel-display")!.textContent = id ?? "(none)";
  renderElementList();
  renderInspectorContent();
  // instant highlight via postMessage — no srcdoc reload
  sendSelectionToIframe(id);
}

// ── Property form (Properties tab) ───────────────────────────────────────────

function propLabel(text: string): HTMLSpanElement {
  const lbl = document.createElement("span");
  lbl.className = "prop-label";
  lbl.textContent = text;
  return lbl;
}

function buildColorControl(row: HTMLElement, prop: string, currentVal: string) {
  const picker = document.createElement("input");
  picker.type = "color";
  picker.className = "prop-color prop-input";
  const text = document.createElement("input");
  text.type = "text";
  text.className = "prop-input";
  text.style.flex = "1";
  const normalized = currentVal.trim();
  trySetValue(picker, normalized);
  text.value = normalized;
  picker.addEventListener("input", () => {
    text.value = picker.value;
    commitStyle(prop, picker.value);
  });
  text.addEventListener("blur", () => {
    commitStyle(prop, text.value.trim() || null);
    trySetValue(picker, text.value);
  });
  row.appendChild(picker);
  row.appendChild(text);
}

// Only valid hex colors assign to a <input type=color>; ignore anything else.
function trySetValue(picker: HTMLInputElement, value: string) {
  try {
    picker.value = value;
  } catch {
    /* non-hex color */
  }
}

function buildSelectControl(row: HTMLElement, prop: string, currentVal: string, options: string[]) {
  const sel = document.createElement("select");
  sel.className = "prop-input";
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (opt === currentVal) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => commitStyle(prop, sel.value || null));
  row.appendChild(sel);
}

function buildTextControl(
  row: HTMLElement,
  prop: string,
  currentVal: string,
  type: "text" | "number",
) {
  const input = document.createElement("input");
  input.type = type;
  input.className = "prop-input";
  input.style.flex = "1";
  input.value = currentVal;
  input.addEventListener("blur", () => commitStyle(prop, input.value.trim() || null));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
  row.appendChild(input);
}

function makeStyleRow(
  label: string,
  prop: string,
  currentVal: string,
  type: "text" | "color" | "number" | "select",
  options?: string[],
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "prop-row";
  row.appendChild(propLabel(label));
  if (type === "color") buildColorControl(row, prop, currentVal);
  else if (type === "select") buildSelectControl(row, prop, currentVal, options ?? []);
  else buildTextControl(row, prop, currentVal, type);
  return row;
}

function commitStyle(prop: string, value: string | null) {
  if (!comp || !selectedId) return;
  comp.element(selectedId).setStyle({ [prop]: value });
  logEntry("op", { "element().setStyle": { id: selectedId, [prop]: value } });
}

type PropEl = NonNullable<ReturnType<Composition["getElement"]>>;

function appendContentSection(container: HTMLElement, el: PropEl) {
  if (el.text === null) return;
  const sec = propSection("Content");
  const row = document.createElement("div");
  row.className = "prop-row";
  const ta = document.createElement("textarea");
  ta.className = "prop-input wide";
  ta.value = el.text;
  ta.addEventListener("blur", () => {
    if (!comp || !selectedId) return;
    comp.setText(selectedId, ta.value);
    logEntry("op", { setText: { id: selectedId, value: ta.value } });
  });
  row.appendChild(ta);
  sec.appendChild(row);
  container.appendChild(sec);
}

const WEIGHTS = ["", "300", "400", "500", "600", "700", "800", "900"];

function styleVal(el: PropEl, key: string): string {
  return el.inlineStyles[key] ?? "";
}

function appendTypographySection(container: HTMLElement, el: PropEl) {
  const sec = propSection("Typography");
  sec.appendChild(makeStyleRow("Color", "color", styleVal(el, "color"), "color"));
  sec.appendChild(makeStyleRow("Size", "fontSize", styleVal(el, "fontSize"), "text"));
  sec.appendChild(
    makeStyleRow("Weight", "fontWeight", styleVal(el, "fontWeight"), "select", WEIGHTS),
  );
  container.appendChild(sec);
}

function appendBoxSection(container: HTMLElement, el: PropEl) {
  const sec = propSection("Box");
  sec.appendChild(makeStyleRow("Background", "background", styleVal(el, "background"), "color"));
  sec.appendChild(makeStyleRow("Opacity", "opacity", styleVal(el, "opacity"), "text"));
  sec.appendChild(makeStyleRow("Left", "left", styleVal(el, "left"), "text"));
  sec.appendChild(makeStyleRow("Top", "top", styleVal(el, "top"), "text"));
  container.appendChild(sec);
}

function attrRow(name: string, val: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "prop-row";
  const lbl = propLabel(name);
  lbl.style.maxWidth = "80px";
  lbl.style.overflow = "hidden";
  lbl.style.textOverflow = "ellipsis";
  const inp = document.createElement("input");
  inp.type = "text";
  inp.className = "prop-input";
  inp.style.flex = "1";
  inp.value = val;
  inp.addEventListener("blur", () => commitAttr(name, inp.value));
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") inp.blur();
  });
  row.appendChild(lbl);
  row.appendChild(inp);
  return row;
}

function commitAttr(name: string, raw: string) {
  if (!comp || !selectedId) return;
  comp.element(selectedId).setAttribute(name, raw.trim() || null);
  logEntry("op", { setAttribute: { id: selectedId, name, value: raw } });
}

function appendAttributesSection(container: HTMLElement, el: PropEl) {
  const sec = propSection("Attributes");
  const attrs = Object.entries(el.attributes).filter(
    ([k]) => !k.startsWith("data-hf-") && k !== "class" && k !== "style",
  );
  for (const [name, val] of attrs) sec.appendChild(attrRow(name, val));
  if (attrs.length === 0) sec.appendChild(mkNote("no attributes"));
  container.appendChild(sec);
}

function appendDangerSection(container: HTMLElement) {
  const sec = propSection("Danger");
  const delBtn = document.createElement("button");
  delBtn.textContent = "Remove element";
  delBtn.className = "danger";
  delBtn.style.fontSize = "11px";
  delBtn.addEventListener("click", removeSelected);
  sec.appendChild(delBtn);
  container.appendChild(sec);
}

function removeSelected() {
  if (!comp || !selectedId) return;
  const id = selectedId;
  comp.element(id).removeElement();
  logEntry("op", { removeElement: id });
  setSelection(null);
}

function appendAnimationsSection(container: HTMLElement, el: PropEl) {
  const sec = propSection("Animations");
  if (el.animationIds.length > 0)
    for (const aid of el.animationIds) sec.appendChild(tweenChip(aid));
  else sec.appendChild(mkNote("no tweens"));
  sec.appendChild(addTweenToggle());
  container.appendChild(sec);
}

function tweenChip(aid: string): HTMLDivElement {
  const chip = document.createElement("div");
  chip.className = "tween-id";
  chip.title = aid;
  chip.textContent = aid;
  return chip;
}

function addTweenToggle(): DocumentFragment {
  const frag = document.createDocumentFragment();
  const addBtn = document.createElement("button");
  addBtn.textContent = "+ Add tween";
  addBtn.style.marginTop = "6px";
  addBtn.style.fontSize = "11px";
  const form = document.createElement("div");
  form.id = "add-tween-form";
  addBtn.addEventListener("click", () => toggleAddTweenForm(form));
  frag.appendChild(addBtn);
  frag.appendChild(form);
  return frag;
}

function toggleAddTweenForm(form: HTMLElement) {
  if (form.classList.contains("open")) {
    form.classList.remove("open");
    return;
  }
  form.classList.add("open");
  buildAddTweenForm(form);
}

function renderPropertiesContent(container: HTMLElement) {
  if (!comp || !selectedId) {
    container.innerHTML = '<div class="prop-no-selection">Select an element</div>';
    return;
  }
  const el = comp.getElement(selectedId);
  if (!el) {
    container.innerHTML = '<div class="prop-no-selection">Element not found</div>';
    return;
  }
  container.innerHTML = "";
  appendContentSection(container, el);
  appendTypographySection(container, el);
  appendBoxSection(container, el);
  appendAttributesSection(container, el);
  appendDangerSection(container);
  appendAnimationsSection(container, el);
}

function propSection(title: string): HTMLDivElement {
  const sec = document.createElement("div");
  sec.className = "prop-section";
  const h = document.createElement("div");
  h.className = "prop-section-title";
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}

interface TweenFormInputs {
  method: HTMLSelectElement;
  prop: HTMLInputElement;
  val: HTMLInputElement;
  dur: HTMLInputElement;
  ease: HTMLInputElement;
  pos: HTMLInputElement;
}

function applyTweenPosition(tween: GsapTweenSpec, pos: string) {
  if (pos !== "") tween.position = parseFloat(pos);
}

function readTweenSpecFromForm(f: TweenFormInputs): GsapTweenSpec {
  const propKey = f.prop.value.trim() || "x";
  const tween: GsapTweenSpec = {
    method: (f.method.value || "to") as "to" | "from" | "fromTo",
    duration: numOr(f.dur.value, 0.5),
    ease: f.ease.value || "power2.out",
    properties: { [propKey]: coerceNum(f.val.value.trim()) },
  };
  applyTweenPosition(tween, f.pos.value.trim());
  return tween;
}

function buildAddTweenForm(form: HTMLElement) {
  form.innerHTML = "";
  const inputs: TweenFormInputs = {
    method: mkSelect(["to", "from", "fromTo"], "to"),
    prop: mkInput("property", "x"),
    val: mkInput("value", "200"),
    dur: mkNumInput("duration", "0.5"),
    ease: mkInput("ease", "power2.out"),
    pos: mkNumInput("position", ""),
  };
  appendRow(form, mkLabel("Method"), inputs.method);
  appendRow(form, mkLabel("Prop"), inputs.prop, mkLabel("Val"), inputs.val);
  appendRow(form, mkLabel("Duration"), inputs.dur, mkLabel("Ease"), inputs.ease);
  appendRow(form, mkLabel("Position"), inputs.pos);

  const addBtn = document.createElement("button");
  addBtn.textContent = "Add";
  addBtn.className = "primary";
  addBtn.style.marginTop = "6px";
  addBtn.addEventListener("click", () => submitAddTween(form, inputs));
  form.appendChild(addBtn);
}

function submitAddTween(form: HTMLElement, inputs: TweenFormInputs) {
  if (!comp || !selectedId) return;
  const tween = readTweenSpecFromForm(inputs);
  lastTweenId = comp.addGsapTween(selectedId, tween);
  logEntry("op", { addGsapTween: { target: selectedId, tween, id: lastTweenId } });
  form.classList.remove("open");
  renderInspectorContent();
}

// ── Ops tab (raw SDK test panel) ──────────────────────────────────────────────

// Shared display node for the addGsapTween / setGsapTween / removeGsapTween group.
let tweenIdDisplay: HTMLDivElement;

function needSelection(): boolean {
  if (selectedId) return true;
  logEntry("info", "select an element first");
  return false;
}

function buildPreviewSelectSection(): HTMLDivElement {
  const preview = playgroundPreview!;
  const ids = comp!
    .getElements()
    .filter((e) => !e.attributes["data-hf-root"])
    .map((e) => e.id);
  const buttons = ids.map((id) =>
    mkBtn(id, "", () => {
      preview.select([id]);
      logEntry("op", { "preview.select": [id] });
    }),
  );
  const clear = mkBtn("clear", "danger", () => {
    preview.select([]);
    logEntry("op", { "preview.select": [] });
  });
  return opSection("PreviewAdapter.select()", opRow(...buttons, clear));
}

function buildSetStyleSection(): HTMLDivElement {
  const colorInput = mkInput("#f43f5e", "#f43f5e");
  colorInput.style.width = "100px";
  const setColor = mkBtn("Headline color", "primary", () => {
    if (!needSelection()) return;
    comp!.setStyle(selectedId!, { color: colorInput.value });
    logEntry("op", { setStyle: { id: selectedId, color: colorInput.value } });
  });
  const bold = mkBtn("Bold", "", () =>
    comp!.setStyle(selectedId ?? "hf-headline", { fontWeight: "700" }),
  );
  const reset = mkBtn("Reset weight", "", () =>
    comp!.setStyle(selectedId ?? "hf-headline", { fontWeight: null }),
  );
  return opSection("setStyle", opRow(colorInput, setColor), opRow(bold, reset));
}

function buildSetTextSection(): HTMLDivElement {
  const textInput = mkInput("new text", "");
  const set = mkBtn("Set", "primary", () => {
    if (!needSelection()) return;
    comp!.setText(selectedId!, textInput.value);
    logEntry("op", { setText: { id: selectedId, value: textInput.value } });
  });
  return opSection("setText", opRow(textInput, set));
}

function buildAddGsapTweenSection(): HTMLDivElement {
  const target = mkInput("target id", selectedId ?? "hf-badge");
  target.style.width = "110px";
  const dur = mkNumInput("dur", "0.8");
  const ease = mkInput("ease", "power2.out");
  ease.style.width = "110px";
  const propKey = mkInput("prop", "x");
  propKey.style.width = "60px";
  const propVal = mkInput("val", "200");
  propVal.style.width = "60px";
  tweenIdDisplay = document.createElement("div");
  tweenIdDisplay.id = "anim-id-display";
  tweenIdDisplay.textContent = lastTweenId || "no tween added yet";
  const add = mkBtn("Add →", "primary", () => {
    const tween: GsapTweenSpec = {
      method: "to",
      duration: numOr(dur.value, 0.5),
      ease: ease.value || "power2.out",
      properties: { [propKey.value.trim()]: coerceNum(propVal.value) },
    };
    lastTweenId = comp!.addGsapTween(target.value.trim(), tween);
    tweenIdDisplay.textContent = lastTweenId;
    logEntry("op", { addGsapTween: { target: target.value, tween, id: lastTweenId } });
  });
  return opSection(
    "addGsapTween",
    opRow(target, dur, ease),
    opRow(propKey, propVal, add),
    tweenIdDisplay,
  );
}

function needTween(): boolean {
  if (lastTweenId) return true;
  logEntry("info", "add a tween first");
  return false;
}

function buildSetGsapTweenSection(): HTMLDivElement {
  const newDur = mkNumInput("new dur", "1.5");
  const update = mkBtn("Update dur", "", () => {
    if (!needTween()) return;
    comp!.setGsapTween(lastTweenId, { duration: numOr(newDur.value, 1) });
    logEntry("op", { setGsapTween: { id: lastTweenId, duration: newDur.value } });
  });
  const remove = mkBtn("Remove", "danger", () => {
    if (!needTween()) return;
    comp!.removeGsapTween(lastTweenId);
    logEntry("op", { removeGsapTween: lastTweenId });
    lastTweenId = "";
    tweenIdDisplay.textContent = "no tween added yet";
  });
  return opSection(
    "setGsapTween / removeGsapTween",
    opRow(mkNote("operates on last added tween")),
    opRow(newDur, update, remove),
  );
}

function buildLabelSection(): HTMLDivElement {
  const name = mkInput("label", "midpoint");
  name.style.width = "100px";
  const pos = mkNumInput("pos", "1.5");
  const add = mkBtn("Add", "primary", () => {
    const labelName = name.value.trim();
    comp!.dispatch({ type: "addLabel", name: labelName, position: parseFloat(pos.value) });
    logEntry("op", { addLabel: { name: labelName, position: pos.value } });
  });
  const remove = mkBtn("Remove", "danger", () => {
    comp!.dispatch({ type: "removeLabel", name: name.value.trim() });
    logEntry("op", { removeLabel: name.value.trim() });
  });
  return opSection("addLabel / removeLabel", opRow(name, pos, add, remove));
}

function buildClassStyleSection(): HTMLDivElement {
  const sel = mkInput("selector", ".badge");
  sel.style.width = "80px";
  const prop = mkInput("prop", "background");
  prop.style.width = "90px";
  const val = mkInput("value", "#8b5cf6");
  val.style.width = "90px";
  const apply = mkBtn("Apply", "primary", () => {
    const selector = sel.value.trim();
    const styles = { [prop.value.trim()]: val.value.trim() || null };
    comp!.dispatch({ type: "setClassStyle", selector, styles });
    logEntry("op", { setClassStyle: { selector, ...styles } });
  });
  return opSection("setClassStyle", opRow(sel, prop, val, apply));
}

function buildAttributeSection(): HTMLDivElement {
  const name = mkInput("name", "data-custom");
  name.style.width = "110px";
  const val = mkInput("value", "hello");
  val.style.width = "100px";
  const set = mkBtn("Set attr", "primary", () => {
    if (!needSelection()) return;
    comp!.element(selectedId!).setAttribute(name.value.trim(), val.value.trim() || null);
    logEntry("op", { setAttribute: { id: selectedId, name: name.value, value: val.value } });
  });
  const remove = mkBtn("Remove el", "danger", () => {
    if (!needSelection()) return;
    removeSelected();
  });
  return opSection(
    "setAttribute / removeElement",
    opRow(mkNote("operates on selected element")),
    opRow(name, val, set, remove),
  );
}

function buildVariableSection(): HTMLDivElement {
  const id = mkInput("variable id", "brand-color");
  id.style.width = "110px";
  const val = mkInput("value", "#f43f5e");
  val.style.width = "100px";
  const set = mkBtn("Set", "primary", () => {
    comp!.setVariableValue(id.value.trim(), val.value.trim());
    logEntry("op", { setVariableValue: { id: id.value, value: val.value } });
  });
  return opSection("setVariableValue", opRow(id, val, set));
}

function buildFindSection(): HTMLDivElement {
  const tag = mkInput("tag", "");
  tag.style.width = "60px";
  const text = mkInput("text", "");
  text.style.width = "80px";
  const results = mkNote("");
  const find = mkBtn("Find", "primary", () => {
    const query: FindQuery = {};
    if (tag.value.trim()) query.tag = tag.value.trim();
    if (text.value.trim()) query.text = text.value.trim();
    const ids = comp!.find(query);
    results.textContent = ids.length ? ids.join(", ") : "(none)";
    logEntry("op", { find: { query, result: ids } });
  });
  return opSection("find(query)", opRow(mkLabel("tag"), tag, mkLabel("text"), text, find), results);
}

function buildSelectionProxySection(): HTMLDivElement {
  const prop = mkInput("prop", "opacity");
  prop.style.width = "80px";
  const val = mkInput("value", "0.5");
  val.style.width = "80px";
  const setStyle = mkBtn("setStyle", "primary", () => {
    comp!.selection().setStyle({ [prop.value.trim()]: val.value.trim() || null });
    logEntry("op", { "selection().setStyle": { [prop.value]: val.value } });
  });
  const remove = mkBtn("remove", "danger", () => {
    const ids = comp!.getSelection();
    comp!.selection().removeElement();
    logEntry("op", { "selection().removeElement": ids });
    setSelection(null);
  });
  const current = mkNote(`current: ${comp!.getSelection().join(", ") || "(none)"}`);
  return opSection("selection() proxy", opRow(current), opRow(prop, val, setStyle, remove));
}

function buildVersionsSection(): HTMLDivElement {
  const display = mkNote("");
  display.style.maxHeight = "80px";
  display.style.overflowY = "auto";
  const list = mkBtn("List versions", "", () => listVersionsInto(display));
  const loadOldest = mkBtn("Load oldest", "", () => loadOldestVersion());
  return opSection("listVersions / loadFrom", opRow(list, loadOldest), display);
}

async function listVersionsInto(display: HTMLElement) {
  const { adapter } = await createFileAdapter();
  const versions = await adapter.listVersions("composition.html");
  display.textContent = versions.length ? versions.map(versionLabel).join("\n") : "(no versions)";
  logEntry("info", { versions: versions.map((v) => v.key) });
}

function versionLabel(v: { key: string; timestamp?: number }): string {
  return `${v.key} (${new Date(v.timestamp ?? 0).toLocaleTimeString()})`;
}

async function loadOldestVersion() {
  const { adapter } = await createFileAdapter();
  const versions = await adapter.listVersions("composition.html");
  const oldest = versions[versions.length - 1];
  if (!oldest) {
    logEntry("info", "no versions");
    return;
  }
  const html = await adapter.loadFrom("composition.html", oldest.key);
  if (!html) return;
  await openEditor(html, `v${oldest.key}`);
  logEntry("info", `loaded version ${oldest.key}`);
}

function buildHistorySection(): HTMLDivElement {
  const undo = mkBtn("← Undo", "", () => {
    comp!.undo();
    logEntry("undo", "dispatched");
  });
  const redo = mkBtn("Redo →", "", () => {
    comp!.redo();
    logEntry("redo", "dispatched");
  });
  const canCheck = mkBtn("can(addGsapTween)?", "", () => {
    const r = comp!.can({
      type: "addGsapTween",
      target: "hf-badge",
      tween: { method: "to", duration: 0.5 },
    });
    logEntry("info", { "can(addGsapTween)": r });
  });
  const overrides = mkBtn("getOverrides()", "", () => logEntry("info", comp!.getOverrides()));
  const flush = mkBtn("flush", "", () => {
    comp!.flush().then(() => logEntry("info", "flush complete"));
  });
  return opSection("History / inspect", opRow(undo, redo), opRow(canCheck, overrides, flush));
}

const OPS_SECTIONS = [
  buildPreviewSelectSection,
  buildSetStyleSection,
  buildSetTextSection,
  buildAddGsapTweenSection,
  buildSetGsapTweenSection,
  buildLabelSection,
  buildClassStyleSection,
  buildAttributeSection,
  buildVariableSection,
  buildFindSection,
  buildSelectionProxySection,
  buildVersionsSection,
  buildHistorySection,
];

function renderOpsContent(container: HTMLElement) {
  if (!comp) {
    container.innerHTML = '<div class="prop-no-selection">No composition open</div>';
    return;
  }
  container.innerHTML = "";
  for (const build of OPS_SECTIONS) container.appendChild(build());
}

// ── Inspector content router ──────────────────────────────────────────────────

function renderInspectorContent() {
  const container = document.getElementById("inspector-content")!;
  if (activeTab === "properties") renderPropertiesContent(container);
  else renderOpsContent(container);
}

// ── Open editor ───────────────────────────────────────────────────────────────

function resetUiForOpen(name: string) {
  patchCount = 0;
  selectedId = null;
  lastTweenId = "";
  prevPlayPct = 0;
  timelineDuration = 0;
  document.getElementById("log-entries")!.innerHTML = "";
  document.getElementById("sel-display")!.textContent = "(none)";
  document.getElementById("comp-name")!.textContent = name;
  (document.getElementById("tl-scrubber") as HTMLInputElement).value = "0";
  document.getElementById("tl-time")!.textContent = "0.0s";
  document.getElementById("tl-dur")!.textContent = "–";
}

function wireCompositionEvents(c: Composition) {
  c.on("patch", (e) => {
    patchCount++;
    logEntry(`patch #${patchCount}`, e.patches);
    schedulePreviewUpdate();
    renderElementList();
    renderInspectorContent();
    renderTimeline();
  });
  c.on("persist:error", (e) => logEntry("persist:error", e));
  c.on("selectionchange", onSelectionChange);
}

function onSelectionChange(ids: string[]) {
  const id = ids[0] ?? null;
  selectedId = id;
  document.getElementById("sel-display")!.textContent = id ?? "(none)";
  renderElementList();
  renderInspectorContent();
  sendSelectionToIframe(id);
  logEntry("selectionchange", ids);
}

async function openEditor(html: string, name = "untitled") {
  if (comp) {
    comp.dispose();
    comp = null;
  }
  resetUiForOpen(name);

  const { adapter: persist } = await createFileAdapter();
  const preview = new PlaygroundPreview();
  playgroundPreview = preview;

  comp = await openComposition(html, { persist, preview, coalesceMs: 150 });
  wireCompositionEvents(comp);

  renderElementList();
  renderInspectorContent();
  updatePreviewNow();
  renderTimeline();
  logEntry("info", `opened — ${comp.getElements().length} elements`);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function mkBtn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

function mkInput(placeholder: string, defaultValue = ""): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "text";
  i.placeholder = placeholder;
  i.value = defaultValue;
  return i;
}

function mkNumInput(placeholder: string, defaultValue = ""): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "number";
  i.placeholder = placeholder;
  i.value = defaultValue;
  return i;
}

function mkSelect(opts: string[], defaultVal: string): HTMLSelectElement {
  const s = document.createElement("select");
  s.className = "prop-input";
  for (const o of opts) {
    const op = document.createElement("option");
    op.value = o;
    op.textContent = o;
    if (o === defaultVal) op.selected = true;
    s.appendChild(op);
  }
  return s;
}

function mkLabel(text: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = "prop-label";
  s.textContent = text;
  s.style.width = "auto";
  return s;
}

function mkNote(text: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "op-note";
  d.textContent = text;
  return d;
}

function opRow(...children: HTMLElement[]): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "op-row";
  for (const c of children) d.appendChild(c);
  return d;
}

function appendRow(parent: HTMLElement, ...children: HTMLElement[]) {
  const row = opRow(...children);
  row.style.marginBottom = "4px";
  parent.appendChild(row);
}

function opSection(title: string, ...rows: HTMLElement[]): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "op-section";
  const h = document.createElement("div");
  h.className = "op-title";
  h.textContent = title;
  d.appendChild(h);
  for (const row of rows) d.appendChild(row);
  return d;
}

// ── Timeline drag ─────────────────────────────────────────────────────────────

type DragType = "move" | "trim-start" | "trim-end";

interface DragState {
  tweenId: string;
  trackId: string;
  type: DragType;
  startX: number;
  origStart: number;
  origDuration: number;
  blockEl: HTMLElement;
  snapDur: number;
  trackW: number;
  dragged: boolean;
}

let dragState: DragState | null = null;

function dragTypeOf(target: HTMLElement): DragType {
  return (target.dataset.drag as DragType | undefined) ?? "move";
}

function buildDragState(target: HTMLElement, block: HTMLElement, clientX: number): DragState {
  const body = document.getElementById("tl-body")!;
  return {
    tweenId: block.dataset.tweenId ?? "",
    trackId: block.dataset.trackId ?? "",
    type: dragTypeOf(target),
    startX: clientX,
    origStart: numOr(block.dataset.start, 0),
    origDuration: numOr(block.dataset.duration, 0.4),
    blockEl: block,
    snapDur: timelineDuration > 0 ? timelineDuration : 1,
    trackW: body.offsetWidth - 120,
    dragged: false,
  };
}

function onDragStart(e: MouseEvent) {
  const target = e.target as HTMLElement;
  const block = target.closest(".tl-block") as HTMLElement | null;
  if (!block || !block.dataset.tweenId) return;
  e.preventDefault();
  dragState = buildDragState(target, block, e.clientX);
  block.classList.add("dragging");
}

function moveBlock(ds: DragState, dt: number) {
  const newStart = Math.max(0, ds.origStart + dt);
  ds.blockEl.style.left = `${(newStart / ds.snapDur) * 100}%`;
  ds.blockEl.dataset.start = String(newStart);
}

function trimEnd(ds: DragState, dt: number) {
  const newDur = Math.max(0.05, ds.origDuration + dt);
  ds.blockEl.style.width = `${Math.max((newDur / ds.snapDur) * 100, 1.5)}%`;
  ds.blockEl.dataset.duration = String(newDur);
}

// trim-start: right edge fixed, left edge moves — both start and duration change
function trimStart(ds: DragState, dt: number) {
  const newStart = Math.max(0, Math.min(ds.origStart + dt, ds.origStart + ds.origDuration - 0.05));
  const newDur = ds.origStart + ds.origDuration - newStart;
  ds.blockEl.style.left = `${(newStart / ds.snapDur) * 100}%`;
  ds.blockEl.style.width = `${Math.max((newDur / ds.snapDur) * 100, 1.5)}%`;
  ds.blockEl.dataset.start = String(newStart);
  ds.blockEl.dataset.duration = String(newDur);
}

const DRAG_MOVERS: Record<DragType, (ds: DragState, dt: number) => void> = {
  move: moveBlock,
  "trim-end": trimEnd,
  "trim-start": trimStart,
};

function onDragMove(e: MouseEvent) {
  if (!dragState) return;
  if (Math.abs(e.clientX - dragState.startX) > 2) dragState.dragged = true;
  const dt = ((e.clientX - dragState.startX) / dragState.trackW) * dragState.snapDur;
  DRAG_MOVERS[dragState.type](dragState, dt);
}

function commitDragTiming(type: DragType, trackId: string, start: number, dur: number) {
  if (type === "move") {
    comp!.setTiming(trackId, { start });
    logEntry("op", { setTiming: { id: trackId, start: start.toFixed(3) } });
    return;
  }
  comp!.setTiming(trackId, { start, duration: dur });
  logEntry("op", { setTiming: { id: trackId, start: start.toFixed(3), duration: dur.toFixed(3) } });
}

function finishDrag(ds: DragState) {
  if (!ds.dragged) {
    setSelection(ds.trackId);
    return;
  }
  if (!comp) return;
  const newStart = numOr(ds.blockEl.dataset.start, 0);
  const newDur = numOr(ds.blockEl.dataset.duration, ds.origDuration);
  commitDragTiming(ds.type, ds.trackId, newStart, newDur);
}

function onDragEnd() {
  if (!dragState) return;
  const ds = dragState;
  ds.blockEl.classList.remove("dragging");
  dragState = null;
  finishDrag(ds);
}

function wireDragListeners() {
  const tracksEl = document.getElementById("tl-tracks")!;
  tracksEl.addEventListener("mousedown", onDragStart);
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);
}

// ── Playhead + iframe message bridge ──────────────────────────────────────────

function updatePlayhead(pct: number) {
  const body = document.getElementById("tl-body");
  const ph = document.getElementById("tl-playhead");
  if (!body || !ph) return;
  const labelW = 120;
  ph.style.left = `${labelW + (body.offsetWidth - labelW) * pct}px`;
}

function setScrubberTime(pct: number, t: number) {
  const scrubber = document.getElementById("tl-scrubber") as HTMLInputElement;
  scrubber.value = String(Math.round(pct * 1000));
  document.getElementById("tl-time")!.textContent = `${t.toFixed(1)}s`;
  updatePlayhead(pct);
}

function onIframeClick(data: { id?: string }) {
  if (data.id) playgroundPreview?.select([data.id]);
}

function onIframeDeselect() {
  playgroundPreview?.select([]);
}

function onIframeDragend(data: { id: string; dx: number; dy: number }) {
  if (!comp) return;
  const el = comp.getElement(data.id);
  if (!el) return;
  const left = numOr(el.inlineStyles["left"], 0) + data.dx;
  const top = numOr(el.inlineStyles["top"], 0) + data.dy;
  comp.setStyle(data.id, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
}

function onIframeDuration(data: { duration: number }) {
  if (!(data.duration > 0)) return;
  timelineDuration = data.duration;
  document.getElementById("tl-dur")!.textContent = `${timelineDuration.toFixed(1)}s`;
  setScrubberTime(0, 0);
  renderTimeline();
  // If play mode was active before the srcdoc rebuilt, resume
  if (playMode) postToFrame({ type: "hf:play" });
}

function onIframeTime(data: { time: number }) {
  if (timelineDuration <= 0) return;
  const t = data.time;
  const pct = Math.min(1, t / timelineDuration);
  setScrubberTime(pct, t);
  maybeLoop(pct);
  prevPlayPct = pct;
}

// loop: edge-trigger restart when crossing the end
function maybeLoop(pct: number) {
  if (pct < 0.99 || prevPlayPct >= 0.99 || !playMode) return;
  postToFrame({ type: "hf:seek", time: 0 });
  postToFrame({ type: "hf:play" });
}

const MSG_HANDLERS: Record<string, (data: any) => void> = {
  "hf:click": onIframeClick,
  "hf:deselect": onIframeDeselect,
  "hf:dragend": onIframeDragend,
  "hf:duration": onIframeDuration,
  "hf:time": onIframeTime,
};

function onWindowMessage(e: MessageEvent) {
  const handler = e.data && MSG_HANDLERS[e.data.type];
  if (handler) handler(e.data);
}

// ── Wire up static DOM ────────────────────────────────────────────────────────

function wireUndoRedo() {
  document.getElementById("btn-undo")!.addEventListener("click", () => {
    comp?.undo();
    logEntry("undo", "dispatched");
  });
  document.getElementById("btn-redo")!.addEventListener("click", () => {
    comp?.redo();
    logEntry("redo", "dispatched");
  });
}

function wirePlayToggle() {
  const playBtn = document.getElementById("btn-play")!;
  playBtn.addEventListener("click", () => {
    playMode = !playMode;
    playBtn.textContent = playMode ? "⏸" : "▶";
    playBtn.classList.toggle("primary", playMode);
    if (!playMode) {
      postToFrame({ type: "hf:pause" });
      return;
    }
    prevPlayPct = 0;
    postToFrame({ type: "hf:seek", time: 0 });
    postToFrame({ type: "hf:play" });
  });
}

function wireTabs() {
  document.querySelectorAll<HTMLElement>(".ins-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".ins-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      activeTab = (tab.dataset.tab as "properties" | "ops") ?? "properties";
      renderInspectorContent();
    });
  });
}

function hideOpenOverlay() {
  document.getElementById("open-overlay")!.classList.remove("visible");
}

function wireOpenDialog() {
  document.getElementById("btn-open")!.addEventListener("click", () => {
    const overlay = document.getElementById("open-overlay")!;
    const ta = document.getElementById("open-textarea") as HTMLTextAreaElement;
    ta.value = comp ? comp.serialize() : DEMO_HTML;
    overlay.classList.add("visible");
    ta.focus();
  });
  document.getElementById("btn-open-cancel")!.addEventListener("click", hideOpenOverlay);
  document.getElementById("btn-open-confirm")!.addEventListener("click", confirmOpen);
  document.getElementById("open-overlay")!.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) hideOpenOverlay();
  });
}

function confirmOpen() {
  const ta = document.getElementById("open-textarea") as HTMLTextAreaElement;
  const html = ta.value.trim();
  if (!html) return;
  hideOpenOverlay();
  openEditor(html, "custom").catch((err) => logEntry("persist:error", String(err)));
}

function wireScrubber() {
  const scrubber = document.getElementById("tl-scrubber") as HTMLInputElement;
  scrubber.addEventListener("input", () => {
    if (!timelineDuration) return;
    const pct = parseInt(scrubber.value) / 1000;
    const t = pct * timelineDuration;
    document.getElementById("tl-time")!.textContent = `${t.toFixed(1)}s`;
    postToFrame({ type: "hf:seek", time: t });
    updatePlayhead(pct);
  });
}

function wireStaticControls() {
  wireDragListeners();
  wireUndoRedo();
  wirePlayToggle();
  wireTabs();
  wireOpenDialog();
  wireScrubber();
  window.addEventListener("message", onWindowMessage);
  const ro = new ResizeObserver(updatePreviewScale);
  ro.observe(document.getElementById("preview-scaler-outer")!);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  wireStaticControls();
  updatePreviewScale();
  const { initialHtml } = await createFileAdapter();
  await openEditor(initialHtml ?? DEMO_HTML, initialHtml ? "composition.html" : "demo");
}

init().catch((err) => {
  document.body.innerHTML = `<pre style="color:#f87171;padding:20px">${String(err)}</pre>`;
});
