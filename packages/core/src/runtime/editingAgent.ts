/**
 * The runtime's end of the editing channel (wire types in `editingPort.ts`).
 *
 * Each connect from `window.parent` carries a port the parent made, and the runtime serves it, so
 * only the parent holds the other end and a remounted client is served too. The connect ends at
 * the runtime's listener, which is added when the runtime first evaluates; one that is not served
 * (another version, or a page served to another site) has its port closed.
 * Requests on the port are validated; a bad one gets a typed error reply, never a throw.
 */
import { swallow } from "./diagnostics";
import { wallClearTimeout, wallSetTimeout } from "./wallClock";
import {
  EDITING_CONNECT,
  EDITING_PROTOCOL_VERSION,
  EDITING_REQUEST_KINDS,
  EDITING_REQUEST_TIMEOUT_MS,
  isPlainRecord,
  type FramePresentedParams,
  parseEditingRequest,
  type EditingKeyMessage,
  type EditingParams,
  type EditingReply,
  type EditingRequestKind,
  type EditingResult,
} from "./editingPort";
import type { ClipNode } from "./clipTree";
import {
  ancestorHandles,
  describeHandles,
  elementForHandle,
  elementsAtPoint,
  queryElements,
  readEveryMatch,
} from "./editingHandles";
import { elementGeometry } from "./editingGeometry";
import { pointerTargetsAt } from "./editingTargets";
import { layersOf } from "./editingLayers";
import { drawDrafts } from "./editingDraft";
import { clearDragChrome } from "./editing/dragChrome";
import { stopWatchingGeometry, watchGeometry } from "./editing/watchGeometry";
import { maxZIndex } from "./editing/maxZIndex";
import { gestureBase, gestureStart } from "./editingGestureStart";
import { gsapSnapshot } from "./editing/gsapSnapshot";
import { motionPathHome } from "./editing/motionPathHome";
import { cropLift } from "./editing/cropLift";
import { stackingFamily } from "./editingLayers";
import { gsapSet } from "./editing/gsapSet";
import { patchTweens } from "./editing/patchTween";
import { preloadMotionPath, restoreAttributesOrRerun, softReload } from "./editing/softReload";
import { holdScenes, markScenesStale, swapScenes } from "./editing/scenes";
import { liveRetime } from "./editing/liveRetime";
import { rebindTiming } from "./editing/rebindTiming";
import { previewAssetsUnloaded } from "../lottieReadiness";
import {
  getLogicalOpacity,
  markedForStudio,
  previewConsoleErrorText,
  STUDIO_PREVIEW_ERRORS,
} from "../studioPreviewMark";
import { MAX_QUERY_MATCHES } from "./editingElement";
import { matchCombo, parseCombo, type Combo } from "../keyCombo";
import { shouldIgnorePlaybackShortcutTarget } from "../typingTarget";
import { captionWords } from "./editing/captionWords";
import { captionTransform } from "./editing/captionTransform";
import { colorGradingStatus } from "./editing/color-grading-status";
import { colorGradingPreviews } from "./editing/color-grading-previews";
import { colorGradingPlayback } from "./editing/color-grading-playback";
import { assignAudioGroup } from "./editing/assignAudioGroup";
import { audioMeter } from "./editing/audioMeter";
import { documentMarkup } from "./editing/documentMarkup";
import { removeElements } from "./editing/removeElements";
import { authoredStyles, fontFaces } from "./editing/textStyleReads";
import { setAudioGroupAttribute } from "./editing/setAudioGroupAttribute";
import { editElement } from "./editing/editElement";
import { endTextEdit, textEdit } from "./editing/textEdit";
import { portPausedVideoProvider } from "./editing/pausedFrames";
import { armCanvasKeys, resetCanvasKeys, resolveCanvasKeyAction } from "./editing/canvasKeys";
import {
  canServePorts,
  closePort,
  onPortMessage,
  portMap,
  postOnPort,
  endMessageAndTakePorts,
} from "./runtimePort";
import { measureStageDocument } from "./editing/stageMeasure";
import { endStageAct, stageAct } from "./editing/stageAct";

type Handlers = {
  [K in EditingRequestKind]: (
    params: EditingParams<K>,
    port: MessagePort,
  ) => EditingResult<K> | Promise<EditingResult<K>>;
};

function clipParents(nodes: readonly ClipNode[], out: Array<[string, string]> = []) {
  for (const node of nodes) {
    if (node.id && node.parentId) out.push([node.id, node.parentId]);
    clipParents(node.children, out);
  }
  return out;
}

let consoleWatch: { seen: string[]; stop: () => void } | null = null;

