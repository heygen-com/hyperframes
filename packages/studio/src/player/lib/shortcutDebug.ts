/**
 * Opt-in tracing for the preview keyboard path.
 *
 * Playback shortcuts fail in a way that leaves nothing behind: the listeners
 * live on the preview iframe, they are attached during a load whose errors were
 * historically swallowed, and the transport buttons keep working either way. So
 * "space doesn't work" arrives with no console output and no way to tell whether
 * the key was never seen, was seen and ignored, or was seen and handled while
 * playback failed for some other reason.
 *
 * This makes each of those three distinguishable, and stays silent unless asked
 * for — the path runs on every keystroke, so it cannot log by default.
 *
 * Turn it on with either:
 *   window.__hfDebugShortcuts = true
 *   ?debugShortcuts   (anywhere in the URL, including after the route hash)
 */

const FLAG = "debugShortcuts";

interface DebugWindow {
  __hfDebugShortcuts?: boolean;
}

export function shortcutDebugEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if ((window as unknown as DebugWindow).__hfDebugShortcuts === true) return true;
    // Studio routes on the hash, so the query can sit either side of it.
    return window.location.href.includes(FLAG);
  } catch {
    return false;
  }
}

/** One line per event, prefixed so a user can paste `[studio:shortcuts]` back. */
export function traceShortcut(event: string, detail?: Record<string, unknown>): void {
  if (!shortcutDebugEnabled()) return;
  if (detail === undefined) console.info(`[studio:shortcuts] ${event}`);
  else console.info(`[studio:shortcuts] ${event}`, detail);
}

/** A target described well enough to recognise, without dumping the node. */
export function describeTarget(target: EventTarget | null): string {
  if (!target || typeof target !== "object") return "none";
  const el = target as Partial<Element> & { tagName?: string; id?: string };
  if (!el.tagName) return "non-element";
  const id = el.id ? `#${el.id}` : "";
  const cls =
    typeof el.className === "string" && el.className ? `.${el.className.split(/\s+/)[0]}` : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}
