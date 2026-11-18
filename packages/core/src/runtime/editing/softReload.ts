// A GSAP script edit re-runs the edited composition's script in the live preview, without a reload.
// Studio runs it on a frame it can reach; a sealed frame runs it on itself through the editing port,
// with the script Studio saved and the authored styles Studio read from that file.
import { GSAP_BASE_URL_META, motionPathPluginUrl } from "../../gsapCdn";
import { applyAuthoredInlineOpacity, readStampedAuthoredOpacity } from "../../colorGrading";
import { escapeCssString } from "../editingElement";
import { applyAuthoredTiming } from "../../studioPreviewMark";

type TweenLike = {
  targets?: () => unknown[];
  vars?: Record<string, unknown>;
  getChildren?: (deep: boolean) => TweenLike[];
};

export type SoftReloadWindow = Window & {
  __timelines?: Record<string, unknown>;
  __player?: {
    getTime?: () => number;
    seek?: (t: number) => void;
    isPlaying?: () => boolean;
    play?: () => void;
  };
  __hfForceTimelineRebind?: () => void;
  __hfSuppressSceneMutations?: <T>(fn: () => T) => T;
  __hfStudioManualEditsApply?: () => void;
  // Set while a MotionPathPlugin script is fetched, so overlapping reloads queue no second one.
  __hfMotionPathPluginLoading?: boolean;
  gsap?: {
    version?: string;
    registerPlugin?: (...plugins: unknown[]) => unknown;
    set?: (targets: Element | Element[], vars: Record<string, unknown>) => void;
  };
  MotionPathPlugin?: unknown;
};

/** What one standalone `gsap.set` in the outgoing script wrote: its selector and the CSS names. */
export type StandaloneSet = { selector: string; props: string[] };

// "applied": ran, or runs once the MotionPath plugin loads. "verify-failed": ran, its timeline keys
// read empty for now, the live state is right. "cannot-soft-reload": only a full reload fixes it.
export type SoftReloadResult = "applied" | "verify-failed" | "cannot-soft-reload";

export interface SoftReloadInput {
  script: string;
  /** The time to seek the rebuilt timeline to; the player's own time when absent. */
  time?: number;
  /** What the outgoing script's standalone sets wrote, which no timeline child records. */
  sets: readonly StandaloneSet[];
  /** An element's authored style text: null when unknown, undefined when its file is not at hand. */
  authoredStyle: (
    el: Element,
    file: string | null,
    ownFile: string | null,
  ) => string | null | undefined;
  /** A sealed timing edit's saved timing, which a reachable preview's commit already patched live. */
  timing?: SavedTiming;
}

/** The attributes the runtime derives clip windows and the film's length from. */
export const TIMING_ATTRIBUTES = new Set([
  "data-start",
  "data-end",
  "data-duration",
  "data-track-index",
  "data-media-start",
  "data-playback-start",
  "data-playback-rate",
]);

/** `[key, attributes]` per element of the saved file, keyed as `authoredKey` keys a live one. */
export type SavedTiming = Array<[string, Array<[string, string]>]>;
type TimingPlan = Array<[Element, Array<[string, string]>]>;

/** Each live element of `ownFile` with the saved timing it lacks; null when one is missing or two share a key. */
export function planSavedTiming(
  doc: Document,
  ownFile: string | null,
  timing: SavedTiming,
): TimingPlan | null {
  const live = new Map<string, Element>();
  // The preview rewrites an inlined composition's own root, so the file's timing is not its own.
  const rewritten = new Set<string | null>();
  for (const el of doc.querySelectorAll("[data-hf-id], [id]")) {
    if (el.hasAttribute("data-hf-inner-root")) rewritten.add(authoredKey(el));
    const key = authoringFile(el) === ownFile ? authoredKey(el) : null;
    if (key === null || rewritten.has(key)) continue;
    if (live.has(key)) return null;
    live.set(key, el);
  }
  const plan: TimingPlan = [];
  for (const [key, attributes] of timing) {
    const el = live.get(key);
    if (!el && rewritten.has(key)) continue;
    if (!el) return null;
    const changed = attributes.filter(([name, value]) => el.getAttribute(name) !== value);
    if (changed.length > 0) plan.push([el, changed]);
  }
  return plan;
}

