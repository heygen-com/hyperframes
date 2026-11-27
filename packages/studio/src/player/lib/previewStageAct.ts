// Studio's end of `stage-act`: every reply is checked against what was asked, and draws go one request at a time.
import {
  MAX_STAGE_ACTS,
  MAX_STAGE_GHOST_MARKUP,
  readStageActHeld,
  readStageRect,
  type EditingRect,
  type StageActDraw,
  type StageActGhost,
  type StageActHeld,
  type StageActHold,
  type StageActParams,
  type StageActTarget,
  type StageInputEvent,
} from "@hyperframes/core/runtime/editing-port";
import { isMessageList } from "@hyperframes/core/runtime/protocol";
import { previewEditingClient, previewRequest } from "./previewChannel";

export type {
  StageActDraw,
  StageActGhost,
  StageActHeld,
  StageActHold,
  StageActTarget,
  StageInputEvent,
};

/** A hold gates what the person sees: past this, the act lands unheld, as open mode does when it cannot prepare. */
export const STAGE_ACT_TIMEOUT_MS = 250;

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The held entries of a reply, each a key that was asked; null when any is not. */
function readHeld(value: unknown, asked: ReadonlySet<string>): StageActHeld[] | null {
  if (!isMessageList(value, asked.size)) return null;
  const held: StageActHeld[] = [];
  for (const entry of value) {
    const one = readStageActHeld(entry);
    if (!one || !asked.has(one.key)) return null;
    held.push(one);
  }
  return held;
}

const replyOf = async (iframe: HTMLIFrameElement, params: StageActParams, timeoutMs: number) => {
  const reply: unknown = await previewRequest(iframe, "stage-act", params, timeoutMs);
  return isFields(reply) && reply.op === params.op ? reply : null;
};

/** Holds `acts` in the frame; what it held now, or null when the frame did not answer in time or answered off shape. */
export async function holdPreviewStage(
  iframe: HTMLIFrameElement,
  acts: readonly StageActHold[],
  options: { deferred: boolean; caretColor: string; timeoutMs?: number },
): Promise<StageActHeld[] | null> {
  if (acts.length > MAX_STAGE_ACTS) return null;
  const { deferred, caretColor, timeoutMs = STAGE_ACT_TIMEOUT_MS } = options;
  const keys = acts.map((act) => act.key);
  const reply = await replyOf(
    iframe,
    { op: "hold", acts: [...acts], deferred, caretColor },
    timeoutMs,
  );
  const held = reply && readHeld(reply.held, new Set(keys));
  // A hold answered late, or off shape, may still have held: the port keeps order, so this restore lands after it.
  if (!held) void restorePreviewStage(iframe, keys);
  return held;
}

/** Holds those of `keys` a deferred hold is still waiting on, if their elements show now. */
export async function readyPreviewStage(
  iframe: HTMLIFrameElement,
  keys: readonly string[],
  timeoutMs = STAGE_ACT_TIMEOUT_MS,
): Promise<StageActHeld[] | null> {
  if (keys.length > MAX_STAGE_ACTS) return null;
  const reply = await replyOf(iframe, { op: "ready", keys: [...keys] }, timeoutMs);
  return reply && readHeld(reply.held, new Set(keys));
}

/** Gives `keys` back, or every held element for null; how many it gave back. */
export async function restorePreviewStage(
  iframe: HTMLIFrameElement,
  keys: readonly string[] | null,
  timeoutMs?: number,
): Promise<number | null> {
  if (keys && keys.length > MAX_STAGE_ACTS) return null;
  const reply = await replyOf(
    iframe,
    { op: "restore", keys: keys && [...keys] },
    timeoutMs ?? STAGE_ACT_TIMEOUT_MS,
  );
  const restored = reply?.restored;
  const most = keys?.length ?? MAX_STAGE_ACTS;
  return Number.isSafeInteger(restored) && (restored as number) >= 0 && (restored as number) <= most
    ? (restored as number)
    : null;
}

