/** A composition is "ready" once every declared input settles, not just once
 * its duration is known. Each input returns null (nothing to wait on) or a
 * promise that resolves once it settles, and must stop its own pending work
 * (timer, rAF, listener) once `signal` aborts — settleCompositionReadiness
 * aborts it the moment the race settles, win or timeout. */
export type CompositionReadinessInput = (
  doc: Document,
  signal: AbortSignal,
) => Promise<void> | null;

export interface PendingCompositionAssets {
  pendingMedia: HTMLMediaElement[];
  pendingImages: HTMLImageElement[];
  fontsLoading: boolean;
}

// HTMLMediaElement.HAVE_FUTURE_DATA per spec, used as a literal because not
// every DOM implementation defines the named static (e.g. happy-dom leaves
// it undefined).
const HAVE_FUTURE_DATA = 3;

// `doc` is a foreign (same-origin) iframe document, so its elements belong to
// that iframe's own realm — instanceof checks against this window's globals
// would silently reject every one of them. Resolve the class from the node's
// own defaultView first.
export function isRealmElement(node: Node): node is Element {
  const view = node.ownerDocument?.defaultView;
  if (view && node instanceof view.Element) return true;
  return node instanceof Element;
}

export function isRealmHtmlMediaElement(node: Node): node is HTMLMediaElement {
  if (!isRealmElement(node)) return false;
  if (node.tagName !== "AUDIO" && node.tagName !== "VIDEO") return false;
  const view = node.ownerDocument?.defaultView;
  if (view && node instanceof view.HTMLMediaElement) return true;
  return node instanceof HTMLMediaElement;
}

/** One DOM pass for every declared-media asset not yet ready. */
export function scanPendingCompositionAssets(doc: Document): PendingCompositionAssets {
  const pendingMedia = Array.from(doc.querySelectorAll("video, audio"))
    .filter(isRealmHtmlMediaElement)
    .filter((el) => el.readyState < HAVE_FUTURE_DATA);
  const pendingImages = Array.from(doc.querySelectorAll("img")).filter((img) => !img.complete);
  const fontsLoading = doc.fonts?.status === "loading";
  return { pendingMedia, pendingImages, fontsLoading };
}

function collectPendingCompositionAssets(
  doc: Document,
  { pendingMedia, pendingImages, fontsLoading }: PendingCompositionAssets,
  signal: AbortSignal,
): Promise<void> {
  const mediaReady = pendingMedia.map(
    (el) =>
      new Promise<void>((resolve) => {
        // init.ts's eager preload pass may have already errored this element
        // before this input ran; a DOM error event doesn't refire, so a
        // listener attached now would wait for the shared 8s timeout instead.
        if (el.error) {
          resolve();
          return;
        }
        const onSettled = () => {
          el.removeEventListener("canplay", onSettled);
          el.removeEventListener("error", onSettled);
          signal.removeEventListener("abort", onSettled);
          resolve();
        };
        el.addEventListener("canplay", onSettled);
        el.addEventListener("error", onSettled);
        signal.addEventListener("abort", onSettled, { once: true });
      }),
  );
  const imagesReady = pendingImages.map((img) =>
    img.decode ? img.decode().catch(() => {}) : Promise.resolve(),
  );
  const fontsReady = fontsLoading && doc.fonts ? doc.fonts.ready.then(() => {}) : Promise.resolve();
  return Promise.all([...mediaReady, ...imagesReady, fontsReady]).then(() => {});
}

/** Declared-media readiness input: waits on the composition's own video,
 * audio, image and font-face loads. */
export function mediaReadinessInput(doc: Document, signal: AbortSignal): Promise<void> | null {
  const scan = scanPendingCompositionAssets(doc);
  if (scan.pendingMedia.length === 0 && scan.pendingImages.length === 0 && !scan.fontsLoading) {
    return null;
  }
  return collectPendingCompositionAssets(doc, scan, signal);
}

const RENDER_READY_POLL_MS = 50;

// `window.__renderReady` is declared globally in runtime/window.d.ts, but that
// file lives under src/runtime — excluded from this package's own build
// program (see tsconfig.json) — so it isn't visible here. Same flag, declared
// locally instead of depending on a global merge from outside this file's scope.
interface RuntimeReadinessWindow extends Window {
  __renderReady?: boolean;
  // __renderReady is only ever set by init.ts, which always sets __hf
  // first (`window.__hf = window.__hf || {}`) — a doc with no __hf can
  // never get __renderReady either, so this alone is enough to gate on
  // (unlike composition-probe.ts's hasRuntime, this doesn't need __player too).
  __hf?: unknown;
}

/** Declared-compute readiness input: waits on `window.__renderReady`. A
 * probe-only composition (no HyperFrames runtime injected) never sets
 * it — __hf absent means nothing to wait on, not an 8s poll for a flag
 * that was never going to flip. */
