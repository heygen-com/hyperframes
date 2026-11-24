/**
 * Gesture drafts for the editing channel. A parent that cannot script the frame draws a drag or a
 * resize here, on the element's inline style, so the preview moves with the pointer. What the
 * element had before its first draft is kept until the parent ends the draft or the frame loads again.
 */
import { redrawGsapTimelineAt, seekGsapTimeline } from "./adapters/gsap";
import { isStylableElement, type StylableElement as Styled } from "./domRealm";
import { elementForHandle } from "./editingHandles";
import type { EditingDraftEnd, EditingDraftReply } from "./editingDraftEnd";
import type { EditingDraft, EditingDraftProps, EditingDraftRotate } from "./editingPort";
import { revealClip } from "./clipReveal";
import type { RuntimeTimelineLike } from "./types";

export const SIZE_PROPERTIES = [
  "box-sizing",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
] as const;
const DRAWN = ["translate", "rotate", "transform", ...SIZE_PROPERTIES] as const;

interface Before {
  draft: number;
  inline: Array<[name: string, value: string, priority: string]>;
  /** The computed translate, split into its axes with each % as px, that a draft's translate adds to. */
  translate: string[];
  /** GSAP's rotation before the first GSAP turn drawn, to put back on "restore". */
  gsapRotation?: number;
  gsapPosition?: { x: number; y: number };
  drewTransform?: boolean;
  propsSet?: string[];
  putMarkBack?: () => void;
}

type Gsap = {
  getProperty?: (el: Element, prop: string) => unknown;
  set?: (el: Element, props: Record<string, number | string>) => void;
};
const frameGsap = () => (window as unknown as { gsap?: Gsap }).gsap;

/** The film's own timeline, as the unsealed recorder finds it: Studio's `__proxied` mark is no timeline. */
function rootTimeline(): RuntimeTimelineLike | null {
  const timelines = (window as unknown as { __timelines?: Record<string, RuntimeTimelineLike> })
    .__timelines;
  const found = Object.entries(timelines ?? {}).find(
    ([key, value]) => key !== "__proxied" && typeof value?.seek === "function",
  );
  return found?.[1] ?? null;
}

const before = new WeakMap<Element, Before>();
const liveDrafts = new Map<Styled, EditingDraft>();
let lastDraft = 0;

/** "calc(50% + 2px) 4px" as its top-level parts. */
function axes(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let part = "";
  for (const char of value.trim()) {
    depth += char === "(" ? 1 : char === ")" ? -1 : 0;
    if (/\s/.test(char) && depth === 0) {
      if (part) parts.push(part);
      part = "";
    } else part += char;
  }
  if (part) parts.push(part);
  return parts;
}

/** The side a translate's % takes a share of: the box `transform-box` names. */
function percentSide(computed: CSSStyleDeclaration, size: "width" | "height"): number {
  const [a, b] = size === "width" ? ["left", "right"] : ["top", "bottom"];
  const n = (name: string) => Number.parseFloat(computed.getPropertyValue(name)) || 0;
  const pad =
    n(`padding-${a}`) + n(`padding-${b}`) + n(`border-${a}-width`) + n(`border-${b}-width`);
  const content = n(size) - (computed.getPropertyValue("box-sizing") === "border-box" ? pad : 0);
  const box = computed.getPropertyValue("transform-box");
  return box === "content-box" || box === "fill-box" ? content : content + pad;
}

/** Each % as the px it is now, so a resize drawn with it does not move the element again. */
function percentAsPx(axis: string, side: number): string {
  return axis.replace(
    /(-?\d*\.?\d+(?:e[-+]?\d+)?)%/gi,
    (_, n: string) => `${(Number(n) * side) / 100}px`,
  );
}

export function computedTranslateAxes(element: Styled): string[] {
  const computed = getComputedStyle(element);
  const translate = computed.getPropertyValue("translate");
  if (!translate || translate === "none") return [];
  const sides = [percentSide(computed, "width"), percentSide(computed, "height")];
  return axes(translate).map((axis, i) => (i < 2 ? percentAsPx(axis, sides[i]!) : axis));
}