function watchConsoleErrors(): string[] {
  if (consoleWatch) return consoleWatch.seen;
  const raised: unknown = Reflect.get(window, STUDIO_PREVIEW_ERRORS);
  const seen = Array.isArray(raised) ? raised.map(String) : [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    original.apply(console, args);
    const text = previewConsoleErrorText(args);
    if (text !== null) seen.push(text);
  };
  const onError = (e: ErrorEvent) => seen.push(e.message || String(e));
  window.addEventListener("error", onError);
  const stop = () => {
    console.error = original;
    window.removeEventListener("error", onError);
  };
  consoleWatch = { seen, stop };
  return seen;
}

const keyWatches = portMap<{ combos: Combo[]; down: Set<string> }>();

function forwardKey(port: MessagePort, e: KeyboardEvent): void {
  const { type, key, code, altKey, ctrlKey, metaKey, shiftKey, repeat } = e;
  const message: EditingKeyMessage = {
    v: EDITING_PROTOCOL_VERSION,
    event: "key",
    key: {
      type: type === "keyup" ? "keyup" : "keydown",
      key,
      code,
      altKey,
      ctrlKey,
      metaKey,
      shiftKey,
      repeat,
    },
  };
  postOnPort(port, message);
}

function onWatchedKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || shouldIgnorePlaybackShortcutTarget(e.target)) return;
  keyWatches.forEach((watch, port) => {
    if (!watch.combos.some((combo) => matchCombo(e, combo))) return;
    e.preventDefault();
    watch.down.add(e.code || e.key);
    forwardKey(port, e);
  });
}

function onWatchedKeyUp(e: KeyboardEvent): void {
  keyWatches.forEach((watch, port) => {
    if (watch.down.delete(e.code || e.key)) forwardKey(port, e);
  });
}

function listenForKeys(on: boolean): void {
  if (on) {
    window.addEventListener("keydown", onWatchedKeyDown, true);
    window.addEventListener("keyup", onWatchedKeyUp, true);
  } else {
    window.removeEventListener("keydown", onWatchedKeyDown, true);
    window.removeEventListener("keyup", onWatchedKeyUp, true);
  }
}

function watchKeys(port: MessagePort, combos: string[]): { watching: number } {
  if (combos.length === 0) keyWatches.delete(port);
  else {
    const down = keyWatches.get(port)?.down ?? new Set<string>();
    keyWatches.set(port, { combos: combos.map((text) => parseCombo(text)!), down });
  }
  listenForKeys(keyWatches.size() > 0);
  return { watching: combos.length };
}

function stylesOf(element: Element, properties: readonly string[]): Record<string, string> {
  const computed = window.getComputedStyle(element);
  const styles: Record<string, string> = {};
  for (const name of properties) {
    const value =
      name === "opacity" ? getLogicalOpacity(element, computed) : computed.getPropertyValue(name);
    if (value) styles[name] = value;
  }
  return styles;
}

const VIDEO_SETTLE_EVENTS = ["seeked", "error", "abort", "emptied"] as const;
// Without a waitMs, answers before the client's default timeout gives up.
const FRAME_PRESENTED_LIMIT_MS = EDITING_REQUEST_TIMEOUT_MS - 1_000;
const pendingPresentedWaits = new Set<() => void>();

type Cleanups = Array<() => void>;

function whenVideosSettle(videos: HTMLVideoElement[], cleanups: Cleanups, settled: () => void) {
  const waiting = new Set(videos);
  const check = () => {
    if (waiting.size === 0) return;
    for (const video of waiting) if (!video.seeking || !video.isConnected) waiting.delete(video);
    if (waiting.size === 0) settled();
  };
  for (const video of videos) {
    for (const name of VIDEO_SETTLE_EVENTS) video.addEventListener(name, check, { once: true });
    cleanups.push(() => {
      for (const name of VIDEO_SETTLE_EVENTS) video.removeEventListener(name, check);
    });
  }
  if (typeof MutationObserver === "function" && document.documentElement) {
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    cleanups.push(() => observer.disconnect());
  }
  check();
}

function whenTwoFramesPaint(cleanups: Cleanups, painted: () => void) {
  if (typeof window.requestAnimationFrame !== "function") return painted();
  let frame = window.requestAnimationFrame(() => {
    frame = window.requestAnimationFrame(painted);
  });
  cleanups.push(() => window.cancelAnimationFrame(frame));
}

