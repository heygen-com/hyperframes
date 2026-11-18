/**
 * The runtime's end of the editing channel (wire types in `editingPort.ts`).
 *
 * Each connect from `window.parent` gets a fresh port, so only the parent holds a channel and a
 * remounted client is served too; any other connect, or any in a page served to another site, is
 * ignored. Earlier ports stay open: a client may take any of them; a disposed one closes its own.
 * Requests on the port are validated; a bad one gets a typed error reply, never a throw.
 */
import { swallow } from "./diagnostics";
import {
  EDITING_CONNECT,
  EDITING_PORT,
  EDITING_PROTOCOL_VERSION,
  EDITING_REQUEST_KINDS,
  isPlainRecord,
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
} from "./editingHandles";
import { elementGeometry } from "./editingGeometry";
import { pointerTargetsAt } from "./editingTargets";
import { layersOf } from "./editingLayers";
import { drawDrafts } from "./editingDraft";
import { restoreAttributes } from "./editing/restoreAttributes";
import { stopWatchingGeometry, watchGeometry } from "./editing/watchGeometry";
import { maxZIndex } from "./editing/maxZIndex";
import { gestureStart } from "./editingGestureStart";
import { gsapSnapshot } from "./editing/gsapSnapshot";
import { motionPathHome } from "./editing/motionPathHome";
import { cropLift } from "./editing/cropLift";
import { gsapSet } from "./editing/gsapSet";
import { patchTweens } from "./editing/patchTween";
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
import { setAudioGroupAttribute } from "./editing/setAudioGroupAttribute";
import { editElement } from "./editing/editElement";

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

const keyWatches = new Map<MessagePort, { combos: Combo[]; down: Set<string> }>();

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
  port.postMessage(message);
}

function onWatchedKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || shouldIgnorePlaybackShortcutTarget(e.target)) return;
  for (const [port, watch] of keyWatches) {
    if (!watch.combos.some((combo) => matchCombo(e, combo))) continue;
    e.preventDefault();
    watch.down.add(e.code || e.key);
    forwardKey(port, e);
  }
}

function onWatchedKeyUp(e: KeyboardEvent): void {
  for (const [port, watch] of keyWatches) {
    if (watch.down.delete(e.code || e.key)) forwardKey(port, e);
  }
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
  listenForKeys(keyWatches.size > 0);
  return { watching: combos.length };
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
    const element =
      "handle" in params
        ? elementForHandle(params.handle)
        : document.querySelector(params.selector);
    if (!element) return { styles: null };
    const computed = window.getComputedStyle(element);
    const styles: Record<string, string> = {};
    for (const name of properties) {
      const value =
        name === "opacity" ? getLogicalOpacity(element, computed) : computed.getPropertyValue(name);
      if (value) styles[name] = value;
    }
    return { styles };
  },
  "elements-at-point": ({ x, y }) => ({ elements: elementsAtPoint(x, y) }),
  "pointer-targets": ({ x, y }) => pointerTargetsAt(x, y),
  describe: ({ handles }) => ({ elements: describeHandles(handles) }),
  ancestors: ({ handles }) => ({ ancestors: ancestorHandles(handles) }),
  query: ({ selector }) => queryElements(selector),
  geometry: ({ handles, children }) => elementGeometry(handles, children),
  layers: ({ group, offset }) => layersOf(group, offset),
  draft: ({ drafts }) => drawDrafts(drafts),
  "gesture-start": ({ handles }) => gestureStart(handles),
  "console-errors": ({ from }) => {
    const seen = watchConsoleErrors();
    const errors = seen.slice(from, from + MAX_QUERY_MATCHES);
    return { errors, truncated: from + errors.length < seen.length };
  },
  "watch-keys": ({ combos }, port) => watchKeys(port, combos),
  "restore-attributes": (params) => restoreAttributes(params),
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
  "gsap-set": gsapSet,
  "patch-tweens": patchTweens,
};

function serve(port: MessagePort): void {
  const reply = (message: EditingReply) => {
    try {
      port.postMessage(message);
    } catch (err) {
      // A result that cannot be cloned still owes the parent an answer.
      if (message.ok) reply(failure(message.id, err));
      else swallow("editingAgent.reply", err);
    }
  };
  port.onmessage = (event: MessageEvent<unknown>) => {
    const request = parseEditingRequest(event.data);
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
  };
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

export function installEditingAgent(parent: Window = window.parent): { dispose: () => void } {
  const ports = new Set<MessagePort>();
  const onMessage = (event: MessageEvent<unknown>) => {
    // A top-level page is its own parent, so a self-post would pass the source check.
    if (parent === window || event.source !== parent) return;
    const data = event.data;
    if (!isPlainRecord(data) || data.source !== "hf-parent" || data.type !== EDITING_CONNECT)
      return;
    if (data.v !== EDITING_PROTOCOL_VERSION || !markedForStudio(document)) return;
    const channel = new MessageChannel();
    const port = channel.port1;
    ports.add(port);
    serve(port);
    try {
      // "*" as every runtime post does (bridge.ts): the frame is not told its parent's origin.
      parent.postMessage(
        { source: "hf-preview", type: EDITING_PORT, v: EDITING_PROTOCOL_VERSION },
        "*",
        [channel.port2],
      );
    } catch (err) {
      swallow("editingAgent.handoff", err);
      port.close();
      ports.delete(port);
    }
  };
  window.addEventListener("message", onMessage);
  return {
    dispose() {
      window.removeEventListener("message", onMessage);
      for (const port of ports) port.close();
      ports.clear();
      consoleWatch?.stop();
      consoleWatch = null;
      keyWatches.clear();
      listenForKeys(false);
      stopWatchingGeometry();
    },
  };
}