function beforeOf(element: Styled): Before {
  let saved = before.get(element);
  if (!saved) {
    const { style } = element;
    saved = {
      draft: ++lastDraft,
      inline: DRAWN.map((name) => [
        name,
        style.getPropertyValue(name),
        style.getPropertyPriority(name),
      ]),
      translate: computedTranslateAxes(element),
    };
    before.set(element, saved);
  }
  return saved;
}

function restore(element: Styled, names: readonly string[]): void {
  const saved = before.get(element);
  for (const [name, value, priority] of saved?.inline ?? []) {
    if (!names.includes(name) || (name === "transform" && !saved?.drewTransform)) continue;
    if (value) element.style.setProperty(name, value, priority);
    else element.style.removeProperty(name);
  }
}

export function movedTranslate(
  [x = "0px", y = "0px", z]: string[],
  offset: { x: number; y: number },
) {
  return `calc(${x} + ${offset.x}px) calc(${y} + ${offset.y}px)${z ? ` ${z}` : ""}`;
}

type DraftTranslate = NonNullable<Extract<EditingDraft, { translate: unknown }>["translate"]>;

function drawTranslate(element: Styled, offset: DraftTranslate): void {
  const saved = beforeOf(element);
  if (offset.route !== "gsap")
    return void element.style.setProperty("translate", movedTranslate(saved.translate, offset));
  const gsap = frameGsap();
  const read = (axis: string) => Number(gsap?.getProperty?.(element, axis)) || 0;
  saved.gsapPosition ??= { x: read("x"), y: read("y") };
  element.style.setProperty("translate", "none");
  gsap?.set?.(element, { x: offset.x, y: offset.y });
}

export function rebaseDrawnPosition(element: Element, props: Record<string, unknown>): void {
  const position = before.get(element)?.gsapPosition;
  for (const axis of ["x", "y"] as const) {
    const value = props[axis];
    if (position && typeof value === "number" && Number.isFinite(value)) position[axis] = value;
  }
}

function restoreGsapPosition(element: Styled): void {
  const { gsapPosition } = before.get(element) ?? {};
  if (gsapPosition) frameGsap()?.set?.(element, { ...gsapPosition });
}