export const applyTimingPlan = (plan: TimingPlan): void => {
  for (const [el, attributes] of plan) applyAuthoredTiming(el, attributes);
};

const NESTED_VARS = new Set(["css", "startAt", "keyframes"]);

/** The CSS names a tween's vars write; GSAP's own keys (ease, duration) are not CSS and restore as no-ops. */
export function tweenedProps(vars: unknown): string[] {
  if (!vars || typeof vars !== "object") return [];
  return Object.entries(vars).flatMap(([key, value]) => [
    key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
    ...(NESTED_VARS.has(key) || /^\d|%$/.test(key) ? tweenedProps(value) : []),
  ]);
}

export function elementTargets(tween: { targets?: () => unknown[] }): Element[] {
  return (tween.targets?.() ?? []).filter((t): t is Element =>
    Boolean((t as HTMLElement | null)?.style && (t as Node).nodeType),
  );
}

// A nested composition's timeline sits inside the root one but only its own script rebuilds it.
function ownTweens(tl: TweenLike, nested: Set<unknown>): TweenLike[] {
  return (tl.getChildren?.(false) ?? []).flatMap((child) => {
    if (nested.has(child)) return [];
    return child.getChildren ? ownTweens(child, nested) : [child];
  });
}

// The preview marks each inlined composition's host with its file; the host itself is the parent's.
export function authoringFile(el: Element): string | null {
  return (
    el.parentElement?.closest("[data-composition-file]")?.getAttribute("data-composition-file") ??
    null
  );
}

function addProps(targets: Map<Element, Set<string>>, el: Element, props: Iterable<string>): void {
  const seen = targets.get(el) ?? new Set<string>();
  for (const prop of props) seen.add(prop);
  targets.set(el, seen);
}

/** Each element the re-run rebuilds, with the CSS names its killed tweens wrote. */
export function collectResetTargets(
  win: { __timelines?: Record<string, unknown> },
  doc: Document,
  targetKeys: string[],
  sets: readonly StandaloneSet[] = [],
): Map<Element, Set<string>> {
  const targets = new Map<Element, Set<string>>();
  const timelines = (win.__timelines ?? {}) as Record<string, TweenLike | undefined>;
  const others = new Set<unknown>(
    Object.entries(timelines).flatMap(([key, tl]) => (targetKeys.includes(key) ? [] : [tl])),
  );
  for (const key of targetKeys) {
    try {
      for (const tween of ownTweens(timelines[key] ?? {}, others)) {
        const props = tweenedProps(tween.vars);
        for (const el of elementTargets(tween)) addProps(targets, el, props);
      }
    } catch {}
  }
  sweepHeldElements(doc, targetKeys, others, targets);
  addLiveSetTargets(doc, targetKeys, targets);
  for (const set of sets) {
    try {
      for (const el of doc.querySelectorAll(set.selector)) addProps(targets, el, set.props);
    } catch {}
  }
  return targets;
}

function tweenTargetsIn(timelines: Set<unknown>): Set<Element> {
  const els = new Set<Element>();
  for (const tl of timelines) {
    try {
      for (const tween of (tl as TweenLike | undefined)?.getChildren?.(true) ?? []) {
        for (const el of elementTargets(tween)) els.add(el);
      }
    } catch {}
  }
  return els;
}

function compositionRoot(doc: Document, key: string): Element | undefined {
  return doc.querySelectorAll(`[data-composition-id="${escapeCssString(key)}"]`)[0];
}

export function compositionFile(doc: Document, targetKeys: string[]): string | null {
  const root = targetKeys.map((key) => compositionRoot(doc, key)).find(Boolean);
  return root?.closest("[data-composition-file]")?.getAttribute("data-composition-file") ?? null;
}

