import { parseGsapScript } from "@hyperframes/parsers/gsap-parser";
import {
  authoringFile,
  collectResetTargets,
  compositionFile,
  finalizeSoftReload,
  findGsapScriptElements,
  preloadMotionPath,
  restoreAuthoredStyle,
  scriptsRegistering,
  softReloadFrame,
  timelineKeys,
  type SoftReloadResult,
  type SoftReloadWindow,
} from "@hyperframes/core/runtime/soft-reload";
import { authoredStyles, findAuthoredElement, savedTiming } from "./authoredSource";
import { fileDocs, standaloneSets } from "./softReloadTargets";
import type { EditingParams } from "@hyperframes/core/runtime/editing-port";
import { PREVIEW_REJECTED, PREVIEW_STALE, previewFrameOpaque } from "../player/lib/previewChannel";
import {
  SAVED_STATE_DEADLINE_MS,
  sendPreviewWrite,
  takePreviewTicket,
  ticketNeedsRecovery,
} from "./sealedPreviewLedger";

export {
  findGsapScriptElements,
  scriptsRegistering,
  timelineKeys,
  type SoftReloadResult,
} from "@hyperframes/core/runtime/soft-reload";

type IframeWindow = SoftReloadWindow & { __playerReady?: boolean };

/**
 * Pre-load and register MotionPathPlugin once per preview load (NLELayout's onIframeLoad) unless the page is marked
 * path-free; a first path added by an edit waits for it on its re-run. Idempotent; without gsap it waits for the
 * runtime's ready, and a CDN failure is left to the soft reload's own load.
 */
// At most one preview waits for its runtime; a newer load replaces it, so a frame that never boots is not kept alive.
let pendingReadyRetry: ((event: MessageEvent) => void) | null = null;

export function ensureMotionPathPluginLoaded(iframe: HTMLIFrameElement | null): void {
  if (pendingReadyRetry) window.removeEventListener("message", pendingReadyRetry);
  pendingReadyRetry = null;
  if (!iframe?.contentWindow || !iframe.contentDocument) return;
  const win = iframe.contentWindow as IframeWindow;
  const doc = iframe.contentDocument;

  // Already registered (composition shipped its own plugin, or a prior bootstrap
  // ran) — register it on gsap to be safe, then bail.
  if (win.MotionPathPlugin) {
    try {
      if (win.gsap?.registerPlugin) win.gsap.registerPlugin(win.MotionPathPlugin);
    } catch {}
    return;
  }
  // A body gsap runs after web fonts, which can be after the iframe's load: retry once the runtime is ready.
  // A booted runtime (`__playerReady`, set in the same task it posts ready) has nothing left to wait for.
  if (!win.gsap?.registerPlugin) {
    if (win.__playerReady) return;
    const retry = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; type?: unknown } | null;
      if (event.source !== win || data?.source !== "hf-preview" || data.type !== "ready") return;
      window.removeEventListener("message", retry);
      pendingReadyRetry = null;
      if (win.gsap?.registerPlugin) ensureMotionPathPluginLoaded(iframe);
    };
    pendingReadyRetry = retry;
    window.addEventListener("message", retry);
    return;
  }
  preloadMotionPath(win, doc);
}

/**
 * Extract the GSAP timeline script text from a serialized HTML document, for
 * feeding into applySoftReload. Returns null when zero or multiple GSAP scripts
 * are present: a snapshot cannot say which script one rewritten text replaces.
 */
export function extractGsapScriptText(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const scripts = findGsapScriptElements(doc);
  if (scripts.length !== 1) return null;
  return scripts[0].textContent || null;
}

export interface SoftReloadOptions {
  /** Escalation for a failure found after this returned, such as a MotionPath CDN error. */
  onAsyncFailure?: () => void;
  onShownInPlace?: () => void;
  /** Seek target for the rebuilt timeline; defaults to the iframe player time. */
  currentTimeOverride?: number;
  /** After-write file HTML: the source of the authored opacity and transform restore. */
  authoredHtml?: string;
  /** The same file before the write; a sealed preview needs it for what the outgoing script set. */
  previousHtml?: string;
  /** A timing edit, whose saved timing a sealed preview takes along: no commit could patch it live. */
  timingEdit?: boolean;
  /** The Studio file revision `authoredHtml`'s save went out at. */
  version?: number;
  /** Other composition files a reset element is written in, by path; null when one could not be read. */
  nestedFiles?: Map<string, string> | null;
  restore?: EditingParams<"soft-reload">["restore"];
}

