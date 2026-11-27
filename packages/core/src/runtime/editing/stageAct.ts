// Studio's stage acts inside a sealed frame: hold an element's before look, apply the parent's draws, give it back.
// The parent owns every motion and easing; the frame only borrows named properties, writes validated values and
// reports boxes, so a sealed act paints what an open one does without the parent touching the frame's document.
import { postOnPort } from "../runtimePort";
import { MAX_DRAFT_PX, MAX_ELEMENT_TEXT, type EditingRect } from "../editingElement";
import { listenFrameKeydown } from "./canvasKeys";
import {
  captureStageGhosts,
  inertStageGhost,
  MAX_STAGE_GHOST_MARKUP,
  type StageActGhost,
} from "./stageGhost";
import { locateStageKey, paintedOnStage } from "./stageMeasure";
import { rotateBy, scaleBy, translateBy } from "./transformValues";

export const MAX_STAGE_ACTS = 64;
const MAX_STAGE_FONT_PX = 4_096;
const MAX_STAGE_TURN_DEG = 3_600;
const MAX_STAGE_SCALE = 100;
/** A deferred hold stops watching for its elements after this, so a run that never ends leaves no observer. */
export const STAGE_HOLD_WATCH_MS = 30_000;
const MAX_STYLE_VALUE = 512;
const MAX_KEY = 1_024;
const MAX_INPUT_KEY = 32;

export const STAGE_ACT_STYLES = [
  "color",
  "background-color",
  "background-image",
  "font-size",
  "opacity",
  "box-shadow",
  "transform",
  "filter",
] as const;
const TRANSFORMS = ["translate", "scale", "rotate"] as const;
export const STAGE_ACT_BORROWS = [...STAGE_ACT_STYLES, ...TRANSFORMS] as const;
export type StageActStyle = (typeof STAGE_ACT_STYLES)[number];
export type StageActBorrow = (typeof STAGE_ACT_BORROWS)[number];

/** One frame of an act. `translate`, `scale` and `rotate` move the element's own values, never replace them. */
export interface StageActDraw {
  translate?: [number, number];
  scale?: number;
  rotate?: number;
  styles?: Partial<Record<StageActStyle, string>>;
  /** Graphemes of a typed act shown so far; the caret shows until all are. */
  typed?: number;
}
export interface StageActTarget {
  key: string;
  hfId: string | null;
}
/** An element held in its before look: `borrow` names every property its draws may write and its restore puts back. */
export type StageActElementHold = StageActTarget & {
  borrow: StageActBorrow[];
  draw: StageActDraw;
  typing?: { hidden: boolean };
};
/** A removed element stood back as a ghost from markup relayed out of the frame it left. */
export type StageActGhostHold = {
  key: string;
  ghost: { markup: string; box: EditingRect };
  draw: StageActDraw;
};
export type StageActHold = StageActElementHold | StageActGhostHold;
export type StageActParams =
  | { op: "hold"; acts: StageActHold[]; deferred: boolean; caretColor: string }
  | { op: "frame"; draws: { key: string; draw: StageActDraw }[] }
  | { op: "ready"; keys: string[] }
  | { op: "restore"; keys: string[] | null }
  | { op: "capture"; targets: StageActTarget[] };
export interface StageActHeld {
  key: string;
  rect: EditingRect;
  textStart: { x: number; y: number } | null;
  chars: number;
}
export interface StageActRect {
  key: string;
  rect: EditingRect;
}
export type StageActResult =
  | { op: "hold"; held: StageActHeld[] }
  | { op: "frame"; rects: StageActRect[] }
  | { op: "ready"; held: StageActHeld[] }
  | { op: "restore"; restored: number }
  | { op: "capture"; ghosts: StageActGhost[] };
export type StageActReadyEvent = { v: number; event: "stage-act-ready"; held: StageActHeld[] };
export type StageInputEvent = {
  v: number;
  event: "stage-input";
  type: (typeof STAGE_INPUTS)[number];
  key: string | null;
  metaKey: boolean;
  ctrlKey: boolean;
};
const STAGE_INPUTS = ["pointerdown", "drop", "keydown"] as const;
const STAGE_POINTER_INPUTS = ["pointerdown", "drop"] as const;

// ---- validation (both ends: the frame checks the parent's params, the parent checks the frame's replies)

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields =>
  Object.prototype.toString.call(value) === "[object Object]";