/** The removed elements' markup from the frame they leave, for the frame that replaces it. Studio never parses it:
 * it is an opaque string, capped, handed only to `holdPreviewStage` on that film's next load. */
export async function capturePreviewGhosts(
  iframe: HTMLIFrameElement,
  targets: readonly StageActTarget[],
  timeoutMs = STAGE_ACT_TIMEOUT_MS,
): Promise<StageActGhost[] | null> {
  if (targets.length > MAX_STAGE_ACTS) return null;
  const reply = await replyOf(iframe, { op: "capture", targets: [...targets] }, timeoutMs);
  const asked = new Set(targets.map((target) => target.key));
  if (!reply || !isMessageList(reply.ghosts, asked.size)) return null;
  const ghosts: StageActGhost[] = [];
  for (const entry of reply.ghosts) {
    if (!isFields(entry) || typeof entry.key !== "string" || !asked.has(entry.key)) return null;
    if (typeof entry.markup !== "string" || entry.markup.length > MAX_STAGE_GHOST_MARKUP)
      return null;
    ghosts.push({ key: entry.key, markup: entry.markup });
  }
  return ghosts;
}

/** The boxes a `frame` reply laid out, for keys that were drawn; a malformed entry is left out. */
function readRects(value: unknown, asked: ReadonlySet<string>): Map<string, EditingRect> {
  const rects = new Map<string, EditingRect>();
  if (!isMessageList(value, asked.size)) return rects;
  for (const entry of value) {
    if (!isFields(entry) || typeof entry.key !== "string" || !asked.has(entry.key)) continue;
    const rect = readStageRect(entry.rect);
    if (rect) rects.set(entry.key, rect);
  }
  return rects;
}

function merged(was: StageActDraw | undefined, draw: StageActDraw): StageActDraw {
  if (!was) return draw;
  const styles = was.styles || draw.styles ? { styles: { ...was.styles, ...draw.styles } } : {};
  return { ...was, ...draw, ...styles };
}

/** Draws collect per key and go once a parent frame (`flush`), with at most one `frame` request out: draws made while
 * one is out fold to the latest per key and go when its reply lands, so nothing queues behind a slow frame. `onRects`
 * gets the boxes the frame laid out after applying each request. */
export function previewStageDrawer(
  iframe: HTMLIFrameElement,
  onRects: (rects: ReadonlyMap<string, EditingRect>) => void,
) {
  let out = false;
  let stopped = false;
  let next = new Map<string, StageActDraw>();
  const send = () => {
    if (out || stopped || next.size === 0) return;
    // Past the cap, the rest wait for the next request rather than being dropped.
    const queued = [...next];
    const draws = queued.slice(0, MAX_STAGE_ACTS).map(([key, draw]) => ({ key, draw }));
    next = new Map(queued.slice(MAX_STAGE_ACTS));
    out = true;
    const asked = new Set(draws.map((one) => one.key));
    void replyOf(iframe, { op: "frame", draws }, STAGE_ACT_TIMEOUT_MS).then((reply) => {
      out = false;
      if (stopped) return;
      onRects(readRects(reply?.rects, asked));
      send();
    });
  };
  return {
    draw(key: string, draw: StageActDraw) {
      if (!stopped) next.set(key, merged(next.get(key), draw));
    },
    flush: send,
    stop() {
      stopped = true;
      next.clear();
    },
  };
}

/** The frame's deferred holds as they land, only for `keys` the parent asked to hold. */
export function onPreviewStageActReady(
  iframe: HTMLIFrameElement,
  keys: ReadonlySet<string>,
  listener: (held: StageActHeld[]) => void,
): () => void {
  return previewEditingClient(iframe).onStageActReady(({ held }) => {
    const asked = held.filter((one) => keys.has(one.key));
    if (asked.length > 0) listener(asked);
  });
}

/** The person's press, drop or key inside the frame while it holds acts. */
export function onPreviewStageInput(
  iframe: HTMLIFrameElement,
  listener: (event: StageInputEvent) => void,
): () => void {
  return previewEditingClient(iframe).onStageInput(listener);
}