/**
 * Seek, force the timeline rebind and reapply the manual edits, running no script. The rebind
 * re-derives every clip window from the live DOM's timing attributes, so this syncs a timing edit
 * whose attributes are already live and whose scripts are unchanged. False when it cannot run.
 */
export function applySoftReloadFinalization(
  iframe: HTMLIFrameElement | null,
  currentTime: number,
): boolean {
  const win = iframe?.contentWindow as SoftReloadWindow | null;
  try {
    if (!win?.__hfForceTimelineRebind) return false;
    if (win.__hfSuppressSceneMutations) {
      win.__hfSuppressSceneMutations(() => finalizeSoftReload(win, currentTime));
    } else {
      finalizeSoftReload(win, currentTime);
    }
    return true;
  } catch {
    return false;
  }
}

const animatedBy = (doc: Document, scriptText: string): Set<Element> => {
  const animated = new Set<Element>();
  for (const { targetSelector } of parseGsapScript(scriptText).animations) {
    try {
      for (const element of doc.querySelectorAll(targetSelector)) animated.add(element);
    } catch {
      // A selector this document cannot parse animates nothing in it.
    }
  }
  return animated;
};

/** Authored style back on the elements the restored script stops animating, before a reload lands. */
export function repaintDroppedTweenStyle(
  win: SoftReloadWindow,
  doc: Document,
  authored: Document,
  targetKeys: string[],
  restoredScript: string | null,
): void {
  const live = findGsapScriptElements(doc)
    .map((script) => script.textContent ?? "")
    .join("");
  if (live === (restoredScript ?? "")) return;
  const kept = restoredScript ? animatedBy(doc, restoredScript) : new Set<Element>();
  for (const [element, tweened] of collectResetTargets(win, doc, targetKeys)) {
    if (kept.has(element)) continue;
    const source = findAuthoredElement(authored, element);
    const style =
      source instanceof HTMLElement || source instanceof SVGElement ? source.style : null;
    restoreAuthoredStyle((element as HTMLElement).style, style, tweened);
  }
}

const outgoingScripts = (doc: ParentNode, scriptText: string): string[] =>
  scriptsRegistering(findGsapScriptElements(doc), timelineKeys(scriptText)).map(
    (script) => script.textContent ?? "",
  );

const SOFT_RELOAD_RESULTS = new Set<unknown>([
  "applied",
  "verify-failed",
  "cannot-soft-reload",
  "superseded",
]);

/** The frame's reply is data: anything but exactly `{ result }` with a known result counts as a refusal. */
function sealedSoftReloadResult(reply: unknown): SoftReloadResult {
  if (typeof reply !== "object" || reply === null) return "cannot-soft-reload";
  const keys = Object.keys(reply);
  const { result } = reply as { result?: unknown };
  if (keys.length !== 1 || !SOFT_RELOAD_RESULTS.has(result)) return "cannot-soft-reload";
  return result as SoftReloadResult;
}

/** What a sealed frame needs to re-run `scriptText`, from the saved files alone. */
export function sealedRerun(
  scriptText: string,
  {
    authoredHtml,
    previousHtml,
    timingEdit,
  }: { authoredHtml: string; previousHtml: string; timingEdit?: boolean },
): Omit<EditingParams<"soft-reload">, "time" | "restore"> {
  const previous = new DOMParser().parseFromString(previousHtml, "text/html");
  return {
    script: scriptText,
    sets: standaloneSets(outgoingScripts(previous, scriptText)),
    authored: authoredStyles(authoredHtml),
    timing: timingEdit ? savedTiming(authoredHtml) : [],
  };
}