function waitForFramePresented({
  waitMs = FRAME_PRESENTED_LIMIT_MS,
}: FramePresentedParams): Promise<{
  presented: boolean;
}> {
  return new Promise((resolve) => {
    const cleanups: Cleanups = [];
    let done = false;
    const finish = (presented: boolean) => {
      if (done) return;
      done = true;
      for (const clean of cleanups.splice(0)) clean();
      pendingPresentedWaits.delete(expire);
      resolve({ presented });
    };
    const expire = () => finish(false);
    pendingPresentedWaits.add(expire);
    const timer = wallSetTimeout(expire, waitMs);
    cleanups.push(() => wallClearTimeout(timer));
    const seeking = Array.from(document.querySelectorAll("video")).filter(
      (video) => video.seeking && video.isConnected,
    );
    const paint = () => whenTwoFramesPaint(cleanups, () => finish(true));
    if (seeking.length === 0) return paint();
    whenVideosSettle(seeking, cleanups, paint);
  });
}

const HANDLERS: Handlers = {
  hello: () => ({ version: EDITING_PROTOCOL_VERSION, kinds: [...EDITING_REQUEST_KINDS] }),
  "runtime-snapshot": () => ({
    playerReady: Boolean(window.__player),
    startupError: typeof window.__hfStartupError === "string" ? window.__hfStartupError : null,
    clipManifest: window.__clipManifest ?? null,
    clipParents: clipParents(window.__clipTree?.roots ?? []),
  }),
  "wait-for-seek": async () => {
    const wait = window.__hfWaitForSeekCompletion;
    if (typeof wait !== "function") return { waited: false };
    await wait();
    return { waited: true };
  },
  "set-loop-start": ({ seconds }) => {
    const setLoopStart = window.__hf?.setLoopStart;
    if (typeof setLoopStart !== "function") return { applied: false };
    setLoopStart(seconds);
    return { applied: true };
  },
  "computed-styles": (params) => {
    const { properties } = params;
    if ("every" in params)
      return { styles: null, ...readEveryMatch(params.selector, (el) => stylesOf(el, properties)) };
    const element =
      "handle" in params
        ? elementForHandle(params.handle)
        : document.querySelector(params.selector);
    return { styles: element ? stylesOf(element, properties) : null };
  },
  "authored-styles": authoredStyles,
  "font-faces": () => fontFaces(),
  "elements-at-point": ({ x, y }) => ({ elements: elementsAtPoint(x, y) }),
  "pointer-targets": ({ x, y }) => pointerTargetsAt(x, y),
  describe: ({ handles }) => ({ elements: describeHandles(handles) }),
  ancestors: ({ handles }) => ({ ancestors: ancestorHandles(handles) }),
  query: ({ selector }) => queryElements(selector),
  geometry: ({ handles, children }) => elementGeometry(handles, children),
  layers: ({ group, offset }) => layersOf(group, offset),
  draft: ({ drafts, chrome }) => ({
    ...drawDrafts(drafts, chrome),
    gsapSetTakesDrafts: true as const,
  }),
  "gesture-start": ({ handles }) => gestureStart(handles),
  "gesture-base": ({ handles }) => ({ elements: handles.map(gestureBase) }),
  "console-errors": ({ from }) => {
    const seen = watchConsoleErrors();
    const errors = seen.slice(from, from + MAX_QUERY_MATCHES);
    return { errors, truncated: from + errors.length < seen.length };
  },
  "watch-keys": ({ combos }, port) => watchKeys(port, combos),
  "restore-attributes": restoreAttributesOrRerun,
  "caption-words": captionWords,
  "caption-transform": captionTransform,
  "color-grading-status": colorGradingStatus,
  "color-grading-previews": colorGradingPreviews,
  "color-grading-playback": colorGradingPlayback,
  "watch-geometry": (params, port) => watchGeometry(port, params, EDITING_PROTOCOL_VERSION),
  "audio-meter": (params) => audioMeter(params, window.__hf?.audioMeter),
  "document-markup": documentMarkup,
  "set-audio-group-attribute": setAudioGroupAttribute,
  "assign-audio-group": (params) => assignAudioGroup(params, elementForHandle),
  "gsap-snapshot": () => gsapSnapshot(),
  "motion-path-home": ({ selector }) => motionPathHome(selector),
  "max-z-index": () => maxZIndex(),
  "crop-lift": cropLift,
  "edit-element": editElement,
  "remove-elements": removeElements,
  "stacking-family": stackingFamily,
  "gsap-set": gsapSet,
  "patch-tweens": patchTweens,
  "soft-reload": softReload,
  "hold-scenes": holdScenes,
  "mark-scenes-stale": markScenesStale,
  "swap-scenes": swapScenes,
  "live-retime": liveRetime,
  "rebind-timing": rebindTiming,
  "assets-unloaded": () => ({ unloaded: previewAssetsUnloaded(document, window.__hfLottie) }),
  "serve-paused-frames": ({ channel }) => {
    const install = window.__hf?.setPausedVideoFrameProvider;
    if (!install) {
      channel.close();
      return { served: false };
    }
    install(portPausedVideoProvider(channel));
    return { served: true };
  },
  "text-edit": (params, port) => textEdit(params, port, EDITING_PROTOCOL_VERSION),
  "frame-presented": waitForFramePresented,
  "arm-canvas-keys": (params, port) => armCanvasKeys(port, params, EDITING_PROTOCOL_VERSION),
  "resolve-canvas-key-action": resolveCanvasKeyAction,
  "stage-measure": ({ maxItems }) => measureStageDocument(document, maxItems),
  "stage-act": (params, port) => stageAct(params, port, EDITING_PROTOCOL_VERSION),
};

