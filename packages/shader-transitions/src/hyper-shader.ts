import {
  createContext,
  setupQuad,
  createProgram,
  createProgramWithVertex,
  createTexture,
  uploadTextureSource,
  renderShader,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  type AccentColors,
} from "./webgl.js";
import { getFragSource, type ShaderName } from "./shaders/registry.js";
import { initCapture, captureScene } from "./capture.js";

declare const gsap: {
  timeline: (opts: Record<string, unknown>) => GsapTimeline;
  to: (target: HTMLElement | string, vars: Record<string, unknown>) => unknown;
  fromTo: (
    target: HTMLElement | string,
    from: Record<string, unknown>,
    to: Record<string, unknown>,
  ) => unknown;
};

interface GsapTimeline {
  paused: () => boolean;
  play: (from?: number, suppressEvents?: boolean) => GsapTimeline;
  pause: (atTime?: number, suppressEvents?: boolean) => GsapTimeline;
  time: {
    (): number;
    (value: number, suppressEvents?: boolean): GsapTimeline;
  };
  seek?: (position: number | string, suppressEvents?: boolean) => GsapTimeline;
  call: (fn: () => void, args: null, position: number) => GsapTimeline;
  to: (
    target: Record<string, unknown>,
    vars: Record<string, unknown>,
    position: number,
  ) => GsapTimeline;
  set: (target: string, vars: Record<string, unknown>, position?: number) => GsapTimeline;
  from: (target: string, vars: Record<string, unknown>, position?: number) => GsapTimeline;
  fromTo: (
    target: string,
    from: Record<string, unknown>,
    to: Record<string, unknown>,
    position?: number,
  ) => GsapTimeline;
  [key: string]: unknown;
}

export interface TransitionConfig {
  time: number;
  shader: ShaderName;
  duration?: number;
  ease?: string;
}

export interface HyperShaderConfig {
  bgColor: string;
  accentColor?: string;
  scenes: string[];
  transitions: TransitionConfig[];
  timeline?: GsapTimeline;
  compositionId?: string;
  previewCaptureFps?: number;
}

interface TransState {
  active: boolean;
  prog: WebGLProgram | null;
  progress: number;
  transitionIndex: number;
}

interface CachedTransitionFrame {
  sampleIndex: number;
  fromBlob: Blob | null;
  toBlob: Blob | null;
  fromTex: WebGLTexture | null;
  toTex: WebGLTexture | null;
}

interface TexturedTransitionFrame extends CachedTransitionFrame {
  fromTex: WebGLTexture;
  toTex: WebGLTexture;
}

interface CachedTransitionFrameBlend {
  a: TexturedTransitionFrame;
  b: TexturedTransitionFrame;
  mix: number;
}

interface CachedTransition {
  index: number;
  time: number;
  duration: number;
  fromId: string;
  toId: string;
  prog: WebGLProgram;
  frames: CachedTransitionFrame[];
  cacheKey: string;
  dirty: boolean;
  ready: boolean;
  fallback: boolean;
  persisted: boolean;
  textureReady: boolean;
  texturePromise: Promise<boolean> | null;
  textureGeneration: number;
  textureAccess: number;
  lastError?: string;
}

interface SnapshotLoadingOverlay {
  show: () => void;
  update: (status: SnapshotLoadingStatus) => void;
  hide: () => void;
}

interface SnapshotLoadingStatus {
  progress: number;
  total: number;
  currentTransition?: number;
  transitionTotal?: number;
  transitionFrame?: number;
  transitionFrames?: number;
  phase?: "cached" | "capturing" | "finalizing";
}

interface SnapshotCacheEntry {
  key: string;
  blob: Blob;
  width: number;
  height: number;
  updatedAt: number;
}

interface SceneStyleState {
  scene: HTMLElement | null;
  opacity: string;
  visibility: string;
  pointerEvents: string;
}

// Defaults for transition duration/ease. Used by every fallback site in this
// file — meta-write, browser/render mode, and engine mode — so a transition
// without explicit `duration`/`ease` plays the same length and curve in
// preview, the engine's deterministic seek path, and the metadata the
// producer reads to plan compositing.
const DEFAULT_DURATION = 0.7;
const DEFAULT_EASE = "power2.inOut";
const NO_FLIP_VERT_SRC =
  "attribute vec2 a_pos; varying vec2 v_uv; void main(){" +
  "v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0,1);}";
const SNAPSHOT_LOADING_PHRASES = [
  "Preparing scene transitions",
  "Sampling outgoing scene motion",
  "Sampling incoming scene motion",
  "Caching transition frames",
  "Finalizing transition preview",
];
const SNAPSHOT_CACHE_DB = "hyper-shader-preview-cache";
const SNAPSHOT_CACHE_STORE = "frames";
const SNAPSHOT_CACHE_VERSION = 1;
const SNAPSHOT_CACHE_SCHEMA = "v1";
const MAX_TEXTURED_TRANSITIONS = 2;
const TEXTURE_PRELOAD_LOOKAHEAD_SECONDS = 1.25;
const MAX_SNAPSHOT_CACHE_ENTRIES = 1200;

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length < 6) return [0.5, 0.5, 0.5];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [0.5, 0.5, 0.5];
  return [r, g, b];
}

function deriveAccentColors(hex: string): AccentColors {
  const [r, g, b] = parseHex(hex);
  return {
    accent: [r, g, b],
    dark: [r * 0.35, g * 0.35, b * 0.35],
    bright: [Math.min(1, r * 1.5 + 0.2), Math.min(1, g * 1.5 + 0.2), Math.min(1, b * 1.5 + 0.2)],
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolvePositiveNumber(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const PLAYER_CAPTURE_SCALE_PARAM = "__hf_shader_capture_scale";
const PLAYER_LOADING_PARAM = "__hf_shader_loading";

function readPlayerOption(globalName: string, queryName: string): string | null {
  const globalValue = (window as unknown as Record<string, unknown>)[globalName];
  if (typeof globalValue === "string") return globalValue;
  if (typeof globalValue === "number" && Number.isFinite(globalValue)) return String(globalValue);
  try {
    return new URLSearchParams(window.location.search).get(queryName);
  } catch {
    return null;
  }
}

function resolvePlayerCaptureScale(): number {
  const raw = readPlayerOption("__HF_SHADER_CAPTURE_SCALE", PLAYER_CAPTURE_SCALE_PARAM);
  const parsed = raw === null ? NaN : Number(raw);
  return clampNumber(Number.isFinite(parsed) && parsed > 0 ? parsed : 1, 0.25, 1);
}

function resolvePlayerLoadingMode(): "internal" | "player" | "none" {
  const raw = readPlayerOption("__HF_SHADER_LOADING", PLAYER_LOADING_PARAM)?.trim().toLowerCase();
  if (raw === "player" || raw === "true" || raw === "1") return "player";
  if (raw === "none" || raw === "false" || raw === "0" || raw === "off") return "none";
  return "internal";
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function getDocumentStyleSignature(doc: Document): string {
  const styleText = Array.from(doc.querySelectorAll("style"))
    .map((style) => style.textContent || "")
    .join("\n");
  const linkedStyles = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'))
    .map((link) => `${link.href}:${link.getAttribute("integrity") || ""}`)
    .join("\n");
  return stableHash(`${styleText}\n${linkedStyles}`);
}

function getDocumentScriptSignature(doc: Document): string {
  const projectSignature = Array.from(
    doc.querySelectorAll<HTMLMetaElement>('meta[name="hyperframes-project-signature"]'),
  )
    .map((meta) => meta.getAttribute("content") || "")
    .join("\n");
  const scriptText = Array.from(doc.querySelectorAll<HTMLScriptElement>("script"))
    .map((script) => {
      const attrs = [
        script.type,
        script.src,
        script.getAttribute("integrity") || "",
        script.getAttribute("crossorigin") || "",
        script.getAttribute("data-hyperframes-runtime") || "",
      ].join(":");
      return `${attrs}\n${script.src ? "" : script.textContent || ""}`;
    })
    .join("\n");
  return stableHash(`${projectSignature}\n${scriptText}`);
}

function getSceneSignature(sceneId: string): string {
  const scene = document.getElementById(sceneId);
  if (!scene) return "missing";
  return stableHash(
    `${getDocumentStyleSignature(document)}\n${getDocumentScriptSignature(document)}\n${getSceneSignatureHtml(scene)}`,
  );
}

function removeStyleProperties(el: HTMLElement, properties: string[]): void {
  for (const property of properties) {
    el.style.removeProperty(property);
  }
  if (el.getAttribute("style")?.trim() === "") {
    el.removeAttribute("style");
  }
}

function getSceneSignatureHtml(scene: HTMLElement): string {
  const clone = scene.cloneNode(true) as HTMLElement;

  // HyperShader and the core runtime mutate these inline styles during seek and
  // playback. Cache identity should track authored content, not the last preview
  // playhead state.
  removeStyleProperties(clone, ["opacity", "visibility", "pointer-events"]);
  clone.querySelectorAll<HTMLElement>("[data-start]").forEach((el) => {
    removeStyleProperties(el, ["visibility"]);
  });

  return clone.outerHTML;
}

function makeSnapshotKey(cacheKey: string, sampleIndex: number, side: "from" | "to"): string {
  return `${cacheKey}:sample:${sampleIndex}:${side}`;
}

function openSnapshotDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(SNAPSHOT_CACHE_DB, SNAPSHOT_CACHE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_CACHE_STORE)) {
        db.createObjectStore(SNAPSHOT_CACHE_STORE, { keyPath: "key" });
      }
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        snapshotDbPromise = null;
      };
      resolve(db);
    };
  });
}

