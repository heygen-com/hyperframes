// `caption-transform`: reads and moves caption words, on a wrapper so the word's own tweens keep running.
import { isPlainRecord, MAX_DRAFT_PX } from "../editingPort";
import { MAX_DESCRIBE_HANDLES, type EditingRect } from "../editingElement";
import { captionWordSpans, isCaptionIndex } from "./captionWords";

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

const TRANSFORM_KEYS = new Set(["x", "y", "scale", "rotation"]);

const isBounded = (value: unknown): value is number =>
  Number.isFinite(value) && Math.abs(value as number) <= MAX_DRAFT_PX;

function transformPart(set: unknown): Partial<CaptionTransform> | null {
  if (!isPlainRecord(set)) return null;
  const valid = Object.entries(set).every(([key, v]) => TRANSFORM_KEYS.has(key) && isBounded(v));
  return valid ? (set as Partial<CaptionTransform>) : null;
}

function entry(value: unknown): CaptionTransformEntry | null {
  if (!isPlainRecord(value)) return null;
  const { group, word, set, ...rest } = value;
  if (Object.keys(rest).length || !isCaptionIndex(group) || !isCaptionIndex(word)) return null;
  if (!("set" in value)) return { group, word };
  const part = transformPart(set);
  return part ? { group, word, set: part } : null;
}

export function captionTransformParams(params: unknown): CaptionTransformParams | null {
  if (!isPlainRecord(params) || Object.keys(params).join() !== "entries") return null;
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

/** GSAP keeps transforms in its own cache, so read through it when the page has it. */
function readTransform(el: HTMLElement): CaptionTransform {
  const gsap = frameGsap();
  if (gsap?.getProperty) {
    return {
      x: gsap.getProperty(el, "x") || 0,
      y: gsap.getProperty(el, "y") || 0,
      scale: gsap.getProperty(el, "scale") || 1,
      rotation: gsap.getProperty(el, "rotation") || 0,
    };
  }
  const t = el.style.transform || "";
  const scale = t.match(/scale\(([^)]+)\)/);
  const rotation = t.match(/rotate\(([^)]+)deg\)/);
  const translate = t.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
  return {
    x: translate ? parseFloat(translate[1]!) : 0,
    y: translate ? parseFloat(translate[2]!) : 0,
    scale: scale ? parseFloat(scale[1]!) : 1,
    rotation: rotation ? parseFloat(rotation[1]!) : 0,
  };
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
