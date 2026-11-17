// `caption-words`: the caption editor's word boxes, read where the words live.
import { MAX_QUERY_MATCHES, type EditingRect } from "../editingElement";

const MAX_CAPTION_WORDS = 100_000;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";

/** Word `word` of the `group`-th `.caption-group`, both counted from 0. */
export interface CaptionWordBox {
  group: number;
  word: number;
  /** `getBoundingClientRect()` of the word, in the frame's CSS pixels. */
  rect: EditingRect;
}

/** `words[i]` is how many words Studio's model has in the i-th `.caption-group`. */
export type CaptionWordsParams = { words: number[] };

export const isCaptionIndex = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < MAX_CAPTION_WORDS;

export function captionWordsParams(params: unknown): CaptionWordsParams | null {
  if (!isRecord(params) || Object.keys(params).join() !== "words") return null;
  const { words } = params;
  if (!Array.isArray(words) || words.length > MAX_CAPTION_WORDS) return null;
  return words.every(isCaptionIndex) ? { words } : null;
}

/** A group's word spans in order: a wrapped word is the span inside its wrapper. */
export function captionWordSpans(group: HTMLElement): HTMLElement[] {
  const spans: HTMLElement[] = [];
  for (const child of group.children) {
    const el = child as HTMLElement;
    if (el.dataset.captionWrapper === "true") {
      const inner = el.querySelector<HTMLElement>(":scope > span");
      if (inner) spans.push(inner);
    } else if (el.tagName === "SPAN") {
      spans.push(el);
    }
  }
  return spans;
}

function splitIntoSpans(text: string, replace: (fragment: DocumentFragment) => void) {
  const fragment = document.createDocumentFragment();
  const spans = text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const span = document.createElement("span");
      span.textContent = word + " ";
      span.style.display = "inline";
      return fragment.appendChild(span);
    });
  replace(fragment);
  return spans;
}

/** A group written as plain text becomes one span per word, so each word can be picked. */
function splitGroupText(group: HTMLElement): HTMLElement[] {
  const text = group.childNodes[0];
  if (text?.nodeType === Node.TEXT_NODE) {
    return splitIntoSpans(text.textContent || "", (f) => group.replaceChild(f, text));
  }
  const single = group.querySelector<HTMLElement>(":scope > span");
  if (!single?.textContent?.trim()) return [];
  return splitIntoSpans(single.textContent, (f) => single.replaceWith(f));
}

/** Boxes of the words in visible groups, up to MAX_QUERY_MATCHES. */
export function captionWords({ words }: CaptionWordsParams): { boxes: CaptionWordBox[] } {
  const groups = document.querySelectorAll<HTMLElement>(".caption-group");
  const boxes: CaptionWordBox[] = [];
  words.forEach((count, group) => {
    const el = groups[group];
    if (!el) return;
    const computed = window.getComputedStyle(el);
    if (parseFloat(computed.opacity) <= 0.01 || computed.visibility === "hidden") return;
    let spans = captionWordSpans(el);
    if (spans.length === 0 && el.textContent?.trim()) spans = splitGroupText(el);
    for (let word = 0; word < Math.min(count, spans.length); word++) {
      if (boxes.length >= MAX_QUERY_MATCHES) return;
      const { left, top, width, height } = spans[word]!.getBoundingClientRect();
      boxes.push({ group, word, rect: { x: left, y: top, width, height } });
    }
  });
  return { boxes };
}