function serve(port: MessagePort): void {
  const reply = (message: EditingReply) => {
    try {
      postOnPort(port, message);
    } catch (err) {
      // A result that cannot be cloned still owes the parent an answer.
      if (message.ok) reply(failure(message.id, err));
      else swallow("editingAgent.reply", err);
    }
  };
  onPortMessage(port, (data) => {
    const request = parseEditingRequest(data);
    if (!request.ok) {
      reply({
        v: EDITING_PROTOCOL_VERSION,
        id: request.id,
        ok: false,
        error: { code: request.code, message: request.message },
      });
      return;
    }
    const handler = HANDLERS[request.kind] as (params: unknown, port: MessagePort) => unknown;
    Promise.resolve()
      .then(() => handler(request.params, port))
      .then(
        (result) => reply({ v: EDITING_PROTOCOL_VERSION, id: request.id, ok: true, result }),
        (err: unknown) => reply(failure(request.id, err)),
      );
  });
}

function failure(id: number, err: unknown): EditingReply {
  const message = err instanceof Error ? err.message : String(err);
  return {
    v: EDITING_PROTOCOL_VERSION,
    id,
    ok: false,
    error: { code: "failed", message: message.slice(0, 500) },
  };
}

const parentAtLoad = typeof window !== "undefined" ? window.parent : undefined;

function isConnectRequest(event: MessageEvent<unknown>, parent: Window): boolean {
  // A top-level page is its own parent, so a self-post would pass the source check.
  if (parent === window || event.source !== parent) return false;
  const data = event.data;
  return isPlainRecord(data) && data.source === "hf-parent" && data.type === EDITING_CONNECT;
}

function listenForConnects(parent: Window, take: (port: MessagePort) => void): () => void {
  const onMessage = (event: MessageEvent<unknown>) => {
    if (!isConnectRequest(event, parent)) return;
    const ports = endMessageAndTakePorts(event);
    const version = (event.data as { v?: unknown }).v;
    const served =
      ports.length === 1 &&
      version === EDITING_PROTOCOL_VERSION &&
      canServePorts(event) &&
      markedForStudio(document);
    if (served) return take(ports[0]!);
    for (let i = 0; i < ports.length; i += 1) closePort(ports[i]!);
  };
  window.addEventListener("message", onMessage, true);
  return () => window.removeEventListener("message", onMessage, true);
}

const waiting = portMap<true>();
let takeAtLoad: (port: MessagePort) => void = (port) => waiting.set(port, true);
let stopAtLoad: (() => void) | null = null;

export function listenForEditingConnect(): void {
  if (!parentAtLoad || stopAtLoad) return;
  stopAtLoad = listenForConnects(parentAtLoad, (port) => takeAtLoad(port));
}

export function installEditingAgent(parent?: Window): {
  dispose: () => void;
} {
  const ports = portMap<true>();
  const take = (port: MessagePort) => {
    ports.set(port, true);
    serve(port);
    preloadMotionPath();
  };
  let stop: () => void;
  if (!parent && stopAtLoad) {
    stop = stopAtLoad;
    stopAtLoad = null;
    takeAtLoad = take;
    waiting.forEach((_, port) => take(port));
    waiting.clear();
  } else {
    stop = listenForConnects(parent ?? parentAtLoad ?? window.parent, take);
  }
  return {
    dispose() {
      stop();
      ports.forEach((_, port) => closePort(port));
      ports.clear();
      consoleWatch?.stop();
      consoleWatch = null;
      keyWatches.clear();
      listenForKeys(false);
      stopWatchingGeometry();
      endTextEdit();
      for (const expire of [...pendingPresentedWaits]) expire();
      resetCanvasKeys(true);
      endStageAct();
      clearDragChrome();
    },
  };
}