export function computeReadinessInput(doc: Document, signal: AbortSignal): Promise<void> | null {
  const win = doc.defaultView as RuntimeReadinessWindow | null;
  if (!win) return null;
  if (win.__renderReady) return null;
  if (!win.__hf) return null;
  return new Promise<void>((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    if (signal.aborted) {
      finish();
      return;
    }
    signal.addEventListener("abort", finish, { once: true });
    const poll = () => {
      if (win.__renderReady) {
        finish();
        return;
      }
      timeoutId = setTimeout(poll, RENDER_READY_POLL_MS);
    };
    poll();
  });
}

// Frame-to-frame gap under which the main thread counts as free. Generous
// relative to a 16.7ms (60fps) frame budget — this detects a busy stretch
// (a mesh build, a shader compile), not ordinary frame-time variance.
const IDLE_FRAME_GAP_MS = 50;
// Two consecutive quiet frames, not one: a single fast gap can follow
// directly after the busy work finishes mid-frame and says nothing about
// whether the next frame is also free.
const IDLE_FRAMES_REQUIRED = 2;
// Gives up on a doc that keeps producing frames below 20fps. Does NOT bound
// a doc that stops painting entirely (backgrounded tab, or fewer than 3
// frames total) — that still rides the full shared 8s timeout, same as
// before this input existed. ponytail: 1500ms is unmeasured, retune later.
const MAX_PAINT_WAIT_MS = 1_500;

// Resolves with -1 on abort instead of rejecting: every caller already
// re-checks `signal.aborted` right after awaiting this, so a sentinel value
// is enough and keeps the abort path a plain early-return, not a try/catch.
function nextAnimationFrame(win: Window, signal: AbortSignal): Promise<number> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(-1);
      return;
    }
    const id = win.requestAnimationFrame((ts) => {
      signal.removeEventListener("abort", onAbort);
      resolve(ts);
    });
    const onAbort = () => {
      win.cancelAnimationFrame?.(id);
      resolve(-1);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Composition-agnostic readiness input: waits for a frame to paint, then
 * two consecutive quiet frame gaps — an early-out once the main thread is
 * free, not a hold on steady sub-20fps painting. See MAX_PAINT_WAIT_MS for
 * what this bound does and does not cover. */
export function paintAndIdleReadinessInput(
  doc: Document,
  signal: AbortSignal,
): Promise<void> | null {
  const win = doc.defaultView;
  if (!win) return null;
  return (async () => {
    const firstTs = await nextAnimationFrame(win, signal);
    if (signal.aborted) return;
    let lastTs = await nextAnimationFrame(win, signal);
    let quietStreak = 0;
    while (!signal.aborted && quietStreak < IDLE_FRAMES_REQUIRED) {
      if (lastTs - firstTs >= MAX_PAINT_WAIT_MS) return;
      const ts = await nextAnimationFrame(win, signal);
      if (signal.aborted) return;
      quietStreak = ts - lastTs < IDLE_FRAME_GAP_MS ? quietStreak + 1 : 0;
      lastTs = ts;
    }
  })();
}

const DEFAULT_TIMEOUT_MS = 8_000;

export interface CompositionReadinessResult {
  timedOut: boolean;
}

/** Invokes `onSettled` once every input settles, or the timeout elapses.
 * Calls back synchronously, before returning, when nothing is pending — a
 * caller that plays right after this call sees the decision already
 * applied, same as before this gate existed. With the default inputs this
 * only happens for a document with no `defaultView`, since
 * paintAndIdleReadinessInput always has a frame to wait on otherwise. */
export function settleCompositionReadiness(
  doc: Document,
  onSettled: (result: CompositionReadinessResult) => void,
  opts: { inputs?: CompositionReadinessInput[]; timeoutMs?: number } = {},
): void {
  const inputs = opts.inputs ?? [
    mediaReadinessInput,
    computeReadinessInput,
    paintAndIdleReadinessInput,
  ];
  const controller = new AbortController();
  const pending = inputs
    .map((input) => input(doc, controller.signal))
    .filter((p): p is Promise<void> => p !== null);
  if (pending.length === 0) {
    onSettled({ timedOut: false });
    return;
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<"timed-out">((resolve) => {
    timeoutId = setTimeout(() => resolve("timed-out"), timeoutMs);
  });
  // A timeout win leaves the losing inputs' promises pending forever unless
  // told to stop: this abort is what lets computeReadinessInput clear its
  // poll timer and paintAndIdleReadinessInput cancel its rAF chain instead
  // of running for the life of the page.
  Promise.race([Promise.all(pending).then(() => "done" as const), timeout]).then((result) => {
    clearTimeout(timeoutId);
    controller.abort();
    onSettled({ timedOut: result === "timed-out" });
  });
}