let snapshotDbPromise: Promise<IDBDatabase | null> | null = null;

function resetSnapshotDb(db: IDBDatabase | null): void {
  try {
    db?.close();
  } catch {
    // Ignore close failures; the next cache operation will reopen the DB.
  }
  snapshotDbPromise = null;
}

function getSnapshotDb(): Promise<IDBDatabase | null> {
  snapshotDbPromise = snapshotDbPromise || openSnapshotDb();
  return snapshotDbPromise;
}

async function getSnapshotEntry(key: string): Promise<SnapshotCacheEntry | null> {
  const db = await getSnapshotDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SNAPSHOT_CACHE_STORE, "readonly");
      const request = tx.objectStore(SNAPSHOT_CACHE_STORE).get(key);
      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        const result = request.result;
        if (
          result &&
          typeof result === "object" &&
          "blob" in result &&
          result.blob instanceof Blob
        ) {
          resolve(result as SnapshotCacheEntry);
        } else {
          resolve(null);
        }
      };
    } catch {
      resetSnapshotDb(db);
      resolve(null);
    }
  });
}

async function putSnapshotEntry(entry: SnapshotCacheEntry): Promise<boolean> {
  const db = await getSnapshotDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SNAPSHOT_CACHE_STORE, "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.objectStore(SNAPSHOT_CACHE_STORE).put(entry);
    } catch {
      resetSnapshotDb(db);
      resolve(false);
    }
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });
}

async function pruneSnapshotCache(
  compId: string,
  activeCacheKeys: Set<string>,
  maxEntries: number = MAX_SNAPSHOT_CACHE_ENTRIES,
): Promise<void> {
  const db = await getSnapshotDb();
  if (!db) return;
  const entries = await new Promise<Array<{ key: string; updatedAt: number }>>((resolve) => {
    try {
      const tx = db.transaction(SNAPSHOT_CACHE_STORE, "readonly");
      const request = tx.objectStore(SNAPSHOT_CACHE_STORE).getAll();
      request.onerror = () => resolve([]);
      request.onsuccess = () => {
        const rows: Array<{ key: string; updatedAt: number }> = [];
        for (const result of request.result) {
          if (
            result &&
            typeof result === "object" &&
            "key" in result &&
            typeof result.key === "string"
          ) {
            const updatedAt =
              "updatedAt" in result && typeof result.updatedAt === "number" ? result.updatedAt : 0;
            rows.push({ key: result.key, updatedAt });
          }
        }
        resolve(rows);
      };
    } catch {
      resetSnapshotDb(db);
      resolve([]);
    }
  });
  const projectPrefix = `${compId}:`;
  const isActiveSnapshot = (key: string): boolean => {
    for (const cacheKey of activeCacheKeys) {
      if (key.startsWith(`${cacheKey}:sample:`)) return true;
    }
    return false;
  };
  const staleProjectKeys = entries
    .filter((entry) => entry.key.startsWith(projectPrefix) && !isActiveSnapshot(entry.key))
    .map((entry) => entry.key);
  const staleProjectKeySet = new Set(staleProjectKeys);
  const remaining = entries.filter((entry) => !staleProjectKeySet.has(entry.key));
  const activeCount = remaining.filter((entry) => isActiveSnapshot(entry.key)).length;
  const removable = remaining
    .filter((entry) => !isActiveSnapshot(entry.key))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const removableBudget = Math.max(0, maxEntries - activeCount);
  const overflowKeys =
    removable.length > removableBudget
      ? removable.slice(removableBudget).map((entry) => entry.key)
      : [];
  const keysToDelete = Array.from(new Set([...staleProjectKeys, ...overflowKeys]));
  if (keysToDelete.length === 0) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(SNAPSHOT_CACHE_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      const store = tx.objectStore(SNAPSHOT_CACHE_STORE);
      for (const key of keysToDelete) {
        store.delete(key);
      }
    } catch {
      resetSnapshotDb(db);
      resolve();
    }
  });
}

function blobToTextureSource(blob: Blob): Promise<TexImageSource> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob);
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("[HyperShader] Failed to decode cached snapshot"));
    };
    img.src = url;
  });
}

function closeTextureSource(source: TexImageSource): void {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close();
  }
}

function createRenderTexture(
  gl: WebGLRenderingContext,
  width: number,
  height: number,
): WebGLTexture {
  const tex = createTexture(gl);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return tex;
}

function createFramebuffer(gl: WebGLRenderingContext, tex: WebGLTexture): WebGLFramebuffer {
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error("[HyperShader] Failed to create framebuffer");
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fbo;
}

