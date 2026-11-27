// A sealed preview's GSAP tweens, read over the editing port and shaped like the live objects the
// readers walk. Tween data answers at any time; values and timeline times only at the playhead read.
import { useSyncExternalStore } from "react";
import type { EditingPortClient, EditingResult } from "@hyperframes/core/runtime/editing-port";
import {
  previewEditingClient,
  previewFrameOpaque,
  previewRequest,
} from "../player/lib/previewChannel";
import { onPreviewContentReplaced, onPreviewRestoredInPlace } from "../player/sceneSwap";
import { usePlayerStore } from "../player/store/playerStore";
import { usePreviewIframeStore } from "../player/store/previewIframeStore";
import { previewStandInHandle } from "../components/editor/previewDrafts";
import type { RuntimeTimeline } from "./gsapRuntimeKeyframes";
import { readGsapSnapshot } from "./gsapSnapshotReply";

type Snapshot = EditingResult<"gsap-snapshot">;
type SnapshotTween = Snapshot["timelines"][number]["tweens"][number];

interface HeldSnapshot {
  /** The paused playhead the frame was read at. */
  readAt: number | null;
  json: string;
  timelines: Record<string, RuntimeTimeline>;
  document: Document;
  byHandle: Map<string, Element>;
  values: WeakMap<Element, Record<string, number>>;
  defaultEase: string | null;
}

const held = new WeakMap<EditingPortClient, HeldSnapshot>();
const asking = new WeakMap<EditingPortClient, Promise<void>>();
const watched = new WeakSet<EditingPortClient>();
const listeners = new Set<() => void>();
let version = 0;

const pausedPlayhead = (): number | null => {
  const { isPlaying, currentTime } = usePlayerStore.getState();
  return isPlaying ? null : currentTime;
};

function fresh(snapshot: HeldSnapshot): boolean {
  const playhead = pausedPlayhead();
  return playhead !== null && snapshot.readAt === playhead;
}

/** Half a frame at 60 fps: the frame may hold a seek to its own frame grid. */
const SEEK_TOLERANCE_S = 1 / 120;
const seekLanded = (frameTime: number | null, readAt: number | null) =>
  frameTime !== null && readAt !== null && Math.abs(frameTime - readAt) <= SEEK_TOLERANCE_S;

let watchingPlayhead = false;

/** After a seek, the previewed frame is read again where the playhead stopped. */
function watchPlayhead() {
  if (watchingPlayhead) return;
  watchingPlayhead = true;
  usePlayerStore.subscribe((state, before) => {
    if (state.isPlaying || state.currentTime === before.currentTime) return;
    const { iframe } = usePreviewIframeStore.getState();
    if (iframe && held.has(previewEditingClient(iframe))) void refreshGsapSnapshot(iframe);
  });
}

function announce() {
  version += 1;
  for (const listener of listeners) listener();
}

/** Re-reads the frame's tweens; readers answer from the last read meanwhile. */
function refreshGsapSnapshot(iframe: HTMLIFrameElement): Promise<void> {
  const client = previewEditingClient(iframe);
  const pending = asking.get(client) ?? read(iframe, client);
  asking.set(client, pending);
  return pending;
}

export function rereadGsapSnapshot(iframe: HTMLIFrameElement): void {
  const client = previewEditingClient(iframe);
  held.delete(client);
  asking.delete(client);
  void refreshGsapSnapshot(iframe);
}

export function gsapSnapshotSettled(iframe: HTMLIFrameElement | null): boolean {
  if (!iframe || !previewFrameOpaque(iframe)) return true;
  const snapshot = held.get(previewEditingClient(iframe));
  return !!snapshot && fresh(snapshot);
}

/** Reads the frame again unless the held read is at the paused playhead; false if an opaque frame holds none. */
export async function settleGsapSnapshot(iframe: HTMLIFrameElement | null): Promise<boolean> {
  if (!iframe || !previewFrameOpaque(iframe)) return true;
  const client = previewEditingClient(iframe);
  for (let reads = 0; reads < 2; reads++) {
    const snapshot = held.get(client);
    if (snapshot && fresh(snapshot)) return true;
    await refreshGsapSnapshot(iframe);
  }
  return held.has(client);
}

async function read(iframe: HTMLIFrameElement, client: EditingPortClient): Promise<void> {
  watchPlayhead();
  if (!watched.has(client)) {
    watched.add(client);
    const stopOnUndoRerun = onPreviewRestoredInPlace(iframe, () => rereadGsapSnapshot(iframe));
    const stop = onPreviewContentReplaced(iframe, () => {
      stop();
      stopOnUndoRerun();
      held.delete(client);
      watched.delete(client);
      void refreshGsapSnapshot(iframe);
    });
  }
  const readAt = pausedPlayhead();
  try {
    const snapshot = readGsapSnapshot(await previewRequest(iframe, "gsap-snapshot", {}));
    const before = held.get(client);
    if (!snapshot) {
      if (before) held.delete(client);
      return;
    }
    const json = JSON.stringify(snapshot);
    const stamp = pausedPlayhead() === readAt && seekLanded(snapshot.time, readAt) ? readAt : null;
    if (before?.json === json && before.readAt === stamp) return;
    held.set(client, hold(snapshot, json, stamp));
    announce();
  } finally {
    asking.delete(client);
  }
}