// A standalone gsap.set, or keyframes just removed, leaves GSAP state no timeline child shows.
// The nearest composition root says whose script set it; another timeline's targets stay its own.
function sweepHeldElements(
  doc: Document,
  targetKeys: string[],
  others: Set<unknown>,
  targets: Map<Element, Set<string>>,
): void {
  const elsewhere = tweenTargetsIn(others);
  const roots = new Set<Element | null | undefined>(targetKeys.map((k) => compositionRoot(doc, k)));
  roots.delete(undefined);
  for (const root of roots) {
    for (const el of root ? [root, ...root.querySelectorAll("*")] : []) {
      if (targets.has(el) || elsewhere.has(el) || !("_gsap" in el)) continue;
      if (el === root || roots.has(el.parentElement?.closest("[data-composition-id]")))
        targets.set(el, new Set());
    }
  }
}

// What a live patch set on each element since its last reload; no script in the preview ran it.
const liveSets = new WeakMap<Document, Map<Element, Set<string>>>();

export function recordLiveSet(el: Element, vars: Record<string, unknown>): void {
  const byElement = liveSets.get(el.ownerDocument) ?? new Map<Element, Set<string>>();
  liveSets.set(el.ownerDocument, byElement);
  addProps(byElement, el, tweenedProps(vars));
}

function addLiveSetTargets(
  doc: Document,
  targetKeys: string[],
  targets: Map<Element, Set<string>>,
): void {
  const roots = new Set<Element | null | undefined>(targetKeys.map((k) => compositionRoot(doc, k)));
  for (const [el, props] of liveSets.get(doc) ?? []) {
    if (!roots.has(el) && !roots.has(el.parentElement?.closest("[data-composition-id]"))) continue;
    addProps(targets, el, props);
  }
}

function forgetLiveSets(reset: Map<Element, unknown>): void {
  for (const el of reset.keys()) liveSets.get(el.ownerDocument)?.delete(el);
}

function isGsapScript(text: string): boolean {
  return (
    text.includes("gsap.timeline") ||
    text.includes("__timelines") ||
    text.includes(".to(") ||
    text.includes(".set(")
  );
}

export function findGsapScriptElements(doc: ParentNode): HTMLScriptElement[] {
  const results: HTMLScriptElement[] = [];
  for (const script of doc.querySelectorAll<HTMLScriptElement>("script:not([src])")) {
    if (isGsapScript(script.textContent || "")) results.push(script);
  }
  return results;
}