function createSnapshotLoadingOverlay(
  root: HTMLElement | null,
  width: number,
  height: number,
): SnapshotLoadingOverlay | null {
  const doc = root?.ownerDocument || document;
  const host = root || doc.body;
  if (!host) return null;

  host.querySelector<HTMLElement>("[data-hyper-shader-loading]")?.remove();

  const overlay = doc.createElement("div");
  overlay.setAttribute("data-hyper-shader-loading", "");
  overlay.setAttribute("data-hyperframes-ignore", "");
  overlay.setAttribute("data-hyperframes-picker-block", "");
  overlay.setAttribute("data-hf-ignore", "");
  overlay.setAttribute("data-no-capture", "");
  overlay.setAttribute("data-no-inspect", "");
  overlay.setAttribute("data-no-pick", "");
  overlay.setAttribute("draggable", "false");
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-label", "Preparing scene transitions");
  overlay.style.cssText = [
    "position:absolute",
    "inset:0",
    `width:${width}px`,
    `height:${height}px`,
    "z-index:2147483647",
    "display:none",
    "place-items:center",
    "opacity:1",
    "transition:opacity 240ms ease-out",
    "background:#030504",
    "pointer-events:auto",
    "color:#f4f7fb",
    "cursor:default",
    "touch-action:none",
    "user-select:none",
    "-webkit-user-select:none",
    "-webkit-user-drag:none",
  ].join(";");
  const blockOverlayInteraction = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  for (const eventName of ["selectstart", "dragstart", "pointerdown", "mousedown", "touchstart"]) {
    overlay.addEventListener(eventName, blockOverlayInteraction, { capture: true });
  }

  const panel = doc.createElement("div");
  panel.setAttribute("draggable", "false");
  panel.style.cssText = [
    "display:grid",
    "grid-template-rows:172px 72px 44px 44px 54px",
    "justify-items:center",
    "align-items:center",
    "gap:0",
    "width:min(1040px,82%)",
    "padding:42px",
    "box-sizing:border-box",
    "text-align:center",
    "font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "user-select:none",
    "-webkit-user-select:none",
    "-webkit-user-drag:none",
  ].join(";");

  const markFrame = doc.createElement("div");
  markFrame.setAttribute("data-hf-loader-mark-frame", "");
  markFrame.style.cssText = [
    "width:172px",
    "height:172px",
    "display:grid",
    "place-items:center",
    "overflow:visible",
    "transform-origin:50% 50%",
    "will-change:transform,opacity",
    "user-select:none",
    "-webkit-user-select:none",
    "-webkit-user-drag:none",
  ].join(";");
  markFrame.innerHTML = [
    '<svg width="156" height="156" viewBox="0 0 100 100" fill="none" aria-hidden="true" draggable="false" style="display:block;overflow:visible;filter:drop-shadow(0 0 7px rgba(79,219,94,.2));user-select:none;-webkit-user-select:none">',
    '<g data-hf-loader-mark transform="translate(50 50)">',
    '<g data-hf-loader-core transform="scale(1)" opacity=".92">',
    '<g transform="translate(-50 -50)">',
    '<path data-hf-loader-left d="M10.1851 57.8021L33.1145 73.8313C36.2202 75.9978 41.5173 73.5433 42.4816 69.4984L51.7611 30.4271C52.7253 26.3822 48.5802 23.9277 44.4602 26.0942L13.917 42.1235C6.96677 45.7676 4.97564 54.1579 10.1851 57.8021Z" fill="url(#hyper-shader-loader-grad-left)"/>',
    '<path data-hf-loader-right d="M87.5129 57.5141L56.9696 73.5433C52.8371 75.7098 48.7046 73.2553 49.6688 69.2104L58.9483 30.1391C59.9125 26.0942 65.2097 23.6397 68.3154 25.8062L91.2447 41.8354C96.4668 45.4796 94.4631 53.8699 87.5129 57.5141Z" fill="url(#hyper-shader-loader-grad-right)"/>',
    "</g>",
    "</g>",
    "</g>",
    "<defs>",
    '<linearGradient id="hyper-shader-loader-grad-left" x1="48.5676" y1="25" x2="44.7804" y2="71.9384" gradientUnits="userSpaceOnUse">',
    '<stop stop-color="#06E3FA"/>',
    '<stop offset="1" stop-color="#4FDB5E"/>',
    "</linearGradient>",
    '<linearGradient id="hyper-shader-loader-grad-right" x1="54.8282" y1="73.8392" x2="72.0989" y2="32.8932" gradientUnits="userSpaceOnUse">',
    '<stop stop-color="#06E3FA"/>',
    '<stop offset="1" stop-color="#4FDB5E"/>',
    "</linearGradient>",
    "</defs>",
    "</svg>",
  ].join("");
  const mark = markFrame.querySelector("svg");
  if (!mark) return null;
  mark.setAttribute("draggable", "false");

  const phrase = doc.createElement("div");
  phrase.style.cssText = [
    "width:100%",
    "height:72px",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "overflow:hidden",
    "white-space:nowrap",
    "text-overflow:ellipsis",
    "font:600 44px/1.15 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "letter-spacing:0",
    "text-align:center",
    "color:#f4f7fb",
  ].join(";");

  const phraseText = doc.createElement("span");
  phraseText.textContent = SNAPSHOT_LOADING_PHRASES[0] ?? "Preparing scene transitions";

  const detail = doc.createElement("div");
  detail.textContent = "Sampling animated scene frames so shader transitions stay in motion.";
  detail.style.cssText = [
    "width:min(760px,100%)",
    "height:44px",
    "overflow:hidden",
    "white-space:nowrap",
    "text-overflow:ellipsis",
    "color:rgba(244,247,251,0.64)",
    "font:400 24px/1.5 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
  ].join(";");

  phrase.appendChild(phraseText);

  const track = doc.createElement("div");
  track.setAttribute("aria-hidden", "true");
  track.style.cssText = [
    "width:min(520px,100%)",
    "height:10px",
    "overflow:hidden",
    "border-radius:999px",
    "background:rgba(255,255,255,0.1)",
  ].join(";");

  const fill = doc.createElement("div");
  fill.style.cssText = [
    "width:100%",
    "height:100%",
    "transform:scaleX(0)",
    "transform-origin:left center",
    "border-radius:inherit",
    "background:linear-gradient(90deg,#06e3fa,#4fdb5e)",
    "transition:transform 160ms ease",
  ].join(";");

  const progressText = doc.createElement("div");
  progressText.style.cssText = [
    "width:min(560px,100%)",
    "height:54px",
    "overflow:hidden",
    "display:grid",
    "grid-template-rows:repeat(2,27px)",
    "font:500 18px/27px 'IBM Plex Mono','SF Mono','Fira Code',monospace",
    "font-variant-numeric:tabular-nums",
    "color:rgba(244,247,251,0.48)",
  ].join(";");
  const createProgressRow = (labelText: string) => {
    const row = doc.createElement("div");
    row.style.cssText = [
      "display:grid",
      "grid-template-columns:minmax(0,1fr) auto",
      "align-items:center",
      "column-gap:28px",
      "width:100%",
      "height:27px",
      "white-space:nowrap",
    ].join(";");

    const label = doc.createElement("span");
    label.textContent = labelText;
    label.style.cssText = [
      "overflow:hidden",
      "text-overflow:ellipsis",
      "text-align:left",
      "min-width:0",
    ].join(";");

    const value = doc.createElement("span");
    value.style.cssText = ["min-width:76px", "text-align:right"].join(";");

    row.appendChild(label);
    row.appendChild(value);
    progressText.appendChild(row);
    return { row, label, value };
  };
  const transitionStatus = createProgressRow("transition");
  const frameStatus = createProgressRow("transition frame");

  track.appendChild(fill);
  panel.appendChild(markFrame);
  panel.appendChild(phrase);
  panel.appendChild(detail);
  panel.appendChild(track);
  panel.appendChild(progressText);
  overlay.appendChild(panel);
  host.appendChild(overlay);

  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  return {
    show: () => {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
      overlay.style.display = "grid";
      overlay.style.opacity = "1";
      overlay.style.pointerEvents = "auto";
    },
    update: (status: SnapshotLoadingStatus) => {
      const { progress, total } = status;
      const ratio = total > 0 ? clampNumber(progress / total, 0, 1) : 0;
      const phraseIndex = Math.min(
        SNAPSHOT_LOADING_PHRASES.length - 1,
        Math.floor(ratio * SNAPSHOT_LOADING_PHRASES.length),
      );
      const nextPhrase = SNAPSHOT_LOADING_PHRASES[phraseIndex] ?? "Preparing scene transitions";
      phraseText.textContent = nextPhrase;
      fill.style.transform = `scaleX(${ratio})`;
      const transitionValue =
        status.currentTransition !== undefined && status.transitionTotal !== undefined
          ? `${status.currentTransition}/${status.transitionTotal}`
          : total > 0
            ? `${progress}/${total}`
            : "";
      const frameValue =
        status.transitionFrame !== undefined && status.transitionFrames !== undefined
          ? `${status.transitionFrame}/${status.transitionFrames}`
          : "";
      const phaseLabel =
        status.phase === "cached"
          ? "loading cached transition frames"
          : status.phase === "finalizing"
            ? "finalizing"
            : "rendering transition frames";

      transitionStatus.label.textContent =
        status.currentTransition !== undefined ? "transition" : "transition frames";
      transitionStatus.value.textContent = transitionValue;
      frameStatus.label.textContent = phaseLabel;
      frameStatus.value.textContent = frameValue;
      frameStatus.row.style.visibility = frameValue ? "visible" : "hidden";
      overlay.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    },
    hide: () => {
      if (hideTimeout) clearTimeout(hideTimeout);
      if (overlay.style.display === "none") return;
      overlay.style.opacity = "0";
      overlay.style.pointerEvents = "none";
      hideTimeout = setTimeout(() => {
        overlay.style.display = "none";
        overlay.style.opacity = "1";
        overlay.style.pointerEvents = "auto";
        hideTimeout = null;
      }, 240);
    },
  };
}