function redrawTimelines(): void {
  const timelines = Object.values(
    (window as { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines ?? {},
  );
  for (const timeline of timelines) {
    const time = timeline.totalTime?.();
    if (typeof time !== "number") continue;
    seekGsapTimeline(timeline, 0, true);
    seekGsapTimeline(timeline, time, true);
  }
}

export function writeDrawnSize(
  style: CSSStyleDeclaration,
  size: { width: number; height: number },
): void {
  style.setProperty("box-sizing", "border-box");
  style.setProperty("width", `${size.width}px`);
  style.setProperty("height", `${size.height}px`);
  for (const name of ["min-width", "min-height"]) style.setProperty(name, "0px");
  for (const name of ["max-width", "max-height"]) style.setProperty(name, "none");
}

function drawSize(element: Styled, size: { width: number; height: number }): void {
  beforeOf(element);
  writeDrawnSize(element.style, size);
}

function restoreGsapRotation(element: Styled): void {
  const rotation = before.get(element)?.gsapRotation;
  if (rotation !== undefined) frameGsap()?.set?.(element, { rotation });
}

function drawRotate(element: Styled, rotate: EditingDraftRotate | null): void {
  const saved = beforeOf(element);
  if (!rotate) {
    restore(element, ["rotate", "transform"]);
    saved.drewTransform = false;
    return restoreGsapRotation(element);
  }
  if (rotate.route === "css") return void element.style.setProperty("rotate", `${rotate.angle}deg`);
  if (rotate.route === "transform") {
    saved.drewTransform = true;
    return void element.style.setProperty("transform", rotate.value);
  }
  const gsap = frameGsap();
  saved.gsapRotation ??= Number(gsap?.getProperty?.(element, "rotation")) || 0;
  element.style.setProperty("rotate", "none");
  gsap?.set?.(element, { rotation: rotate.angle });
}

function drawProps(element: Styled, values: EditingDraftProps["values"]): void {
  const saved = beforeOf(element);
  element.style.setProperty("translate", "none");
  frameGsap()?.set?.(element, { ...values });
  saved.putMarkBack ??= revealClip(element);
  saved.propsSet = [...new Set([...(saved.propsSet ?? []), ...Object.keys(values)])];
}

function clearProps(element: Styled, saved: Before): void {
  restore(element, DRAWN);
  saved.putMarkBack?.();
  if (saved.propsSet?.length) frameGsap()?.set?.(element, { clearProps: saved.propsSet.join(",") });
  const timeline = rootTimeline();
  if (!timeline) return;
  redrawGsapTimelineAt(timeline, timeline.time());
  putLiveDraftsBack();
}

function end(element: Styled, ending: EditingDraftEnd): boolean {
  const saved = before.get(element);
  if (!saved || ("draft" in ending && ending.draft !== saved.draft)) return false;
  liveDrafts.delete(element);
  if (ending.end === "clear") clearProps(element, saved);
  if (ending.end === "restore") {
    restore(element, DRAWN);
    restoreGsapPosition(element);
    restoreGsapRotation(element);
  }
  if (ending.end === "keep-size") restore(element, ["translate"]);
  before.delete(element);
  return ending.end === "restore";
}

type LiveDraft = Exclude<EditingDraft, { end: unknown }>;

function carriedRotate(last: LiveDraft, draft: LiveDraft) {
  return !("rotate" in draft) && "rotate" in last ? { rotate: last.rotate } : {};
}

function mergedProps(last: LiveDraft, draft: LiveDraft) {
  if (!last.props || !draft.props) return {};
  return { props: { ...draft.props, values: { ...last.props.values, ...draft.props.values } } };
}

function liveDraftOf(last: EditingDraft | undefined, draft: EditingDraft): EditingDraft {
  if (!last || "end" in last || "end" in draft) return draft;
  return { ...draft, ...carriedRotate(last, draft), ...mergedProps(last, draft) };
}

function apply(element: Styled, draft: EditingDraft): boolean {
  if ("end" in draft) return end(element, draft);
  liveDrafts.set(element, liveDraftOf(liveDrafts.get(element), draft));
  if ("rotate" in draft) drawRotate(element, draft.rotate ?? null);
  if (draft.translate) drawTranslate(element, draft.translate);
  else restore(element, ["translate"]);
  if (draft.size) drawSize(element, draft.size);
  else restore(element, SIZE_PROPERTIES);
  if (draft.props) {
    rootTimeline()?.seek(draft.props.seconds);
    drawProps(element, draft.props.values);
  }
  return false;
}

/** Draws only the parts a live draft carries, so a replay never resets what it leaves out. */
function redrawOwned(element: Styled, draft: LiveDraft): void {
  if ("rotate" in draft && draft.rotate) drawRotate(element, draft.rotate);
  if (draft.translate) drawTranslate(element, draft.translate);
  if (draft.size) drawSize(element, draft.size);
  if (draft.props) drawProps(element, draft.props.values);
}

function putLiveDraftsBack(): void {
  for (const [element, draft] of liveDrafts) {
    if (element.isConnected && !("end" in draft)) redrawOwned(element, draft);
    else liveDrafts.delete(element);
  }
}

function redrawKeepingLiveDrafts(): void {
  redrawTimelines();
  putLiveDraftsBack();
}

/** Applies each draft in order; one for an element this load no longer has is skipped. */
export function drawDrafts(drafts: readonly EditingDraft[]): EditingDraftReply {
  let drawn = 0;
  let restored = false;
  const numbers: Record<string, number> = {};
  for (const draft of drafts) {
    const element = elementForHandle(draft.handle);
    if (!isStylableElement(element)) continue;
    restored = apply(element, draft) || restored;
    drawn++;
    const saved = before.get(element);
    if (saved) numbers[draft.handle] = saved.draft;
  }
  if (restored) redrawKeepingLiveDrafts();
  return { drawn, drafts: numbers };
}
