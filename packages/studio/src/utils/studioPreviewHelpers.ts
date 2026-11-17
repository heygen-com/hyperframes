import {
  compositionPoint,
  coversComposition,
  pointerTarget,
  pointerTargets,
} from "@hyperframes/core/runtime/editing-port";

// One canvas hit-test for Studio and the runtime that answers it for a frame Studio cannot script.
export { coversComposition };

/** The element a press at a client point picks in a frame Studio can script, or null. */
export function getPreviewTargetFromPointer(
  iframe: HTMLIFrameElement,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const local = framePointer(iframe, clientX, clientY);
  return local && pointerTarget(local.doc, local.point);
}

/** Returns all independently-selectable elements at the pointer (topmost first). */
export function getAllPreviewTargetsFromPointer(
  iframe: HTMLIFrameElement,
  clientX: number,
  clientY: number,
): HTMLElement[] {
  const local = framePointer(iframe, clientX, clientY);
  return local ? pointerTargets(local.doc, local.point) : [];
}

/** Where a client point falls in `iframe`, as fractions of its box; the frame maps them onto its composition. */
export function framePointFraction(iframe: HTMLIFrameElement, clientX: number, clientY: number) {
  const rect = iframe.getBoundingClientRect();
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
}

function framePointer(iframe: HTMLIFrameElement, clientX: number, clientY: number) {
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return null;
  }
  if (!doc?.defaultView) return null;
  const { x, y } = framePointFraction(iframe, clientX, clientY);
  const point = compositionPoint(doc, x, y);
  return point && { doc, point };
}

function objectLike(value: unknown): object | null {
  return value && (typeof value === "object" || typeof value === "function") ? value : null;
}

function callPlaybackMethod(target: object | null, key: string): void {
  const method = target ? Reflect.get(target, key) : null;
  if (typeof method !== "function") return;
  try {
    method.call(target);
  } catch {
    // Best-effort playback freeze; drag should still work if playback control is unavailable.
  }
}

function readPlaybackTime(target: object | null, key: string): number | null {
  const method = target ? Reflect.get(target, key) : null;
  if (typeof method !== "function") return null;
  try {
    const value = method.call(target);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function pauseStudioPreviewPlayback(iframe: HTMLIFrameElement | null): number | null {
  const win = iframe?.contentWindow;
  if (!win) return null;

  try {
    const player = objectLike(Reflect.get(win, "__player"));
    const playerPausedTime = readPlaybackTime(player, "getTime");
    const playerPause = player ? Reflect.get(player, "pause") : null;
    if (typeof playerPause === "function") {
      callPlaybackMethod(player, "pause");
      return playerPausedTime;
    }

    let pausedTime: number | null = null;
    const timeline = objectLike(Reflect.get(win, "__timeline"));
    pausedTime = pausedTime ?? readPlaybackTime(timeline, "time");
    callPlaybackMethod(timeline, "pause");

    const timelines = objectLike(Reflect.get(win, "__timelines"));
    if (timelines) {
      for (const value of Object.values(timelines)) {
        const timelineRecord = objectLike(value);
        pausedTime = pausedTime ?? readPlaybackTime(timelineRecord, "time");
        callPlaybackMethod(timelineRecord, "pause");
      }
    }

    return pausedTime;
  } catch {
    return null;
  }
}
