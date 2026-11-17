// `caption-transform`: reads and moves caption words, on a wrapper so the word's own tweens keep running.
import { MAX_DESCRIBE_HANDLES, type EditingRect } from "../editingElement";
import { captionWordSpans, isCaptionIndex, isRecord } from "./captionWords";

export interface CaptionTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/** `set` writes those parts and keeps the rest; without it the word is only read. */
export interface CaptionTransformEntry {
  group: number;
  word: number;
  set?: Partial<CaptionTransform>;
}
export type CaptionTransformParams = { entries: CaptionTransformEntry[] };

/** The wrapper's transform after any write, and the word's box; null for a word the frame lacks. */
export type CaptionWordState = { transform: CaptionTransform; rect: EditingRect } | null;

const REST: CaptionTransform = { x: 0, y: 0, scale: 1, rotation: 0 };
const PARTS = new Set(Object.keys(REST));
/** Largest |x|, |y|, scale or rotation a caption word's transform may hold, in either direction. */
export const MAX_CAPTION_TRANSFORM = 100_000;

const isBounded = (value: unknown): value is number =>
  Number.isFinite(value) && Math.abs(value as number) <= MAX_CAPTION_TRANSFORM;

function transformPart(set: unknown): Partial<CaptionTransform> | null {
  if (!isRecord(set)) return null;
  const valid = Object.entries(set).every(([key, v]) => PARTS.has(key) && isBounded(v));
  return valid ? (set as Partial<CaptionTransform>) : null;
}

function entry(value: unknown): CaptionTransformEntry | null {
  if (!isRecord(value)) return null;
  const { group, word, set, ...rest } = value;
  if (Object.keys(rest).length || !isCaptionIndex(group) || !isCaptionIndex(word)) return null;
  if (!("set" in value)) return { group, word };
  const part = transformPart(set);
  return part ? { group, word, set: part } : null;
}

export function captionTransformParams(params: unknown): CaptionTransformParams | null {
  if (!isRecord(params) || Object.keys(params).join() !== "entries") return null;
  const { entries } = params;
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_DESCRIBE_HANDLES)
    return null;
  const parsed = entries.map(entry);
  return parsed.includes(null) ? null : { entries: parsed as CaptionTransformEntry[] };
}

type Gsap = {
  getProperty?: (el: Element, prop: string) => number;
  set?: (el: Element, props: Record<string, number>) => void;
};
const frameGsap = () => (window as unknown as { gsap?: Gsap }).gsap;

const CSS_PARTS: Array<[keyof CaptionTransform, RegExp]> = [
  ["x", /translate\(([^,]+)px,\s*[^)]+px\)/],
  ["y", /translate\([^,]+px,\s*([^)]+)px\)/],
  ["scale", /scale\(([^)]+)\)/],
  ["rotation", /rotate\(([^)]+)deg\)/],
];

/** GSAP keeps transforms in its own cache, so read through it when the page has it. */
function readTransform(el: HTMLElement): CaptionTransform {
  const gsap = frameGsap();
  const read = { ...REST };
  for (const [part, pattern] of CSS_PARTS) {
    if (gsap?.getProperty) read[part] = gsap.getProperty(el, part) || REST[part];
    else {
      const match = (el.style.transform || "").match(pattern);
      if (match) read[part] = parseFloat(match[1]!);
    }
  }
  return read;
}

function writeTransform(el: HTMLElement, { x, y, scale, rotation }: CaptionTransform): void {
  const gsap = frameGsap();
  if (gsap?.set) gsap.set(el, { x, y, scale, rotation });
  else
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rotation.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
}

function wrapperOf(word: HTMLElement): HTMLElement {
  if (word.dataset.captionWrapper === "true") return word;
  const parent = word.parentElement;
  if (parent?.dataset.captionWrapper === "true") return parent;
  const wrapper = document.createElement("span");
  wrapper.style.display = "inline-block";
  wrapper.dataset.captionWrapper = "true";
  word.parentNode?.insertBefore(wrapper, word);
  wrapper.appendChild(word);
  return wrapper;
}

function wordAt(group: number, word: number): HTMLElement | null {
  const el = document.querySelectorAll<HTMLElement>(".caption-group")[group];
  return el ? (captionWordSpans(el)[word] ?? null) : null;
}

export function captionTransform({ entries }: CaptionTransformParams): {
  words: CaptionWordState[];
} {
  const words = entries.map(({ group, word, set }) => {
    const el = wordAt(group, word);
    if (!el) return null;
    const wrapper = wrapperOf(el);
    if (set) writeTransform(wrapper, { ...readTransform(wrapper), ...set });
    const { left, top, width, height } = el.getBoundingClientRect();
    return { transform: readTransform(wrapper), rect: { x: left, y: top, width, height } };
  });
  return { words };
}