export function init(config: HyperShaderConfig): GsapTimeline {
  const { bgColor, scenes, transitions } = config;

  if (scenes.length !== transitions.length + 1) {
    throw new Error(
      `[HyperShader] init(): expected scenes.length === transitions.length + 1, got scenes=${scenes.length}, transitions=${transitions.length}`,
    );
  }

  // Verify each scene id resolves to an element with the `.scene` class.
  // Capture and compositing later assume both — without this guard the
  // texture map gets stale ids and transitions silently no-op.
  if (typeof document !== "undefined") {
    const missing: string[] = [];
    const notScene: string[] = [];
    for (const id of scenes) {
      const el = document.getElementById(id);
      if (!el) {
        missing.push(id);
      } else if (!el.classList.contains("scene")) {
        notScene.push(id);
      }
    }
    if (missing.length > 0) {
      throw new Error(`[HyperShader] init(): scene ids not found in DOM: ${missing.join(", ")}`);
    }
    if (notScene.length > 0) {
      throw new Error(
        `[HyperShader] init(): elements found but missing .scene class: ${notScene.join(", ")}`,
      );
    }
  }

  // Locally redeclared (not imported) because @hyperframes/shader-transitions
  // ships as a standalone CDN bundle and must not depend on @hyperframes/engine.
  // Keep this in sync with HfTransitionMeta in packages/engine/src/types.ts.
  interface HfTransitionMeta {
    time: number;
    duration: number;
    shader: string;
    ease: string;
    fromScene: string;
    toScene: string;
  }
  type HfWindowWrite = { __hf?: { transitions?: HfTransitionMeta[] } };
  if (typeof window !== "undefined") {
    const hfWin = window as unknown as HfWindowWrite;
    if (hfWin.__hf) {
      hfWin.__hf.transitions = transitions.map((t: TransitionConfig, i: number) => ({
        time: t.time,
        duration: t.duration ?? DEFAULT_DURATION,
        shader: t.shader,
        ease: t.ease ?? DEFAULT_EASE,
        fromScene: scenes[i] ?? "",
        toScene: scenes[i + 1] ?? "",
      }));
    }
  }

  const accentColors: AccentColors = config.accentColor
    ? deriveAccentColors(config.accentColor)
    : { accent: [1, 0.6, 0.2], dark: [0.4, 0.15, 0], bright: [1, 0.85, 0.5] };

  const root = document.querySelector<HTMLElement>("[data-composition-id]");
  const compId = config.compositionId || root?.getAttribute("data-composition-id") || "main";
  const rawW = Number(root?.getAttribute("data-width"));
  const rawH = Number(root?.getAttribute("data-height"));
  const compWidth = Number.isFinite(rawW) && rawW > 0 ? rawW : DEFAULT_WIDTH;
  const compHeight = Number.isFinite(rawH) && rawH > 0 ? rawH : DEFAULT_HEIGHT;

  // The Hyperframes engine injects a virtual-time shim (window.__HF_VIRTUAL_TIME__)
  // during render mode and composites every transition itself from the
  // window.__hf.transitions metadata above. Doing GL work or html2canvas captures
  // here would (a) waste cycles and (b) leave .scene elements stuck at opacity:0
  // because captureScene resolves asynchronously, after the engine has already
  // sampled the DOM. In that mode we only need to keep each scene's effective
  // opacity correct so queryElementStacking() reports the right visibility.
  const isEngineRenderMode =
    typeof window !== "undefined" &&
    Boolean((window as unknown as { __HF_VIRTUAL_TIME__?: unknown }).__HF_VIRTUAL_TIME__);

  if (isEngineRenderMode) {
    return initEngineMode(config, scenes, transitions, compId, root);
  }

  const state: TransState = {
    active: false,
    prog: null,
    progress: 0,
    transitionIndex: -1,
  };

  let glCanvas = document.getElementById("gl-canvas") as HTMLCanvasElement | null;
  if (!glCanvas) {
    glCanvas = document.createElement("canvas");
    glCanvas.id = "gl-canvas";
    glCanvas.style.cssText = `position:absolute;top:0;left:0;z-index:100;pointer-events:none;display:none;`;
    (root || document.body).appendChild(glCanvas);
  }
  glCanvas.width = compWidth;
  glCanvas.height = compHeight;
  glCanvas.style.width = `${compWidth}px`;
  glCanvas.style.height = `${compHeight}px`;

  const gl = createContext(glCanvas, compWidth, compHeight);
  if (!gl) {
    console.warn("[HyperShader] WebGL unavailable — shader transitions disabled.");
    const fallback = config.timeline || gsap.timeline({ paused: true });
    registerTimeline(compId, fallback, config.timeline);
    return fallback;
  }

  const quadBuf = setupQuad(gl);

  const programs = new Map<string, WebGLProgram>();
  for (const t of transitions) {
    if (!programs.has(t.shader)) {
      try {
        programs.set(t.shader, createProgram(gl, getFragSource(t.shader)));
      } catch (e) {
        console.error(`[HyperShader] Failed to compile "${t.shader}":`, e);
      }
    }
  }

  const canvasEl = glCanvas;
  const previewCaptureFps = clampNumber(resolvePositiveNumber(config.previewCaptureFps, 30), 1, 60);
  const previewCaptureScale = resolvePlayerCaptureScale();
  const loadingMode = resolvePlayerLoadingMode();
  const previewTextureWidth = Math.max(1, Math.round(compWidth * previewCaptureScale));
  const previewTextureHeight = Math.max(1, Math.round(compHeight * previewCaptureScale));
  const cachedTransitions: CachedTransition[] = [];
  const blendProg = createProgramWithVertex(
    gl,
    NO_FLIP_VERT_SRC,
    [
      "precision mediump float;",
      "varying vec2 v_uv;",
      "uniform sampler2D u_a;",
      "uniform sampler2D u_b;",
      "uniform float u_mix;",
      "void main(){",
      "gl_FragColor=mix(texture2D(u_a,v_uv),texture2D(u_b,v_uv),u_mix);",
      "}",
    ].join(""),
  );
  const blendLoc = {
    a: gl.getUniformLocation(blendProg, "u_a"),
    b: gl.getUniformLocation(blendProg, "u_b"),
    mix: gl.getUniformLocation(blendProg, "u_mix"),
    pos: gl.getAttribLocation(blendProg, "a_pos"),
  };
  const interpolatedFromTex = createRenderTexture(gl, previewTextureWidth, previewTextureHeight);
  const interpolatedToTex = createRenderTexture(gl, previewTextureWidth, previewTextureHeight);
  const interpolatedFromFbo = createFramebuffer(gl, interpolatedFromTex);
  const interpolatedToFbo = createFramebuffer(gl, interpolatedToTex);
  let loadingOverlay: SnapshotLoadingOverlay | null = null;
  const getLoadingOverlay = (): SnapshotLoadingOverlay | null => {
    if (loadingMode !== "internal") return null;
    loadingOverlay = loadingOverlay || createSnapshotLoadingOverlay(root, compWidth, compHeight);
    return loadingOverlay;
  };
  let shaderCacheReady = false;
  let prewarming = false;
  let sceneMutationSuppressionDepth = 0;
  let ignoreSceneMutationsUntil = 0;
  const scenePointerEvents = new WeakMap<HTMLElement, string>();

  const markRuntimeSceneMutation = (): void => {
    ignoreSceneMutationsUntil = performance.now() + 120;
  };

  const rememberScenePointerEvents = (scene: HTMLElement): void => {
    if (!scenePointerEvents.has(scene)) {
      scenePointerEvents.set(scene, scene.style.pointerEvents);
    }
  };

  const setScenePlaybackState = (scene: HTMLElement, visible: boolean, opacity: string): void => {
    rememberScenePointerEvents(scene);
    markRuntimeSceneMutation();
    scene.style.opacity = opacity;
    scene.style.visibility = visible ? "visible" : "hidden";
    scene.style.pointerEvents = visible ? (scenePointerEvents.get(scene) ?? "") : "none";
  };

  const paintScenePairState = (
    fromId: string,
    toId: string,
    fromOpacity: string,
    toOpacity: string,
  ): void => {
    scenes.forEach((sceneId) => {
      const scene = document.getElementById(sceneId);
      if (!scene) return;
      if (sceneId === fromId) {
        setScenePlaybackState(scene, true, fromOpacity);
      } else if (sceneId === toId) {
        setScenePlaybackState(scene, true, toOpacity);
      } else {
        setScenePlaybackState(scene, false, "0");
      }
    });
  };

  const disposeCaptureCanvas = (canvas: HTMLCanvasElement): void => {
    canvas.width = 0;
    canvas.height = 0;
  };

  const captureLiveScene = (scene: HTMLElement): Promise<HTMLCanvasElement> => {
    return captureScene(scene, bgColor, compWidth, compHeight, {
      forceVisible: true,
      scale: previewCaptureScale,
    });
  };

  const waitForPaint = (): Promise<void> => {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  };

  const hasFrameTextures = (
    frame: CachedTransitionFrame | undefined,
  ): frame is TexturedTransitionFrame => {
    return Boolean(frame?.fromTex && frame.toTex);
  };

  const selectCachedFrameBlend = (
    cache: CachedTransition,
    progress: number,
  ): CachedTransitionFrameBlend | null => {
    if (cache.frames.length === 0) return null;
    const position = clampNumber(progress, 0, 1) * (cache.frames.length - 1);
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const a = cache.frames[lowerIndex] ?? cache.frames[cache.frames.length - 1];
    const b = cache.frames[upperIndex] ?? a;
    if (!hasFrameTextures(a) || !hasFrameTextures(b)) return null;
    return { a, b, mix: position - lowerIndex };
  };

  const renderTextureBlend = (
    target: WebGLFramebuffer,
    texA: WebGLTexture,
    texB: WebGLTexture,
    mix: number,
  ): void => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, previewTextureWidth, previewTextureHeight);
    gl.useProgram(blendProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texA);
    gl.uniform1i(blendLoc.a, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.uniform1i(blendLoc.b, 1);
    gl.uniform1f(blendLoc.mix, mix);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(blendLoc.pos);
    gl.vertexAttribPointer(blendLoc.pos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, compWidth, compHeight);
  };

  const preloadTransitionTextures = (cache: CachedTransition): void => {
    void ensureTransitionTextures(cache).then((loaded) => {
      if (!loaded) return;
      const now = tl.time();
      if (now >= cache.time && now < cache.time + cache.duration) {
        tickShader();
      }
    });
  };

  const resolveSettledSceneIndex = (currentTime: number): number => {
    let index = 0;
    for (let i = 0; i < cachedTransitions.length; i += 1) {
      const cache = cachedTransitions[i];
      if (cache && currentTime >= cache.time + cache.duration) {
        index = i + 1;
      }
    }
    return clampNumber(index, 0, scenes.length - 1);
  };

  const paintSettledSceneState = (currentTime: number): void => {
    const visibleIndex = resolveSettledSceneIndex(currentTime);
    scenes.forEach((sceneId, index) => {
      const scene = document.getElementById(sceneId);
      if (!scene) return;
      const visible = index === visibleIndex;
      setScenePlaybackState(scene, visible, visible ? "1" : "0");
    });
  };

  const applyFallbackTransition = (cache: CachedTransition, progress: number): void => {
    const fromScene = document.getElementById(cache.fromId);
    const toScene = document.getElementById(cache.toId);
    if (!fromScene || !toScene) return;
    const eased = progress * progress * (3 - 2 * progress);
    canvasEl.style.display = "none";
    paintScenePairState(cache.fromId, cache.toId, String(1 - eased), String(eased));
  };

  const tickShader = () => {
    if (prewarming) {
      return;
    }

    const currentTime = tl.time();
    const upcoming = cachedTransitions.find((cache) => {
      return (
        !cache.fallback &&
        cache.ready &&
        !cache.dirty &&
        !cache.textureReady &&
        currentTime >= cache.time - TEXTURE_PRELOAD_LOOKAHEAD_SECONDS &&
        currentTime < cache.time + cache.duration
      );
    });
    if (upcoming) {
      preloadTransitionTextures(upcoming);
    }

    const activeIndex = cachedTransitions.findIndex((cache) => {
      return currentTime >= cache.time && currentTime < cache.time + cache.duration;
    });
    if (activeIndex < 0) {
      state.active = false;
      state.transitionIndex = -1;
      canvasEl.style.display = "none";
      paintSettledSceneState(currentTime);
      return;
    }

    const cache = cachedTransitions[activeIndex];
    if (!cache || cache.dirty || !cache.ready) {
      canvasEl.style.display = "none";
      return;
    }
    if (cache.fallback) {
      state.active = true;
      state.transitionIndex = activeIndex;
      state.prog = null;
      state.progress = clampNumber((currentTime - cache.time) / cache.duration, 0, 1);
      applyFallbackTransition(cache, state.progress);
      return;
    }
    if (!cache.textureReady) {
      preloadTransitionTextures(cache);
      canvasEl.style.display = "none";
      return;
    }

    state.active = true;
    state.transitionIndex = activeIndex;
    state.prog = cache.prog;
    state.progress = clampNumber((currentTime - cache.time) / cache.duration, 0, 1);
    markTextureAccess(cache);

    const frame = selectCachedFrameBlend(cache, state.progress);
    if (!frame) {
      canvasEl.style.display = "none";
      return;
    }
    paintScenePairState(cache.fromId, cache.toId, "1", "1");
    renderTextureBlend(interpolatedFromFbo, frame.a.fromTex, frame.b.fromTex, frame.mix);
    renderTextureBlend(interpolatedToFbo, frame.a.toTex, frame.b.toTex, frame.mix);

    canvasEl.style.display = "block";
    renderShader(
      gl,
      quadBuf,
      state.prog,
      interpolatedFromTex,
      interpolatedToTex,
      state.progress,
      accentColors,
      compWidth,
      compHeight,
    );
  };

  let tl: GsapTimeline;
  if (config.timeline) {
    tl = config.timeline;
    const duration = Number(root?.getAttribute("data-duration") || "40");
    tl.to({ t: 0 }, { t: 1, duration, ease: "none", onUpdate: tickShader }, 0);
  } else {
    tl = gsap.timeline({ paused: true, onUpdate: tickShader });
  }

  const originalPlay = tl.play.bind(tl) as (...args: unknown[]) => GsapTimeline;
  const originalPause = tl.pause.bind(tl) as (...args: unknown[]) => GsapTimeline;
  const originalTime = tl.time.bind(tl) as (...args: unknown[]) => GsapTimeline | number;
  const originalSeek =
    typeof tl.seek === "function"
      ? (tl.seek.bind(tl) as (...args: unknown[]) => GsapTimeline)
      : null;
  const readActualTimelineTime = (): number => {
    const value = originalTime();
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  let publicTimelineTime = readActualTimelineTime();
  const updatePublicTimelineTime = (value: unknown): void => {
    if (typeof value === "number" && Number.isFinite(value)) {
      publicTimelineTime = value;
    }
  };
  const getPlaybackRequestTime = (args: unknown[], fallback: number): number => {
    const requestedTime = args[0];
    return typeof requestedTime === "number" && Number.isFinite(requestedTime)
      ? requestedTime
      : fallback;
  };
  const setActualTimelineTime = (time: number, suppressEvents: boolean): GsapTimeline => {
    const result = originalTime(time, suppressEvents);
    return typeof result === "number" ? tl : result;
  };
  const suppressSceneMutationTracking = <T>(fn: () => T): T => {
    sceneMutationSuppressionDepth += 1;
    try {
      return fn();
    } finally {
      sceneMutationSuppressionDepth -= 1;
      ignoreSceneMutationsUntil = performance.now() + 120;
    }
  };
  let pendingPlay = false;
  let pendingPlayArgs: unknown[] = [];
  let cancelResumeAfterPrewarm = false;
  tl.play = ((...args: unknown[]) => {
    updatePublicTimelineTime(args[0]);
    const requestedTime = getPlaybackRequestTime(args, publicTimelineTime);
    if (!areAllCachesReady() || !arePlaybackTexturesReady(requestedTime)) {
      cancelResumeAfterPrewarm = false;
      pendingPlay = true;
      pendingPlayArgs = args;
      void ensureTransitionCachesReady();
      return tl;
    }
    const result = suppressSceneMutationTracking(() => originalPlay(...args));
    publicTimelineTime = readActualTimelineTime();
    return result;
  }) as GsapTimeline["play"];
  tl.pause = ((...args: unknown[]) => {
    pendingPlay = false;
    pendingPlayArgs = [];
    updatePublicTimelineTime(args[0]);
    if (prewarming) {
      cancelResumeAfterPrewarm = true;
      return tl;
    }
    const result = suppressSceneMutationTracking(() => originalPause(...args));
    publicTimelineTime = readActualTimelineTime();
    if (args.length > 0) {
      tickShader();
    }
    return result;
  }) as GsapTimeline["pause"];
  tl.time = ((...args: unknown[]) => {
    if (args.length === 0) {
      if (!prewarming) {
        publicTimelineTime = readActualTimelineTime();
      }
      return publicTimelineTime;
    }
    updatePublicTimelineTime(args[0]);
    if (prewarming) {
      return tl;
    }
    const result = suppressSceneMutationTracking(() => originalTime(...args));
    if (!prewarming) {
      publicTimelineTime = readActualTimelineTime();
    }
    tickShader();
    return result;
  }) as GsapTimeline["time"];
  if (originalSeek) {
    tl.seek = ((...args: unknown[]) => {
      updatePublicTimelineTime(args[0]);
      if (prewarming) {
        return tl;
      }
      const result = suppressSceneMutationTracking(() => originalSeek(...args));
      if (!prewarming) {
        publicTimelineTime = readActualTimelineTime();
      }
      tickShader();
      return result;
    }) as NonNullable<GsapTimeline["seek"]>;
  }

  initCapture();
  glCanvas.style.display = "none";

  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    const fromId = scenes[i];
    const toId = scenes[i + 1];
    if (!fromId || !toId) continue;

    const prog = programs.get(t.shader);
    if (!prog) continue;

    const dur = t.duration ?? DEFAULT_DURATION;
    const ease = t.ease ?? DEFAULT_EASE;
    const T = t.time;
    const cacheIndex = cachedTransitions.length;
    cachedTransitions.push({
      index: cacheIndex,
      time: T,
      duration: dur,
      fromId,
      toId,
      prog,
      frames: [],
      cacheKey: "",
      dirty: true,
      ready: false,
      fallback: false,
      persisted: false,
      textureReady: false,
      texturePromise: null,
      textureGeneration: 0,
      textureAccess: 0,
    });

    tl.call(
      () => {
        suppressSceneMutationTracking(() => {
          const fromScene = document.getElementById(fromId);
          const toScene = document.getElementById(toId);
          if (!fromScene || !toScene) return;

          state.prog = prog;
          state.transitionIndex = cacheIndex;
          state.progress = 0;
          state.active = true;
          const cache = cachedTransitions[cacheIndex];
          if (cache?.fallback) {
            applyFallbackTransition(cache, 0);
            return;
          }
          canvasEl.style.display =
            !prewarming && cache?.ready && !cache.dirty && cache.textureReady ? "block" : "none";
          paintScenePairState(fromId, toId, "1", "1");
        });
      },
      null,
      T,
    );

    const proxy = { p: 0 };
    tl.to(
      proxy,
      {
        p: 1,
        duration: dur,
        ease,
        onUpdate: () => {
          state.progress = proxy.p;
        },
      },
      T,
    );

    tl.call(
      () => {
        suppressSceneMutationTracking(() => {
          state.active = false;
          state.transitionIndex = -1;
          canvasEl.style.display = "none";
          paintSettledSceneState(T + dur);
        });
      },
      null,
      T + dur,
    );
  }

  type ShaderReadyState = {
    ready: boolean;
    progress: number;
    total: number;
    currentTransition?: number;
    transitionTotal?: number;
    transitionFrame?: number;
    transitionFrames?: number;
    phase?: SnapshotLoadingStatus["phase"];
    dirtyTransitions: number;
    captureScale: number;
    textureWidth: number;
    textureHeight: number;
    fps: number;
    loading: boolean;
    error?: string;
  };

  const sampleCountForCache = (cache: CachedTransition): number => {
    return Math.max(2, Math.ceil(cache.duration * previewCaptureFps) + 1);
  };

  const areAllCachesReady = (): boolean => {
    return cachedTransitions.every((cache) => cache.ready && !cache.dirty);
  };

  const getPlaybackTextureWindow = (currentTime: number): CachedTransition[] => {
    const selected: CachedTransition[] = [];
    const selectedIndexes = new Set<number>();
    const addIfNeeded = (cache: CachedTransition): void => {
      if (selectedIndexes.has(cache.index)) return;
      if (cache.fallback || cache.dirty || !cache.ready) return;
      selected.push(cache);
      selectedIndexes.add(cache.index);
    };

    for (const cache of cachedTransitions) {
      if (currentTime >= cache.time && currentTime < cache.time + cache.duration) {
        addIfNeeded(cache);
      }
    }

    const nextUpcoming = cachedTransitions.find((cache) => cache.time >= currentTime);
    if (nextUpcoming) {
      addIfNeeded(nextUpcoming);
    }

    for (const cache of cachedTransitions) {
      if (
        cache.time >= currentTime &&
        cache.time - currentTime <= TEXTURE_PRELOAD_LOOKAHEAD_SECONDS
      ) {
        addIfNeeded(cache);
      }
    }
    return selected.slice(0, MAX_TEXTURED_TRANSITIONS);
  };

  const arePlaybackTexturesReady = (currentTime: number): boolean => {
    return getPlaybackTextureWindow(currentTime).every((cache) => cache.textureReady);
  };

  let textureAccessCounter = 0;

  const disposeTransitionTextures = (cache: CachedTransition): void => {
    cache.textureGeneration += 1;
    for (const frame of cache.frames) {
      if (frame.fromTex) {
        gl.deleteTexture(frame.fromTex);
        frame.fromTex = null;
      }
      if (frame.toTex) {
        gl.deleteTexture(frame.toTex);
        frame.toTex = null;
      }
    }
    cache.textureReady = false;
  };

  const disposeCachedTransition = (cache: CachedTransition): void => {
    disposeTransitionTextures(cache);
    cache.texturePromise = null;
    cache.frames = [];
    cache.ready = false;
    cache.fallback = false;
    cache.persisted = false;
    cache.textureReady = false;
    cache.lastError = undefined;
  };

  const markTextureAccess = (cache: CachedTransition): void => {
    textureAccessCounter += 1;
    cache.textureAccess = textureAccessCounter;
  };

  const enforceTextureBudget = (keep: CachedTransition): void => {
    const loaded = cachedTransitions
      .filter((cache) => cache !== keep && cache.textureReady)
      .sort((a, b) => a.textureAccess - b.textureAccess);
    while (loaded.length >= MAX_TEXTURED_TRANSITIONS) {
      const evict = loaded.shift();
      if (!evict) break;
      disposeTransitionTextures(evict);
    }
  };

  const buildTransitionCacheKey = (cache: CachedTransition, sampleCount: number): string => {
    const source = [
      SNAPSHOT_CACHE_SCHEMA,
      compId,
      cache.index,
      cache.fromId,
      getSceneSignature(cache.fromId),
      cache.toId,
      getSceneSignature(cache.toId),
      transitions[cache.index]?.shader || "unknown",
      cache.time,
      cache.duration,
      sampleCount,
      previewCaptureFps,
      previewCaptureScale,
      previewTextureWidth,
      previewTextureHeight,
      compWidth,
      compHeight,
    ].join("|");
    return `${compId}:${cache.index}:${stableHash(source)}`;
  };

  const setShaderReadyState = (status: Partial<ShaderReadyState>) => {
    const hfWin = window as unknown as {
      __hf?: {
        shaderTransitions?: Record<string, ShaderReadyState>;
      };
    };
    hfWin.__hf = hfWin.__hf || {};
    hfWin.__hf.shaderTransitions = hfWin.__hf.shaderTransitions || {};
    const current = hfWin.__hf.shaderTransitions[compId] || {
      ready: false,
      progress: 0,
      total: 0,
      dirtyTransitions: cachedTransitions.length,
      captureScale: previewCaptureScale,
      textureWidth: previewTextureWidth,
      textureHeight: previewTextureHeight,
      fps: previewCaptureFps,
      loading: true,
    };
    const next = { ...current, ...status };
    next.dirtyTransitions = cachedTransitions.filter((cache) => cache.dirty || !cache.ready).length;
    hfWin.__hf.shaderTransitions[compId] = next;
    window.parent?.postMessage(
      {
        source: "hf-preview",
        type: "shader-transition-state",
        compositionId: compId,
        state: next,
      },
      "*",
    );
    if (next.loading) {
      const overlay = getLoadingOverlay();
      overlay?.show();
      overlay?.update({
        progress: next.progress,
        total: next.total,
        currentTransition: next.currentTransition,
        transitionTotal: next.transitionTotal,
        transitionFrame: next.transitionFrame,
        transitionFrames: next.transitionFrames,
        phase: next.phase,
      });
    }
    if (next.ready) {
      loadingOverlay?.hide();
    } else if (!next.loading) {
      loadingOverlay?.hide();
    }
  };

  const shouldIgnoreSceneMutation = (): boolean => {
    return (
      prewarming ||
      sceneMutationSuppressionDepth > 0 ||
      performance.now() < ignoreSceneMutationsUntil ||
      !tl.paused()
    );
  };

  const markScenesDirty = (sceneIds: Set<string>): void => {
    if (sceneIds.size === 0) return;
    let changed = false;
    for (const cache of cachedTransitions) {
      if (!sceneIds.has(cache.fromId) && !sceneIds.has(cache.toId)) continue;
      disposeCachedTransition(cache);
      cache.dirty = true;
      cache.cacheKey = "";
      changed = true;
    }
    if (!changed) return;
    shaderCacheReady = areAllCachesReady();
    setShaderReadyState({
      ready: shaderCacheReady,
      progress: 0,
      total: 0,
      currentTransition: undefined,
      transitionTotal: undefined,
      transitionFrame: undefined,
      transitionFrames: undefined,
      phase: undefined,
      loading: false,
    });
    window.dispatchEvent(
      new CustomEvent("hyperShader:dirty", {
        detail: { compositionId: compId, scenes: Array.from(sceneIds) },
      }),
    );
  };

  const observeSceneEdits = (): MutationObserver[] => {
    const sceneElements = scenes
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el instanceof HTMLElement);
    const observers: MutationObserver[] = [];
    for (const scene of sceneElements) {
      const observer = new MutationObserver((mutations) => {
        if (shouldIgnoreSceneMutation()) return;
        const affected = new Set<string>();
        for (const mutation of mutations) {
          const target =
            mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          if (!target) continue;
          for (const candidate of sceneElements) {
            if (candidate === target || candidate.contains(target)) {
              affected.add(candidate.id);
            }
          }
        }
        markScenesDirty(affected);
      });
      observer.observe(scene, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
      observers.push(observer);
    }

    const styleObserver = new MutationObserver(() => {
      if (shouldIgnoreSceneMutation()) return;
      markScenesDirty(new Set(scenes));
    });
    styleObserver.observe(document.head, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    observers.push(styleObserver);
    return observers;
  };

  const hydrateTransitionCache = async (
    cache: CachedTransition,
    sampleCount: number,
    onProgress: (transitionFrame: number) => void,
  ): Promise<boolean> => {
    const hydratedFrames: CachedTransitionFrame[] = [];
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const [fromEntry, toEntry] = await Promise.all([
        getSnapshotEntry(makeSnapshotKey(cache.cacheKey, sampleIndex, "from")),
        getSnapshotEntry(makeSnapshotKey(cache.cacheKey, sampleIndex, "to")),
      ]);
      if (!fromEntry || !toEntry) {
        for (const frame of hydratedFrames) {
          gl.deleteTexture(frame.fromTex);
          gl.deleteTexture(frame.toTex);
        }
        return false;
      }

      hydratedFrames.push({
        sampleIndex,
        fromBlob: fromEntry.blob,
        toBlob: toEntry.blob,
        fromTex: null,
        toTex: null,
      });
      onProgress(sampleIndex + 1);
    }
    cache.frames = hydratedFrames;
    cache.ready = true;
    cache.dirty = false;
    cache.fallback = false;
    cache.persisted = true;
    cache.textureReady = false;
    return true;
  };

  const ensureTransitionTextures = (cache: CachedTransition): Promise<boolean> => {
    if (cache.fallback || cache.dirty || !cache.ready) return Promise.resolve(false);
    if (cache.textureReady) {
      markTextureAccess(cache);
      return Promise.resolve(true);
    }
    if (cache.texturePromise) return cache.texturePromise;

    const generation = cache.textureGeneration;
    const frames = cache.frames;
    const uploadedTextures: WebGLTexture[] = [];
    const isStaleTextureJob = (): boolean => {
      return cache.textureGeneration !== generation || cache.dirty || cache.frames !== frames;
    };
    const disposeUploadedTextures = (): void => {
      const deleted = new Set<WebGLTexture>();
      for (const tex of uploadedTextures) {
        if (!deleted.has(tex)) {
          gl.deleteTexture(tex);
          deleted.add(tex);
        }
      }
      for (const frame of frames) {
        if (frame.fromTex && !deleted.has(frame.fromTex)) {
          gl.deleteTexture(frame.fromTex);
          deleted.add(frame.fromTex);
        }
        if (frame.toTex && !deleted.has(frame.toTex)) {
          gl.deleteTexture(frame.toTex);
          deleted.add(frame.toTex);
        }
        frame.fromTex = null;
        frame.toTex = null;
      }
    };
    const getFrameBlob = async (
      frame: CachedTransitionFrame,
      side: "from" | "to",
    ): Promise<Blob> => {
      const cached = side === "from" ? frame.fromBlob : frame.toBlob;
      if (cached) return cached;
      const entry = await getSnapshotEntry(
        makeSnapshotKey(cache.cacheKey, frame.sampleIndex, side),
      );
      if (entry?.blob) return entry.blob;
      throw new Error("[HyperShader] Cached transition snapshot blob is unavailable");
    };

    let texturePromise = Promise.resolve(false);
    texturePromise = (async () => {
      for (const frame of frames) {
        if (isStaleTextureJob()) {
          disposeUploadedTextures();
          return false;
        }
        if (!frame.fromTex) {
          const fromBlob = await getFrameBlob(frame, "from");
          if (isStaleTextureJob()) {
            disposeUploadedTextures();
            return false;
          }
          const source = await blobToTextureSource(fromBlob);
          const tex = createTexture(gl);
          uploadedTextures.push(tex);
          try {
            uploadTextureSource(gl, tex, source);
            if (isStaleTextureJob()) {
              disposeUploadedTextures();
              return false;
            }
            frame.fromTex = tex;
          } finally {
            closeTextureSource(source);
          }
        }
        if (!frame.toTex) {
          const toBlob = await getFrameBlob(frame, "to");
          if (isStaleTextureJob()) {
            disposeUploadedTextures();
            return false;
          }
          const source = await blobToTextureSource(toBlob);
          const tex = createTexture(gl);
          uploadedTextures.push(tex);
          try {
            uploadTextureSource(gl, tex, source);
            if (isStaleTextureJob()) {
              disposeUploadedTextures();
              return false;
            }
            frame.toTex = tex;
          } finally {
            closeTextureSource(source);
          }
        }
        if (cache.persisted) {
          frame.fromBlob = null;
          frame.toBlob = null;
        }
      }
      if (isStaleTextureJob()) {
        disposeUploadedTextures();
        return false;
      }
      cache.textureReady = frames.every((frame) => Boolean(frame.fromTex && frame.toTex));
      if (cache.textureReady) {
        markTextureAccess(cache);
        enforceTextureBudget(cache);
      }
      return cache.textureReady;
    })()
      .catch((e) => {
        disposeUploadedTextures();
        if (isStaleTextureJob()) {
          return false;
        }
        disposeTransitionTextures(cache);
        cache.fallback = true;
        cache.ready = true;
        cache.dirty = false;
        cache.lastError = e instanceof Error ? e.message : String(e);
        setShaderReadyState({
          ready: areAllCachesReady(),
          loading: false,
          error: cache.lastError,
        });
        return false;
      })
      .finally(() => {
        if (cache.texturePromise === texturePromise) {
          cache.texturePromise = null;
        }
      });

    cache.texturePromise = texturePromise;
    return texturePromise;
  };

  const ensurePlaybackTextureWindow = async (currentTime: number): Promise<void> => {
    for (const cache of getPlaybackTextureWindow(currentTime)) {
      await ensureTransitionTextures(cache);
    }
  };

  const persistSnapshot = async (
    cache: CachedTransition,
    sampleIndex: number,
    side: "from" | "to",
    blob: Blob | null,
  ): Promise<boolean> => {
    if (!blob) return false;
    return putSnapshotEntry({
      key: makeSnapshotKey(cache.cacheKey, sampleIndex, side),
      blob,
      width: previewTextureWidth,
      height: previewTextureHeight,
      updatedAt: cache.index * 1_000_000 + sampleIndex * 2 + (side === "to" ? 1 : 0),
    });
  };

  const captureTransitionCache = async (
    cache: CachedTransition,
    sampleCount: number,
    onProgress: (transitionFrame: number) => void,
  ): Promise<void> => {
    disposeCachedTransition(cache);
    let allPersisted = true;
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const progress = sampleIndex / (sampleCount - 1);
      suppressSceneMutationTracking(() => {
        originalTime(cache.time + cache.duration * progress, false);
      });
      await waitForPaint();

      const fromScene = document.getElementById(cache.fromId);
      const toScene = document.getElementById(cache.toId);
      if (!fromScene || !toScene) continue;

      const [fromCanvas, toCanvas] = await Promise.all([
        captureLiveScene(fromScene),
        captureLiveScene(toScene),
      ]);
      const [fromBlob, toBlob] = await Promise.all([
        canvasToPngBlob(fromCanvas),
        canvasToPngBlob(toCanvas),
      ]);
      disposeCaptureCanvas(fromCanvas);
      disposeCaptureCanvas(toCanvas);
      if (!fromBlob || !toBlob) {
        throw new Error("[HyperShader] Failed to encode transition snapshot");
      }

      cache.frames.push({ sampleIndex, fromBlob, toBlob, fromTex: null, toTex: null });
      const persisted = await Promise.all([
        persistSnapshot(cache, sampleIndex, "from", fromBlob),
        persistSnapshot(cache, sampleIndex, "to", toBlob),
      ]);
      if (!persisted.every(Boolean)) {
        allPersisted = false;
        cache.lastError = "[HyperShader] Failed to persist one or more transition snapshots";
      }
      onProgress(sampleIndex + 1);
    }
    cache.ready = true;
    cache.dirty = false;
    cache.fallback = false;
    cache.persisted = allPersisted;
    cache.textureReady = false;
  };

  let transitionCachePromise: Promise<void> | null = null;

  const ensureTransitionCachesReady = (): Promise<void> => {
    if (transitionCachePromise) return transitionCachePromise;

    transitionCachePromise = (async () => {
      const work = cachedTransitions.filter((cache) => cache.dirty || !cache.ready);
      const workItems = work.map((cache) => ({
        cache,
        sampleCount: sampleCountForCache(cache),
      }));
      for (const item of workItems) {
        item.cache.cacheKey = buildTransitionCacheKey(item.cache, item.sampleCount);
      }
      const total = workItems.reduce((sum, item) => sum + item.sampleCount, 0);
      const firstItem = workItems[0];
      let showLoadingOverlay = false;
      setShaderReadyState({
        ready: false,
        progress: 0,
        total,
        currentTransition: firstItem ? 1 : undefined,
        transitionTotal: workItems.length || undefined,
        transitionFrame: firstItem ? 0 : undefined,
        transitionFrames: firstItem?.sampleCount,
        phase: firstItem ? "cached" : undefined,
        loading: showLoadingOverlay,
      });

      if (work.length === 0) {
        shaderCacheReady = true;
        setShaderReadyState({
          ready: true,
          progress: 0,
          total: 0,
          currentTransition: undefined,
          transitionTotal: undefined,
          transitionFrame: undefined,
          transitionFrames: undefined,
          phase: undefined,
          loading: false,
        });
        if (pendingPlay) {
          const resumeArgs = pendingPlayArgs;
          const resumeTime = getPlaybackRequestTime(resumeArgs, publicTimelineTime);
          await ensurePlaybackTextureWindow(resumeTime);
          if (pendingPlay) {
            pendingPlay = false;
            pendingPlayArgs = [];
            cancelResumeAfterPrewarm = false;
            suppressSceneMutationTracking(() => originalPlay(...resumeArgs));
            publicTimelineTime = readActualTimelineTime();
          }
        }
        transitionCachePromise = null;
        return;
      }

      publicTimelineTime = readActualTimelineTime();
      const wasPaused = tl.paused();
      const originalSceneStyles: SceneStyleState[] = scenes.map((id) => {
        const scene = document.getElementById(id);
        return {
          scene,
          opacity: scene?.style.opacity ?? "",
          visibility: scene?.style.visibility ?? "",
          pointerEvents: scene?.style.pointerEvents ?? "",
        };
      });

      prewarming = true;
      canvasEl.style.display = "none";
      originalPause();

      let completed = 0;
      try {
        for (let workIndex = 0; workIndex < workItems.length; workIndex += 1) {
          const item = workItems[workIndex];
          if (!item) continue;
          const { cache, sampleCount } = item;
          const currentTransition = workIndex + 1;
          const completedBeforeTransition = completed;
          disposeCachedTransition(cache);
          try {
            setShaderReadyState({
              ready: false,
              progress: completedBeforeTransition,
              total,
              currentTransition,
              transitionTotal: workItems.length,
              transitionFrame: 0,
              transitionFrames: sampleCount,
              phase: "cached",
              loading: showLoadingOverlay,
            });
            const hydrated = await hydrateTransitionCache(cache, sampleCount, (transitionFrame) => {
              completed = completedBeforeTransition + transitionFrame;
              setShaderReadyState({
                ready: false,
                progress: completed,
                total,
                currentTransition,
                transitionTotal: workItems.length,
                transitionFrame,
                transitionFrames: sampleCount,
                phase: "cached",
                loading: showLoadingOverlay,
              });
            });
            if (!hydrated) {
              completed = completedBeforeTransition;
              showLoadingOverlay = true;
              setShaderReadyState({
                ready: false,
                progress: completed,
                total,
                currentTransition,
                transitionTotal: workItems.length,
                transitionFrame: 0,
                transitionFrames: sampleCount,
                phase: "capturing",
                loading: true,
              });
              await captureTransitionCache(cache, sampleCount, (transitionFrame) => {
                completed = completedBeforeTransition + transitionFrame;
                setShaderReadyState({
                  ready: false,
                  progress: completed,
                  total,
                  currentTransition,
                  transitionTotal: workItems.length,
                  transitionFrame,
                  transitionFrames: sampleCount,
                  phase: "capturing",
                  loading: true,
                });
              });
              if (!cache.persisted && cache.lastError) {
                setShaderReadyState({
                  ready: false,
                  loading: showLoadingOverlay,
                  error: cache.lastError,
                });
              }
            }
          } catch (e) {
            completed = completedBeforeTransition + sampleCount;
            cache.fallback = true;
            cache.ready = true;
            cache.dirty = false;
            cache.lastError = e instanceof Error ? e.message : String(e);
            console.warn("[HyperShader] Transition capture failed; using CSS fallback:", e);
            setShaderReadyState({
              ready: false,
              progress: completed,
              total,
              currentTransition,
              transitionTotal: workItems.length,
              transitionFrame: sampleCount,
              transitionFrames: sampleCount,
              phase: "finalizing",
              loading: showLoadingOverlay,
              error: cache.lastError,
            });
          }
          completed = completedBeforeTransition + sampleCount;
        }
        void pruneSnapshotCache(
          compId,
          new Set(cachedTransitions.map((cache) => cache.cacheKey).filter(Boolean)),
        );
        shaderCacheReady = areAllCachesReady();
        const finalItem = workItems[workItems.length - 1];
        setShaderReadyState({
          ready: shaderCacheReady,
          progress: completed,
          total,
          currentTransition: workItems.length,
          transitionTotal: workItems.length,
          transitionFrame: finalItem?.sampleCount,
          transitionFrames: finalItem?.sampleCount,
          phase: "finalizing",
          loading: false,
        });
      } catch (e) {
        console.warn("[HyperShader] Pre-capture failed, keeping DOM fallback visible:", e);
        shaderCacheReady = areAllCachesReady();
        setShaderReadyState({
          ready: shaderCacheReady,
          progress: completed,
          total,
          phase: "finalizing",
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        const restoreTimelineTime = publicTimelineTime;
        let shouldResume = (pendingPlay || !wasPaused) && !cancelResumeAfterPrewarm;
        let resumeArgs = pendingPlay ? pendingPlayArgs : [];
        let resumeTime = getPlaybackRequestTime(resumeArgs, restoreTimelineTime);
        let hydratedTextureTime: number | null = null;
        if (shouldResume) {
          await ensurePlaybackTextureWindow(resumeTime);
          hydratedTextureTime = resumeTime;
        }
        shouldResume = (pendingPlay || !wasPaused) && !cancelResumeAfterPrewarm;
        resumeArgs = pendingPlay ? pendingPlayArgs : [];
        resumeTime = getPlaybackRequestTime(resumeArgs, restoreTimelineTime);
        if (shouldResume && resumeTime !== hydratedTextureTime) {
          await ensurePlaybackTextureWindow(resumeTime);
        }
        prewarming = false;
        state.active = false;
        state.transitionIndex = -1;
        canvasEl.style.display = "none";
        suppressSceneMutationTracking(() => {
          setActualTimelineTime(restoreTimelineTime, false);
        });
        publicTimelineTime = restoreTimelineTime;
        for (const item of originalSceneStyles) {
          if (!item.scene) continue;
          item.scene.style.opacity = item.opacity;
          item.scene.style.visibility = item.visibility;
          item.scene.style.pointerEvents = item.pointerEvents;
        }
        tickShader();
        window.dispatchEvent(
          new CustomEvent("hyperShader:ready", {
            detail: { compositionId: compId, progress: completed, total },
          }),
        );
        transitionCachePromise = null;
        if (shouldResume) {
          pendingPlay = false;
          pendingPlayArgs = [];
          cancelResumeAfterPrewarm = false;
          suppressSceneMutationTracking(() => originalPlay(...resumeArgs));
          publicTimelineTime = readActualTimelineTime();
        } else {
          pendingPlay = false;
          pendingPlayArgs = [];
          cancelResumeAfterPrewarm = false;
          originalPause();
        }
      }
    })();

    return transitionCachePromise;
  };

  const sceneEditObservers = observeSceneEdits();
  window.addEventListener(
    "beforeunload",
    () => {
      for (const observer of sceneEditObservers) {
        observer.disconnect();
      }
    },
    { once: true },
  );

  const prewarmPromise = Promise.resolve().then(() => ensureTransitionCachesReady());
  const hfWin = window as unknown as { __hf?: { shaderTransitionsReady?: Promise<void> } };
  hfWin.__hf = hfWin.__hf || {};
  hfWin.__hf.shaderTransitionsReady = prewarmPromise;

  registerTimeline(compId, tl, config.timeline);
  return tl;
}

function registerTimeline(
  compId: string,
  tl: GsapTimeline,
  provided: GsapTimeline | undefined,
): void {
  if (!provided) {
    const w = window as unknown as { __timelines: Record<string, unknown> };
    w.__timelines = w.__timelines || {};
    w.__timelines[compId] = tl;
  }
}

// Engine-mode initialization: skip every GL/canvas/html2canvas branch and only
// schedule deterministic opacity flips so the producer can read each scene's
// effective opacity at any seek time. tl.set() (zero-duration tweens) is used
// instead of tl.call() because tl.call only fires in the direction of motion —
// the engine's warmup loop seeks forward through transition start times and
// then the main render loop seeks back to t=0, which would leave callback-set
// state stuck. tl.set tweens revert correctly on backward seeks.
function initEngineMode(
  config: HyperShaderConfig,
  scenes: string[],
  transitions: TransitionConfig[],
  compId: string,
  root: HTMLElement | null,
): GsapTimeline {
  const tl: GsapTimeline = config.timeline || gsap.timeline({ paused: true });

  // Match the user-facing branch: when the user supplies a timeline, we
  // anchor a no-op duration tween at 0 so the timeline length covers the
  // composition. Without it a brand-new injected timeline would be empty.
  if (config.timeline) {
    const duration = Number(root?.getAttribute("data-duration") || "40");
    tl.to({ t: 0 }, { t: 1, duration, ease: "none" }, 0);
  }

  // Initial state: every non-first scene starts hidden. CSS defaults
  // .scene to opacity:1, so without this every scene would composite at
  // t=0 and the engine's queryElementStacking() would report all of them
  // visible — manifesting as ghosting/overlap in the very first frame
  // before the first transition fires. tl.set() at position 0 ensures
  // the initial state is part of the timeline's seek graph, so reverse
  // seeks from inside a later transition correctly restore it.
  for (let i = 1; i < scenes.length; i++) {
    const sceneId = scenes[i];
    if (sceneId) {
      tl.set(`#${sceneId}`, { opacity: 0 }, 0);
    }
  }

  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    const fromId = scenes[i];
    const toId = scenes[i + 1];
    if (!fromId || !toId) continue;

    const dur = t.duration ?? DEFAULT_DURATION;
    const T = t.time;

    // During the transition both scenes need to be visible so the engine
    // can composite each side; afterwards the outgoing scene must drop out
    // so it stops contributing to the normal-frame layer composite.
    tl.set(`#${toId}`, { opacity: 1 }, T);
    tl.set(`#${fromId}`, { opacity: 0 }, T + dur);
  }

  registerTimeline(compId, tl, config.timeline);
  return tl;
}