const onlyKeys = (value: Fields, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const isKey = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_KEY;
const isFiniteIn = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= max;
const list = (value: unknown, max: number): unknown[] | null =>
  Array.isArray(value) && value.length <= max ? value : null;

const COLOUR_FUNCTIONS = "rgba?|hsla?|hwb|lab|lch|oklab|oklch|color";
const COLOUR = new RegExp(
  `^(#[0-9a-f]{3,8}|[a-z]+|(${COLOUR_FUNCTIONS})\\([a-z0-9 .,%/+-]*\\))$`,
  "i",
);
// Functions a drawn value may call: colours, the spread's gradient, a turn, a drop shadow, own-value maths.
const VALUE_FUNCTIONS = new RegExp(
  `^(${COLOUR_FUNCTIONS}|radial-gradient|rotate|drop-shadow|calc)$`,
  "i",
);

/** A colour as computed styles give it, with no reference out of the frame (`url`, `var`, `attr`). */
export const isStageColour = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_STYLE_VALUE && COLOUR.test(value.trim());

function isDrawnValue(value: string): boolean {
  if (value.length > MAX_STYLE_VALUE || !/^[a-z0-9 .,%#()+\-/]*$/i.test(value)) return false;
  for (const [, name] of value.matchAll(/([a-z-]*)\(/gi))
    if (!VALUE_FUNCTIONS.test(name ?? "")) return false;
  return true;
}

const STYLE_CHECKS: Record<StageActStyle, (value: string) => boolean> = {
  color: isStageColour,
  "background-color": isStageColour,
  "background-image": (value) =>
    value === "none" || (value.startsWith("radial-gradient(") && isDrawnValue(value)),
  "font-size": (value) => {
    const px = /^(\d+(\.\d+)?)px$/.exec(value);
    return px !== null && Number(px[1]) > 0 && Number(px[1]) <= MAX_STAGE_FONT_PX;
  },
  opacity: (value) => /^\d*\.?\d+$/.test(value) && Number(value) <= 1,
  "box-shadow": isDrawnValue,
  transform: isDrawnValue,
  filter: isDrawnValue,
};

/** The table's own entry for `name`, never one inherited from Object (a field named `constructor`). */
const ownEntry = <T>(table: Record<string, T>, name: string): T | undefined =>
  Object.hasOwn(table, name) ? table[name] : undefined;

/** Every entry parsed, or null when any is not. */
const allParsed = <T>(entries: readonly (T | null)[] | undefined): T[] | null =>
  entries?.every((entry) => entry !== null) ? (entries as T[]) : null;

function parseStyles(value: unknown): StageActDraw["styles"] | null {
  if (!isFields(value)) return null;
  const valid = Object.entries(value).every(([name, css]) => {
    const check = ownEntry(STYLE_CHECKS, name);
    return check !== undefined && typeof css === "string" && check(css);
  });
  return valid ? (value as StageActDraw["styles"]) : null;
}

const DRAW_FIELDS: Record<string, (value: unknown) => unknown> = {
  translate: (value) => {
    const pair = list(value, 2);
    return pair?.length === 2 && pair.every((n) => isFiniteIn(n, MAX_DRAFT_PX)) ? pair : null;
  },
  scale: (value) => (isFiniteIn(value, MAX_STAGE_SCALE) && value >= 0 ? value : null),
  rotate: (value) => (isFiniteIn(value, MAX_STAGE_TURN_DEG) ? value : null),
  typed: (value) =>
    Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_ELEMENT_TEXT
      ? value
      : null,
  styles: parseStyles,
};

function parseDraw(value: unknown): StageActDraw | null {
  if (!isFields(value)) return null;
  const draw: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(value)) {
    if (field === undefined) continue;
    const parsed = ownEntry(DRAW_FIELDS, name)?.(field) ?? null;
    if (parsed === null) return null;
    draw[name] = parsed;
  }
  return draw as StageActDraw;
}

export function readStageRect(value: unknown): EditingRect | null {
  if (!isFields(value)) return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((n) => isFiniteIn(n, MAX_DRAFT_PX))) return null;
  return { x, y, width, height } as EditingRect;
}

const parseTarget = (value: unknown): StageActTarget | null =>
  isFields(value) &&
  onlyKeys(value, ["key", "hfId"]) &&
  isKey(value.key) &&
  (value.hfId === null || isKey(value.hfId))
    ? { key: value.key, hfId: value.hfId as string | null }
    : null;

const parseBorrow = (value: unknown): StageActBorrow[] | null => {
  const names = list(value, STAGE_ACT_BORROWS.length);
  return names?.every((name) => STAGE_ACT_BORROWS.includes(name as StageActBorrow))
    ? (names as StageActBorrow[])
    : null;
};

/** Absent is undefined; present must be `{ hidden: boolean }`. */
const parseTyping = (value: unknown): { hidden: boolean } | null | undefined => {
  if (value === undefined) return undefined;
  return isFields(value) && onlyKeys(value, ["hidden"]) && typeof value.hidden === "boolean"
    ? { hidden: value.hidden }
    : null;
};

function parseGhostHold(value: Fields): StageActGhostHold | null {
  if (!onlyKeys(value, ["key", "ghost", "draw"]) || !isKey(value.key) || !isFields(value.ghost))
    return null;
  const { markup, box } = value.ghost;
  const rect = readStageRect(box);
  const draw = parseDraw(value.draw);
  if (typeof markup !== "string" || markup.length > MAX_STAGE_GHOST_MARKUP) return null;
  return rect && draw && { key: value.key, ghost: { markup, box: rect }, draw };
}

function parseHold(value: unknown): StageActHold | null {
  if (!isFields(value)) return null;
  if ("ghost" in value) return parseGhostHold(value);
  if (!onlyKeys(value, ["key", "hfId", "borrow", "draw", "typing"])) return null;
  const target = parseTarget({ key: value.key, hfId: value.hfId });
  const borrow = parseBorrow(value.borrow);
  const draw = parseDraw(value.draw);
  const typing = parseTyping(value.typing);
  if (!target || !borrow || !draw || typing === null) return null;
  return { ...target, borrow, draw, ...(typing && { typing }) };
}

const parseFrameDraw = (entry: unknown) => {
  if (!isFields(entry) || !onlyKeys(entry, ["key", "draw"]) || !isKey(entry.key)) return null;
  const draw = parseDraw(entry.draw);
  return draw && { key: entry.key, draw };
};

const keyList = (value: unknown): string[] | null => {
  const keys = list(value, MAX_STAGE_ACTS);
  return keys?.every(isKey) ? (keys as string[]) : null;
};

const OP_PARSERS: Record<StageActParams["op"], (params: Fields) => StageActParams | null> = {
  hold: (params) => {
    const acts = allParsed(list(params.acts, MAX_STAGE_ACTS)?.map(parseHold));
    const { deferred, caretColor } = params;
    if (!onlyKeys(params, ["op", "acts", "deferred", "caretColor"]) || !acts) return null;
    if (typeof deferred !== "boolean" || !isStageColour(caretColor)) return null;
    // A key held twice would borrow its own first draw and restore that, not the element's values.
    if (new Set(acts.map((act) => act.key)).size !== acts.length) return null;
    return { op: "hold", acts, deferred, caretColor };
  },
  frame: (params) => {
    const draws = allParsed(list(params.draws, MAX_STAGE_ACTS)?.map(parseFrameDraw));
    return onlyKeys(params, ["op", "draws"]) && draws ? { op: "frame", draws } : null;
  },
  ready: (params) => {
    const keys = keyList(params.keys);
    return onlyKeys(params, ["op", "keys"]) && keys ? { op: "ready", keys } : null;
  },
  restore: (params) => {
    const keys = params.keys === null ? null : keyList(params.keys);
    if (!onlyKeys(params, ["op", "keys"]) || (keys === null && params.keys !== null)) return null;
    return { op: "restore", keys };
  },
  capture: (params) => {
    const targets = allParsed(list(params.targets, MAX_STAGE_ACTS)?.map(parseTarget));
    return onlyKeys(params, ["op", "targets"]) && targets ? { op: "capture", targets } : null;
  },
};

/** One `stage-act` request off the wire, or null: an over-cap list, a value outside its grammar, an unknown field. */
export function parseStageActParams(params: unknown): StageActParams | null {
  if (!isFields(params) || typeof params.op !== "string") return null;
  return ownEntry(OP_PARSERS, params.op)?.(params) ?? null;
}

// ---- the session: one per port, as `text-edit` keeps one

type Held = {
  info: () => StageActHeld;
  apply: (draw: StageActDraw) => void;
  restore: () => void;
};
type Session = {
  port: MessagePort;
  caretColor: string;
  held: Map<string, Held>;
  waiting: Map<string, StageActHold>;
  stop: () => void;
};
let session: Session | null = null;

const rectOf = (element: Element): EditingRect => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
};

function ownValue(element: HTMLElement, name: string): string {
  const inline = element.style.getPropertyValue(name);
  return (
    inline ||
    (element.ownerDocument.defaultView?.getComputedStyle(element).getPropertyValue(name) ?? "")
  );
}

function borrow(style: CSSStyleDeclaration, names: readonly string[]): () => void {
  const kept = names.map(
    (name) => [style.getPropertyValue(name), style.getPropertyPriority(name)] as const,
  );
  return () => names.forEach((name, i) => style.setProperty(name, ...kept[i]!));
}

function textStartOf(nodes: readonly Text[]): { x: number; y: number } | null {
  const range = nodes[0]!.ownerDocument.createRange();
  range.setStart(nodes[0]!, 0);
  range.setEnd(nodes.at(-1)!, nodes.at(-1)!.length);
  const box = range.getBoundingClientRect?.();
  return box && box.width > 0 ? { x: box.x, y: box.y + box.height / 2 } : null;
}

/** Empties the element's own text behind a hidden caret; `draw` types it back by whole graphemes. */
function typedText(element: HTMLElement, hidden: boolean, caretColor: string) {
  const nodes = [...element.childNodes].filter((node): node is Text => node.nodeType === 3);
  const full = nodes.map((node) => node.data);
  const text = full.join("");
  if (!text.trim()) return null;
  const letters = [...new Intl.Segmenter().segment(text)].map(({ segment }) => segment);
  const textStart = textStartOf(nodes);
  const show = hidden ? borrow(element.style, ["opacity"]) : () => {};
  if (hidden) element.style.setProperty("opacity", "0");
  const caret = element.ownerDocument.createElement("i");
  Object.assign(caret.style, {
    display: "inline-block",
    width: "2px",
    height: "0.9em",
    marginLeft: "2px",
    verticalAlign: "-0.08em",
    background: caretColor,
    visibility: "hidden",
  });
  for (const node of nodes) node.data = "";
  // Held empty, the unseen caret keeps it a box: the runtime's layout pass sizes a 0 px clip 100% and it stays.
  nodes[0]!.after(caret);
  return {
    letters: letters.length,
    textStart,
    type: (n: number) => {
      show();
      nodes[0]!.data = letters.slice(0, n).join("");
      caret.style.visibility = "";
      if (n < letters.length) nodes[0]!.after(caret);
      else caret.remove();
    },
    restore: () => {
      show();
      caret.remove();
      nodes.forEach((node, i) => (node.data = full[i]!));
    },
  };
}

function holdElement(
  element: HTMLElement,
  key: string,
  act: StageActElementHold,
  caretColor: string,
): Held | null {
  // Its own values and borrowed properties are read before any write, typing's included.
  const own = Object.fromEntries(TRANSFORMS.map((name) => [name, ownValue(element, name)]));
  const borrowed = new Set<string>(act.borrow);
  const giveBack = borrow(element.style, act.borrow);
  const typing = act.typing ? typedText(element, act.typing.hidden, caretColor) : null;
  if (act.typing && !typing) return null;
  const apply = (draw: StageActDraw) => {
    const write = (name: string, value: string) =>
      borrowed.has(name) && element.style.setProperty(name, value);
    if (draw.translate) write("translate", translateBy(own.translate!, ...draw.translate));
    if (draw.scale !== undefined) write("scale", scaleBy(own.scale!, draw.scale));
    if (draw.rotate !== undefined) write("rotate", rotateBy(own.rotate!, draw.rotate));
    for (const [name, value] of Object.entries(draw.styles ?? {})) write(name, value!);
    if (draw.typed !== undefined) typing?.type(draw.typed);
  };
  apply(act.draw);
  return {
    info: () => ({
      key,
      rect: rectOf(element),
      textStart: typing?.textStart ?? null,
      chars: typing?.letters ?? 0,
    }),
    apply,
    restore: () => {
      giveBack();
      typing?.restore();
    },
  };
}

function holdGhost(
  doc: Document,
  key: string,
  ghost: { markup: string; box: EditingRect },
  draw: StageActDraw,
): Held | null {
  const node = doc.body && inertStageGhost(doc, ghost.markup);
  if (!node) return null;
  Object.assign(node.style, {
    position: "fixed",
    margin: "0",
    left: `${ghost.box.x}px`,
    top: `${ghost.box.y}px`,
    translate: "none",
    pointerEvents: "none",
  });
  node.setAttribute("aria-hidden", "true");
  doc.body.appendChild(node);
  const apply = (next: StageActDraw) => {
    if (next.translate) node.style.setProperty("translate", translateBy("none", ...next.translate));
    if (next.scale !== undefined) node.style.setProperty("scale", scaleBy("none", next.scale));
    for (const [name, value] of Object.entries(next.styles ?? {}))
      node.style.setProperty(name, value!);
  };
  apply(draw);
  return {
    info: () => ({ key, rect: rectOf(node), textStart: null, chars: 0 }),
    apply,
    restore: () => node.remove(),
  };
}

/** Holds `act` now; "later" while a deferred element is not on the stage yet; null when it cannot be held. */
function tryHold(
  doc: Document,
  act: StageActHold,
  deferred: boolean,
  caretColor: string,
): Held | "later" | null {
  if ("ghost" in act) return holdGhost(doc, act.key, act.ghost, act.draw);
  const element = locateStageKey(doc, act) as HTMLElement | null;
  const onStage = element?.style && paintedOnStage(element);
  if (!onStage && deferred) return "later";
  if (!element?.style) return null;
  return holdElement(element, act.key, act, caretColor);
}

/** Gives every held element back and stops watching; the agent's dispose and a new hold call it. */
export function endStageAct(): void {
  const open = session;
  session = null;
  if (!open) return;
  open.stop();
  for (const held of open.held.values()) held.restore();
}

function holdWaiting(open: Session, doc: Document, keys?: readonly string[]): StageActHeld[] {
  const now: StageActHeld[] = [];
  for (const [key, act] of open.waiting) {
    if (keys && !keys.includes(key)) continue;
    const held = tryHold(doc, act, true, open.caretColor);
    if (held === "later") continue;
    open.waiting.delete(key);
    if (!held) continue;
    open.held.set(key, held);
    now.push(held.info());
  }
  return now;
}

/** Those of `keys` held now, already or just: asked again after a lost reply, it still reports them. */
function readyNow(open: Session, doc: Document, keys: readonly string[]): StageActHeld[] {
  const already = keys.flatMap((key) => {
    const held = open.held.get(key);
    return held ? [held.info()] : [];
  });
  return [...already, ...holdWaiting(open, doc, keys)];
}

function start(
  doc: Document,
  params: Extract<StageActParams, { op: "hold" }>,
  port: MessagePort,
  version: number,
) {
  endStageAct();
  const view = doc.defaultView;
  const open: Session = {
    port,
    caretColor: params.caretColor,
    held: new Map(),
    waiting: new Map(),
    stop: () => {},
  };
  session = open;
  const held: StageActHeld[] = [];
  for (const act of params.acts) {
    const one = tryHold(doc, act, params.deferred, params.caretColor);
    if (one === "later") open.waiting.set(act.key, act);
    else if (one) {
      open.held.set(act.key, one);
      held.push(one.info());
    }
  }
  // The person's press, drop or key in the frame: the parent decides whether it edits and ends the run.
  const onInput = (event: Event) => {
    const key = event instanceof KeyboardEvent ? event.key.slice(0, MAX_INPUT_KEY) : null;
    const { metaKey = false, ctrlKey = false } = event as KeyboardEvent;
    postOnPort(port, { v: version, event: "stage-input", type: event.type, key, metaKey, ctrlKey });
  };
  const stopInputs = view ? listenStageInputs(view, onInput) : () => {};
  // Observer callbacks run before the frame paints: an element its seek reveals is held before it shows.
  const watch =
    open.waiting.size > 0 && view
      ? new view.MutationObserver(() => {
          const now = holdWaiting(open, doc);
          if (now.length > 0) postOnPort(port, { v: version, event: "stage-act-ready", held: now });
          if (open.waiting.size === 0) watch?.disconnect();
        })
      : null;
  watch?.observe(doc.documentElement, { attributes: true, childList: true, subtree: true });
  const cap = watch && view ? view.setTimeout(() => watch.disconnect(), STAGE_HOLD_WATCH_MS) : 0;
  open.stop = () => {
    watch?.disconnect();
    if (cap) view?.clearTimeout(cap);
    stopInputs();
  };
  return { op: "hold" as const, held };
}

function listenStageInputs(view: Window, onInput: (event: Event) => void): () => void {
  for (const type of STAGE_POINTER_INPUTS) view.addEventListener(type, onInput, true);
  const stopKeys = listenFrameKeydown(view, onInput);
  return () => {
    for (const type of STAGE_POINTER_INPUTS) view.removeEventListener(type, onInput, true);
    stopKeys();
  };
}

export function stageAct(
  params: StageActParams,
  port: MessagePort,
  version: number,
  doc: Document = document,
): StageActResult {
  if (params.op === "capture")
    return { op: "capture", ghosts: captureStageGhosts(doc, params.targets) };
  if (params.op === "hold") return start(doc, params, port, version);
  const open = session?.port === port ? session : null;
  if (params.op === "frame") {
    const drawn = params.draws.flatMap(({ key, draw }) => {
      const held = open?.held.get(key);
      held?.apply(draw);
      return held ? [held] : [];
    });
    // Every write lands before any box is read, so the frame lays out once for the whole draw.
    return {
      op: "frame",
      rects: drawn.map((held) => {
        const { key, rect } = held.info();
        return { key, rect };
      }),
    };
  }
  if (params.op === "ready")
    return { op: "ready", held: open ? readyNow(open, doc, params.keys) : [] };
  if (!open) return { op: "restore", restored: 0 };
  if (params.keys === null) {
    const restored = open.held.size;
    endStageAct();
    return { op: "restore", restored };
  }
  let restored = 0;
  for (const key of params.keys) {
    open.waiting.delete(key);
    const held = open.held.get(key);
    if (!held) continue;
    open.held.delete(key);
    held.restore();
    restored += 1;
  }
  if (open.held.size === 0 && open.waiting.size === 0) endStageAct();
  return { op: "restore", restored };
}

// ---- the parent's reads of what the frame pushes

const readTextStart = (value: unknown): { x: number; y: number } | null | undefined => {
  if (value === null) return null;
  if (!isFields(value) || !isFiniteIn(value.x, MAX_DRAFT_PX) || !isFiniteIn(value.y, MAX_DRAFT_PX))
    return undefined;
  return { x: value.x, y: value.y };
};

export function readStageActHeld(value: unknown): StageActHeld | null {
  if (!isFields(value) || !isKey(value.key)) return null;
  const rect = readStageRect(value.rect);
  const textStart = readTextStart(value.textStart);
  const { chars } = value;
  if (!rect || textStart === undefined || !Number.isSafeInteger(chars)) return null;
  if ((chars as number) < 0 || (chars as number) > MAX_ELEMENT_TEXT) return null;
  return { key: value.key, rect, textStart, chars: chars as number };
}

export function stageActReadyEvent(data: unknown, version: number): StageActReadyEvent | null {
  if (!isFields(data) || data.v !== version || data.event !== "stage-act-ready") return null;
  const entries = list(data.held, MAX_STAGE_ACTS);
  const held = entries?.map(readStageActHeld);
  if (!held?.every((one): one is StageActHeld => one !== null)) return null;
  return { v: version, event: "stage-act-ready", held };
}

export function stageInputEvent(data: unknown, version: number): StageInputEvent | null {
  if (!isFields(data) || data.v !== version || data.event !== "stage-input") return null;
  const { type, key, metaKey, ctrlKey } = data;
  if (!STAGE_INPUTS.includes(type as StageInputEvent["type"])) return null;
  if (key !== null && !(typeof key === "string" && key.length <= MAX_INPUT_KEY)) return null;
  if (typeof metaKey !== "boolean" || typeof ctrlKey !== "boolean") return null;
  return {
    v: version,
    event: "stage-input",
    type: type as StageInputEvent["type"],
    key,
    metaKey,
    ctrlKey,
  };
}
