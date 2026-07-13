// Resize/gesture diagnostics — grep [hf-resize]. Off by default; opt in per
// session with `localStorage.setItem("hf-resize-debug", "1")` (then reload).
// Granular per-move/per-gesture tracing that complements the always-on
// [hf-commit] transaction telemetry in gestureTransaction.ts.
let moveN = 0;
let enabled: boolean | null = null;

function isEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = localStorage.getItem("hf-resize-debug") === "1";
    } catch {
      enabled = false;
    }
  }
  return enabled;
}

export function logResize(stage: string, data: Record<string, unknown>): void {
  if (!isEnabled()) return;
  console.log(
    `[hf-resize] ${JSON.stringify({ stage, t: Math.round(performance.now()), ...data })}`,
  );
}

/** Per-pointermove logging, throttled: first move then every 8th. */
export function logResizeMove(data: Record<string, unknown>): void {
  if (!isEnabled()) return;
  moveN += 1;
  if (moveN % 8 === 1) logResize("move", { n: moveN, ...data });
}

export function resetResizeMoveLog(): void {
  moveN = 0;
}

/** Snapshot the element's live geometry now and again after 200ms (jump detector). */
export function logResizeSettle(el: HTMLElement, tag: string): void {
  if (!isEnabled()) return;
  const snap = (phase: string) => {
    const r = el.getBoundingClientRect();
    const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
    logResize("settle", {
      tag,
      phase,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      cssW: cs?.width,
      cssH: cs?.height,
      transform: cs?.transform,
      inlineStyle: el.getAttribute("style"),
    });
  };
  snap("t0");
  setTimeout(() => snap("t200"), 200);
}