// Everything sent comes from the files Studio saved, never from the frame; the reply only says whether it applied.
function softReloadSealed(
  iframe: HTMLIFrameElement,
  scriptText: string,
  {
    authoredHtml,
    previousHtml,
    currentTimeOverride,
    onAsyncFailure,
    onShownInPlace,
    timingEdit,
    nestedFiles,
    version,
    restore = [],
  }: SoftReloadOptions,
): SoftReloadResult {
  if (authoredHtml === undefined || previousHtml === undefined || currentTimeOverride === undefined)
    return "cannot-soft-reload";
  const rerun = sealedRerun(scriptText, { authoredHtml, previousHtml, timingEdit });
  const ticket = takePreviewTicket(iframe, {
    scriptText,
    snapshot: { scriptText, authoredHtml, previousHtml, nestedFiles, timingEdit, version },
    attributes: restore.length > 0,
    timing: timingEdit === true,
    rerun: true,
  });
  const savedState = ticket.sent.attributes || ticket.sent.timing;
  const deadline = savedState ? SAVED_STATE_DEADLINE_MS : undefined;
  const params = { ...rerun, time: currentTimeOverride, restore };
  void sendPreviewWrite(ticket, "soft-reload", params, deadline).then((answer) => {
    // No answer, a refusal, a rejection and a stale write all leave the change unproven on screen.
    const result =
      answer === PREVIEW_REJECTED || answer === PREVIEW_STALE
        ? "cannot-soft-reload"
        : sealedSoftReloadResult(answer);
    if (!ticketNeedsRecovery(ticket)) return;
    if (result === "cannot-soft-reload") onAsyncFailure?.();
    else if (result !== "superseded") onShownInPlace?.();
  });
  return "applied";
}

// Swaps the GSAP script without a reload, keeping the WebGL context. "cannot-soft-reload" asks for a
// full reload; a failure found later (no MotionPath plugin, a sealed refusal) calls `onAsyncFailure`.
export function applySoftReload(
  iframe: HTMLIFrameElement | null,
  scriptText: string,
  options: SoftReloadOptions = {},
): SoftReloadResult {
  if (!iframe || !scriptText) return "cannot-soft-reload";
  if (previewFrameOpaque(iframe)) return softReloadSealed(iframe, scriptText, options);
  const win = iframe.contentWindow as SoftReloadWindow | null;
  const doc = iframe.contentDocument;
  // Without the file an element is written in, only a full load restores it.
  if (!win || !doc || options.nestedFiles === null) return "cannot-soft-reload";
  let docFor: ((file: string | null) => Document | null) | null = null;
  const result = softReloadFrame(win, doc, {
    script: scriptText,
    time: options.currentTimeOverride,
    sets: standaloneSets(outgoingScripts(doc, scriptText)),
    authoredStyle: (el, file, ownFile) => {
      docFor ??= fileDocs(ownFile, options.authoredHtml, options.nestedFiles);
      const fileDoc = docFor(file);
      const source = fileDoc ? findAuthoredElement(fileDoc, el) : null;
      return source ? (source.getAttribute("style") ?? "") : null;
    },
  });
  if (typeof result === "string") return result;
  void result.then((settled) => {
    if (settled !== "applied" && settled !== "superseded") options.onAsyncFailure?.();
  });
  return "applied";
}

/** Other composition files for a soft reload: undefined when none are needed, null when a read failed. */
export type NestedFiles = Map<string, string> | null | undefined;

export async function settleNestedReads(
  reads: Promise<Map<string, string>> | null,
): Promise<NestedFiles> {
  return reads ? reads.catch(() => null) : undefined;
}

/**
 * Reads the composition files, other than the reloaded one, that the elements `scriptText`'s
 * re-run resets are written in; null when there are none. Read them before the soft reload.
 */
export function readNestedFiles(
  iframe: HTMLIFrameElement | null,
  scriptText: string,
  readFile: (path: string) => Promise<string>,
): Promise<Map<string, string>> | null {
  const win = iframe?.contentWindow as IframeWindow | null;
  const doc = iframe?.contentDocument;
  if (!win || !doc) return null;
  const keys = timelineKeys(scriptText);
  const own = compositionFile(doc, keys);
  const files = [...collectResetTargets(win, doc, keys).keys()].map(authoringFile);
  const paths = [...new Set(files)].filter((file): file is string => file !== null && file !== own);
  if (paths.length === 0) return null;
  return Promise.all(paths.map((path) => readFile(path))).then(
    (texts) => new Map(paths.map((path, i) => [path, texts[i]!])),
  );
}
