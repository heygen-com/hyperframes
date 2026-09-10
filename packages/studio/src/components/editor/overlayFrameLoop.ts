/**
 * One animation frame for every editor overlay that tracks preview geometry by
 * polling — and no frame at all while the editor is sitting still.
 *
 * Each overlay used to own an unconditional `requestAnimationFrame(update)`.
 * Four of them never stopped, so a paused, untouched Studio ran ~240 callbacks
 * a second, every one of them reading layout and one of them writing style,
 * which kept the compositor committing 55 frames a second with nothing moving.
 *
 * Parking is safe because none of these overlays has a clock of its own. They
 * change only in response to something observable: a pointer, a key, a scroll
 * or resize, a message from the preview (the runtime posts one on every frame
 * the playhead moves), or a mutation inside the preview document. Those are the
 * wake sources below, and `requestOverlayFrames` is the door for anything else.
 *
 * `IDLE_POLL_MS` is the safety net, and the reason a missed wake source is a
 * quarter second of staleness rather than a permanently frozen overlay.
 */

/**
 * How long the loop keeps running frames after the last wake.
 *
 * Long enough to outlast the consequences of the event that woke it, not just
 * the event: a click opens a panel whose CSS transition moves the preview for
 * the next couple of hundred milliseconds, and no further event is dispatched
 * while it does.
 */
const AWAKE_MS = 400;
/** How often a parked loop runs one frame anyway, in case a wake was missed. */
export const IDLE_POLL_MS = 250;

const subscribers = new Set<() => void>();

let frameId: number | null = null;
let idleTimerId: ReturnType<typeof setTimeout> | null = null;
let awakeUntil = 0;
let listenersAttached = false;

/** Wake sources. All passive reads; none of them can be cancelled by us. */
const WINDOW_EVENTS = [
  "pointerdown",
  "pointermove",
  "pointerup",
  "wheel",
  "keydown",
  "keyup",
  "scroll",
  "resize",
  "visibilitychange",
] as const;

// The preview posts a `state` message on a fixed interval even when the
// playhead has not moved — the control bridge's paused heartbeat, which exists
// so a listener can confirm a paused position. Waking on every message would
// therefore hold the overlays at 60 fps for as long as the editor is open,
// which is exactly the cost this loop exists to remove. Wake on the messages
// that carry news instead.
let lastPreviewFrame: number | null = null;
let lastPreviewPlaying: boolean | null = null;

/**
 * The preview iframe is served by the editor's own origin (`useTimelinePlayer`
 * builds its src against `window.location.origin`), so a message from anywhere
 * else is not the preview whatever its payload claims. Answered before the
 * payload is read, because a sender we do not trust controls every field in it.
 */
function isFromPreviewOrigin(event: MessageEvent): boolean {
  if (typeof window === "undefined") return true;
  return event.origin === window.location.origin;
}

/**
 * `window` also receives postMessage traffic from extensions, devtools and any
 * other embed on the page. Waking on those would hold the overlays awake for
 * reasons that have nothing to do with the preview.
 */
function isPreviewPayload(data: unknown): data is { type?: unknown } {
  if (data == null || typeof data !== "object") return false;
  return (data as { source?: unknown }).source === "hf-preview";
}

/** The playhead position a `state` post carries, or null for any other post. */
function previewStateOf(data: {
  type?: unknown;
}): { frame: number | null; playing: boolean } | null {
  if (data.type !== "state") return null;
  const frame = (data as { frame?: unknown }).frame;
  return {
    frame: typeof frame === "number" ? frame : null,
    playing: (data as { isPlaying?: unknown }).isPlaying === true,
  };
}

function onPreviewMessage(event: MessageEvent): void {
  if (!isFromPreviewOrigin(event)) return;
  const data: unknown = event.data;
  if (!isPreviewPayload(data)) return;
  const state = previewStateOf(data);
  if (state) {
    if (state.frame === lastPreviewFrame && state.playing === lastPreviewPlaying) return;
    lastPreviewFrame = state.frame;
    lastPreviewPlaying = state.playing;
  }
  requestOverlayFrames();
}

function runFrame(): void {
  frameId = null;
  // Re-arm BEFORE running anything, exactly as the four separate loops this
  // replaces did. A subscriber that throws must not take the loop down with
  // it — and a shared loop makes that failure four overlays wide plus the
  // idle-poll safety net, permanently, rather than one overlay's own problem.
  schedule();
  for (const subscriber of subscribers) {
    try {
      subscriber();
    } catch (error) {
      // Rethrown out of band so it still reaches window.onerror and whatever
      // reports errors, without any subscriber becoming the others' fate.
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}

function schedule(): void {
  if (subscribers.size === 0) return;
  if (frameId != null || idleTimerId != null) return;
  if (performance.now() < awakeUntil) {
    frameId = requestAnimationFrame(runFrame);
    return;
  }
  idleTimerId = setTimeout(() => {
    idleTimerId = null;
    frameId = requestAnimationFrame(runFrame);
  }, IDLE_POLL_MS);
}

/** Something moved, or might have. Run frames at full rate for a moment. */
export function requestOverlayFrames(): void {
  awakeUntil = performance.now() + AWAKE_MS;
  if (idleTimerId != null) {
    clearTimeout(idleTimerId);
    idleTimerId = null;
  }
  schedule();
}

function attachListeners(): void {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;
  for (const type of WINDOW_EVENTS) {
    window.addEventListener(type, requestOverlayFrames, { capture: true, passive: true });
  }
  window.addEventListener("message", onPreviewMessage, { capture: true, passive: true });
}

function detachListeners(): void {
  if (!listenersAttached || typeof window === "undefined") return;
  listenersAttached = false;
  for (const type of WINDOW_EVENTS) {
    window.removeEventListener(type, requestOverlayFrames, { capture: true });
  }
  window.removeEventListener("message", onPreviewMessage, { capture: true });
}

/**
 * Run `update` on the shared loop. The subscriber must be a pure poll: it is
 * called on an ordinary animation frame while the editor is active and roughly
 * four times a second while it is not.
 */
export function subscribeOverlayFrame(update: () => void): () => void {
  subscribers.add(update);
  attachListeners();
  // A fresh subscriber has never read anything, so it starts awake.
  requestOverlayFrames();
  return () => {
    subscribers.delete(update);
    if (subscribers.size > 0) return;
    if (frameId != null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    if (idleTimerId != null) {
      clearTimeout(idleTimerId);
      idleTimerId = null;
    }
    detachListeners();
  };
}

/** Test seam: the loop is module state, and tests need it back at zero. */
export function resetOverlayFrameLoopForTests(): void {
  subscribers.clear();
  if (frameId != null) cancelAnimationFrame(frameId);
  if (idleTimerId != null) clearTimeout(idleTimerId);
  frameId = null;
  idleTimerId = null;
  awakeUntil = 0;
  lastPreviewFrame = null;
  lastPreviewPlaying = null;
  detachListeners();
}