export function timelineKeys(scriptText: string): string[] {
  return [...scriptText.matchAll(/__timelines\s*\[\s*["'`]([^"'`]+)["'`]\s*\]/g)]
    .map((m) => m[1]!)
    .filter((key) => key !== "__proxied");
}

/** The script elements that register one of `keys` on `window.__timelines`. */
export function scriptsRegistering(
  scripts: readonly HTMLScriptElement[],
  keys: readonly string[],
): HTMLScriptElement[] {
  return scripts.filter((script) => {
    const text = script.textContent || "";
    return keys.some(
      (key) => text.includes(`__timelines["${key}"]`) || text.includes(`__timelines['${key}']`),
    );
  });
}

// The script's own keys, not "any key": a scoped re-run repopulates only its composition, and the
// global map can read empty for a moment right after it.
function verifyTimelinesPopulated(win: SoftReloadWindow, targetKeys: string[]): boolean {
  const timelines = win.__timelines;
  if (!timelines) return false;
  return targetKeys.every((key) => timelines[key] != null);
}

// GSAP masks a folded CSS translate/rotate/scale with `none`, and a tween writes what it animates
// inline; a fresh load has only what the file authors. Opacity has its own restore.
export function restoreAuthoredStyle(
  style: CSSStyleDeclaration,
  authored: CSSStyleDeclaration | null,
  tweened: Set<string>,
): void {
  style.transform = authored?.transform ?? "";
  if (!authored) return;
  for (const prop of ["translate", "rotate", "scale", ...tweened]) {
    if (prop === "opacity") continue;
    style.setProperty(prop, authored.getPropertyValue(prop), authored.getPropertyPriority(prop));
  }
}

// Seek before the rebind: the rebind renders the new timeline at the runtime's scrub position, and a
// seek after it can be a no-op. A seek pauses the player, so an edit made while playing resumes it.
export function finalizeSoftReload(win: SoftReloadWindow, currentTime: number): void {
  const wasPlaying = win.__player?.isPlaying?.() === true;
  win.__player?.seek?.(currentTime);
  win.__hfForceTimelineRebind?.();
  win.__hfStudioManualEditsApply?.();
  if (wasPlaying) win.__player?.play?.();
}

export function previewMotionPathUrl(doc: Document, version?: string): string {
  const baseUrl = doc.head.querySelector<HTMLMetaElement>(
    `meta[name="${GSAP_BASE_URL_META}"]`,
  )?.content;
  return motionPathPluginUrl(version, baseUrl);
}

function runSuppressed(win: SoftReloadWindow, reload: () => void): boolean {
  try {
    if (win.__hfSuppressSceneMutations) win.__hfSuppressSceneMutations(reload);
    else reload();
    return true;
  } catch (error) {
    console.error("[hyperframes] GSAP soft reload threw; a full reload follows", error);
    return false;
  }
}

// Re-runs the script in place of the live one registering the same `__timelines` keys, tearing down
// only those timelines. A promise only while it waits for the MotionPath plugin.
// fallow-ignore-next-line complexity
export function softReloadFrame(
  win: SoftReloadWindow,
  doc: Document,
  input: SoftReloadInput,
): SoftReloadResult | Promise<SoftReloadResult> {
  const { script } = input;
  if (!script || !win.gsap || !win.__hfForceTimelineRebind) return "cannot-soft-reload";
  // Each composition owns one timeline key; tearing down every timeline would revert the others.
  const targetKeys = timelineKeys(script);
  if (targetKeys.length === 0) return "cannot-soft-reload";
  const gsapScripts = findGsapScriptElements(doc);
  if (gsapScripts.length === 0) return "cannot-soft-reload";
  const staleScripts = scriptsRegistering(gsapScripts, targetKeys);
  // Several scripts and none registers these keys: which element to replace is ambiguous.
  if (gsapScripts.length > 1 && staleScripts.length === 0) return "cannot-soft-reload";
  const currentTime = input.time ?? win.__player?.getTime?.() ?? 0;

  const targets = collectResetTargets(win, doc, targetKeys, input.sets);
  const ownFile = compositionFile(doc, targetKeys);
  const authored = new Map<Element, CSSStyleDeclaration | null>();
  for (const el of targets.keys()) {
    const text = input.authoredStyle(el, authoringFile(el), ownFile);
    if (text === undefined) return "cannot-soft-reload";
    const probe = text === null ? null : doc.createElement("div");
    probe?.setAttribute("style", text!);
    authored.set(el, probe?.style ?? null);
  }
  const timing = input.timing ? planSavedTiming(doc, ownFile, input.timing) : [];
  if (timing === null) return "cannot-soft-reload";

  let deferred: ((result: SoftReloadResult) => void) | null = null;
  let pending: Promise<SoftReloadResult> | null = null;
  let builtDom = false;

  const doReload = () => {
    applyTimingPlan(timing);
    const timelines = win.__timelines as Record<
      string,
      TweenLike & { kill?: () => void; clear?: () => void }
    >;
    if (timelines) {
      for (const key of targetKeys) {
        const tl = timelines[key];
        if (!tl) continue;
        try {
          // kill() keeps the children, and the finalize seek renders this timeline until the rebind swaps it.
          tl.clear?.();
          tl.kill?.();
        } catch {}
        delete timelines[key];
      }
    }

    // clearProps flushes GSAP's transform cache, so from() tweens read no stale end values, but it
    // also clears the element's own style: save, clear, restore, then put back what the file authors.
    const allTargets = [...targets.keys()];
    if (allTargets.length > 0 && win.gsap?.set) {
      // Another realm's nodes fail instanceof HTMLElement, so style access is duck-typed.
      const saved = allTargets.map(
        (el) => [el as HTMLElement, (el as HTMLElement).style.cssText] as const,
      );
      win.gsap.set(allTargets, { clearProps: "all" });
      for (const [el, css] of saved) {
        const s = el.style;
        s.cssText = css;
        const source = authored.get(el) ?? null;
        restoreAuthoredStyle(s, source, targets.get(el)!);
        // The saved cssText holds a mid-tween opacity, which a re-initialized tween would keep as its bound.
        const opacity = source ? source.opacity : readStampedAuthoredOpacity(el);
        if (opacity !== null) applyAuthoredInlineOpacity(s, opacity);
      }
    }
    forgetLiveSets(targets);
    for (const stale of staleScripts) stale.remove();

    const executeScript = () => {
      if (win.MotionPathPlugin && win.gsap?.registerPlugin)
        win.gsap.registerPlugin(win.MotionPathPlugin);
      const s = doc.createElement("script");
      s.textContent = `(function(){${script}\n})();`;
      const before = doc.body.querySelectorAll("*").length + 1;
      doc.body.appendChild(s);
      // A script that builds DOM builds it again on every run; only a full load starts from the file.
      // Not seen: text-only writes, nodes put in the head or a shadow root, and nodes added later.
      builtDom = doc.body.querySelectorAll("*").length > before;
      finalizeSoftReload(win, currentTime);
      deferred?.(builtDom ? "cannot-soft-reload" : "applied");
    };

    const needsMotionPath = /motionPath\s*[:{]/.test(script);
    if (!needsMotionPath || win.MotionPathPlugin || !win.gsap) {
      executeScript();
      return;
    }
    pending = new Promise<SoftReloadResult>((resolve) => (deferred = resolve));
    // A load already in flight is the one to wait for; a second plugin script re-flashes the frame.
    if (win.__hfMotionPathPluginLoading) {
      const started = Date.now();
      const poll = win.setInterval(() => {
        if (win.MotionPathPlugin) {
          win.clearInterval(poll);
          executeScript();
        } else if (!win.__hfMotionPathPluginLoading || Date.now() - started > 10000) {
          win.clearInterval(poll);
          deferred?.("cannot-soft-reload");
        }
      }, 50);
      return;
    }
    win.__hfMotionPathPluginLoading = true;
    const pluginScript = doc.createElement("script");
    pluginScript.src = previewMotionPathUrl(doc, win.gsap.version);
    pluginScript.onload = () => {
      win.__hfMotionPathPluginLoading = false;
      executeScript();
    };
    // Running the script without the plugin would leave a motionPath tween that cannot play.
    pluginScript.onerror = () => {
      win.__hfMotionPathPluginLoading = false;
      deferred?.("cannot-soft-reload");
    };
    doc.head.appendChild(pluginScript);
  };

  if (!runSuppressed(win, doReload) || builtDom) return "cannot-soft-reload";
  if (pending) return pending;
  return verifyTimelinesPopulated(win, targetKeys) ? "applied" : "verify-failed";
}

export const MAX_SOFT_RELOAD_SCRIPT = 1_000_000;
const MAX_SETS = 1_000;
const MAX_SET_PROPS = 64;
const MAX_SELECTOR_LENGTH = 2_000;
const MAX_AUTHORED = 10_000;
const MAX_AUTHORED_KEY = 512;
const MAX_AUTHORED_STYLE = 16_384;
const MAX_TIMED = 10_000;
const MAX_TIMING_VALUE = 64;

export type SoftReloadParams = {
  script: string;
  time: number;
  sets: StandaloneSet[];
  /** `[key, style]`: key `hf:<data-hf-id>` or `#<id>`, style the element's authored style text. */
  authored: Array<[string, string]>;
  /** Empty unless a timing edit: the saved file's timing, applied before the re-run's rebind. */
  timing: SavedTiming;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";

const boundedString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;

function parseSet(value: unknown): StandaloneSet | null {
  if (!isRecord(value) || Object.keys(value).sort().join() !== "props,selector") return null;
  const { selector, props } = value;
  if (!boundedString(selector, MAX_SELECTOR_LENGTH) || selector.length === 0) return null;
  if (!Array.isArray(props) || props.length > MAX_SET_PROPS) return null;
  return props.every((p) => boundedString(p, 64)) ? { selector, props: props as string[] } : null;
}

const isAuthoredEntry = (entry: unknown): entry is [string, string] =>
  Array.isArray(entry) &&
  entry.length === 2 &&
  boundedString(entry[0], MAX_AUTHORED_KEY) &&
  /^(hf:|#)./.test(entry[0]) &&
  boundedString(entry[1], MAX_AUTHORED_STYLE);

const isTimingAttribute = (value: unknown): value is [string, string] =>
  Array.isArray(value) &&
  value.length === 2 &&
  TIMING_ATTRIBUTES.has(value[0]) &&
  boundedString(value[1], MAX_TIMING_VALUE);

const isTimedEntry = (entry: unknown): entry is SavedTiming[number] =>
  Array.isArray(entry) &&
  entry.length === 2 &&
  boundedString(entry[0], MAX_AUTHORED_KEY) &&
  /^(hf:|#)./.test(entry[0]) &&
  Array.isArray(entry[1]) &&
  entry[1].length <= TIMING_ATTRIBUTES.size &&
  entry[1].every(isTimingAttribute);

export function parseSavedTiming(value: unknown): SavedTiming | null {
  const ok = Array.isArray(value) && value.length <= MAX_TIMED && value.every(isTimedEntry);
  return ok ? (value as SavedTiming) : null;
}

export function parseSoftReload(params: unknown): SoftReloadParams | null {
  const fields = "authored,script,sets,time,timing";
  if (!isRecord(params) || Object.keys(params).sort().join() !== fields) return null;
  const { script, time, sets, authored } = params;
  const timing = parseSavedTiming(params.timing);
  if (!timing) return null;
  if (!boundedString(script, MAX_SOFT_RELOAD_SCRIPT) || script.length === 0) return null;
  if (typeof time !== "number" || !Number.isFinite(time) || time < 0) return null;
  if (!Array.isArray(sets) || sets.length > MAX_SETS) return null;
  if (!Array.isArray(authored) || authored.length > MAX_AUTHORED) return null;
  const parsedSets = sets.map(parseSet);
  if (!parsedSets.every(Boolean) || !authored.every(isAuthoredEntry)) return null;
  return { script, time, sets: parsedSets as StandaloneSet[], authored, timing };
}

/** The key Studio files an element's authored style under: its hf-id, else its id. */
export function authoredKey(el: Element): string | null {
  const hfId = el.getAttribute("data-hf-id");
  if (hfId) return `hf:${hfId}`;
  return el.id ? `#${el.id}` : null;
}

/** The frame re-running its own script: only elements of the saved file have authored styles to use. */
export async function softReload(params: SoftReloadParams): Promise<{ result: SoftReloadResult }> {
  const styles = new Map(params.authored);
  const result = await softReloadFrame(window as SoftReloadWindow, document, {
    script: params.script,
    time: params.time,
    sets: params.sets,
    timing: params.timing,
    authoredStyle: (el, file, ownFile) => {
      if (file !== ownFile) return undefined;
      const key = authoredKey(el);
      return key === null ? null : (styles.get(key) ?? null);
    },
  });
  return { result };
}