/** The last read of an opaque frame, asking again when there is none or the playhead moved. */
function heldSnapshot(iframe: HTMLIFrameElement | null): HeldSnapshot | null {
  if (!iframe || !previewFrameOpaque(iframe)) return null;
  const snapshot = held.get(previewEditingClient(iframe)) ?? null;
  if (!snapshot || (!fresh(snapshot) && pausedPlayhead() !== null))
    void refreshGsapSnapshot(iframe);
  return snapshot;
}

/** An opaque frame's timelines; null for a same-origin frame or before the first read lands. */
export function frameTimelines(iframe: HTMLIFrameElement | null) {
  return heldSnapshot(iframe)?.timelines ?? null;
}

/** An opaque frame's tween targets, as elements of a detached document a selector can query. */
export function frameDocument(iframe: HTMLIFrameElement | null): Document | null {
  return heldSnapshot(iframe)?.document ?? null;
}

export function frameQuery(iframe: HTMLIFrameElement | null, selector: string): Element | null {
  try {
    return frameDocument(iframe)?.querySelector(selector) ?? null;
  } catch {
    return null;
  }
}

/** The snapshot's element for Studio's stand-in of a frame element, matched by handle, else id. */
export function frameTarget(iframe: HTMLIFrameElement | null, element: Element): Element | null {
  const snapshot = heldSnapshot(iframe);
  if (!snapshot) return null;
  const handle = previewStandInHandle(element);
  const byHandle = handle ? snapshot.byHandle.get(handle) : undefined;
  if (byHandle) return byHandle;
  return element.id ? snapshot.document.getElementById(element.id) : null;
}

/** The ease GSAP falls back to; time-independent. */
export function frameDefaultEase(iframe: HTMLIFrameElement | null): string | null {
  return heldSnapshot(iframe)?.defaultEase ?? null;
}

/** GSAP's values as read at the paused playhead; null once it moved, until the next read lands. */
export function frameGsap(iframe: HTMLIFrameElement | null) {
  const snapshot = heldSnapshot(iframe);
  if (!iframe || !snapshot || !fresh(snapshot)) return null;
  return {
    getProperty(element: Element, prop: string): number {
      const target = snapshot.values.has(element) ? element : frameTarget(iframe, element);
      return (target && snapshot.values.get(target)?.[prop]) ?? Number.NaN;
    },
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes when a sealed frame's read lands, so memos over the readers recompute. */
export function useGsapSnapshotVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}

function hold(snapshot: Snapshot, json: string, readAt: number | null): HeldSnapshot {
  const document = window.document.implementation.createHTMLDocument("");
  const byHandle = new Map<string, Element>();
  const values = new WeakMap<Element, Record<string, number>>();
  for (const target of snapshot.targets) {
    const element = document.createElement("div");
    if (target.id) element.id = target.id;
    if (target.className) element.setAttribute("class", target.className);
    document.body.append(element);
    byHandle.set(target.handle, element);
    values.set(element, target.values);
  }
  const held: HeldSnapshot = {
    readAt,
    json,
    // Ids are the frame's: a timeline named __proto__ must stay a timeline.
    timelines: Object.create(null) as Record<string, RuntimeTimeline>,
    document,
    byHandle,
    values,
    defaultEase: snapshot.defaultEase,
  };
  for (const line of snapshot.timelines) {
    const timeline = {
      vars: { defaults: { ease: line.defaultEase ?? undefined } },
      time: () => (fresh(held) ? line.time : null),
      getChildren: () => tweens,
    } as unknown as RuntimeTimeline;
    const tweens = line.tweens.map((tween) => liveShaped(tween, byHandle, timeline));
    held.timelines[line.id] = timeline;
  }
  return held;
}

/** The fields of a GSAP tween the readers use, from the snapshot's copy. */
function liveShaped(
  tween: SnapshotTween,
  byHandle: Map<string, Element>,
  parent?: unknown,
): Record<string, unknown> {
  const targets = tween.targets.flatMap((handle) => byHandle.get(handle) ?? []);
  const _pt = tween.parsed.reduceRight<object | undefined>(
    (next, { p, s, c }) => ({ p, s, c, _next: next }),
    undefined,
  );
  const parts: Array<Record<string, unknown>> = tween.parts.map((part) =>
    liveShaped(part, byHandle),
  );
  return {
    vars: tween.vars,
    _from: tween.from,
    _initted: tween.initted,
    _pt,
    parent,
    targets: () => targets,
    startTime: () => tween.start,
    duration: () => tween.duration,
    ...(parts.length > 0 && { timeline: { getChildren: () => parts } }),
  };
}
