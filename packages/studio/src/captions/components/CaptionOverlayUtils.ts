// DOM helpers for CaptionOverlay — word box reading, transform I/O, wrapper management
import {
  isPlainRecord,
  MAX_DESCRIBE_HANDLES,
  type EditingParams,
} from "@hyperframes/core/runtime/editing-port";
import { previewFrameOpaque, previewRequest } from "../../player/lib/previewChannel";

export interface WordBox {
  segmentId: string;
  groupId: string;
  groupIndex: number;
  wordIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function readWordBoxes(
  iframe: HTMLIFrameElement,
  model: {
    groupOrder: string[];
    groups: Map<string, { segmentIds: string[] }>;
  },
  overlayEl: HTMLElement,
): WordBox[] {
  let doc: Document | null = null;
  let win: Window | null = null;
  try {
    doc = iframe.contentDocument;
    win = iframe.contentWindow;
  } catch {
    return [];
  }
  if (!doc || !win) return [];

  const iframeDisplayRect = iframe.getBoundingClientRect();
  const overlayRect = overlayEl.getBoundingClientRect();
  const nativeW = parseFloat(iframe.style.width) || iframeDisplayRect.width;
  const cssScale = iframeDisplayRect.width / nativeW;
  const offsetX = iframeDisplayRect.left - overlayRect.left;
  const offsetY = iframeDisplayRect.top - overlayRect.top;

  const groupEls = doc.querySelectorAll<HTMLElement>(".caption-group");
  const boxes: WordBox[] = [];

  for (let gi = 0; gi < model.groupOrder.length; gi++) {
    const groupId = model.groupOrder[gi];
    const group = model.groups.get(groupId);
    if (!group) continue;
    const groupEl = groupEls[gi] as HTMLElement | undefined;
    if (!groupEl) continue;
    const computed = win.getComputedStyle(groupEl);
    if (parseFloat(computed.opacity) <= 0.01 || computed.visibility === "hidden") continue;
    const resolvedWordEls: HTMLElement[] = [];
    for (const child of groupEl.children) {
      const c = child as HTMLElement;
      if (c.dataset.captionWrapper === "true") {
        const inner = c.querySelector<HTMLElement>(":scope > span");
        if (inner) resolvedWordEls.push(inner);
      } else if (c.tagName === "SPAN") {
        resolvedWordEls.push(c);
      }
    }
    if (resolvedWordEls.length === 0 && groupEl.textContent?.trim()) {
      const textNode = groupEl.childNodes[0];
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        const words = (textNode.textContent || "").split(/\s+/).filter(Boolean);
        const frag = doc.createDocumentFragment();
        for (const word of words) {
          const span = doc.createElement("span");
          span.textContent = word + " ";
          span.style.display = "inline";
          frag.appendChild(span);
          resolvedWordEls.push(span);
        }
        groupEl.replaceChild(frag, textNode);
      } else {
        const singleSpan = groupEl.querySelector<HTMLElement>(":scope > span");
        if (singleSpan && singleSpan.textContent?.trim()) {
          const words = singleSpan.textContent.split(/\s+/).filter(Boolean);
          const frag = doc.createDocumentFragment();
          for (const word of words) {
            const span = doc.createElement("span");
            span.textContent = word + " ";
            span.style.display = "inline";
            frag.appendChild(span);
            resolvedWordEls.push(span);
          }
          singleSpan.replaceWith(frag);
        }
      }
    }
    for (let wi = 0; wi < group.segmentIds.length; wi++) {
      const segId = group.segmentIds[wi];
      const wordEl = resolvedWordEls[wi] as HTMLElement | undefined;
      if (!wordEl) continue;
      const rect = wordEl.getBoundingClientRect();
      boxes.push({
        segmentId: segId,
        groupId,
        groupIndex: gi,
        wordIndex: wi,
        x: rect.left * cssScale + offsetX,
        y: rect.top * cssScale + offsetY,
        width: rect.width * cssScale,
        height: rect.height * cssScale,
      });
    }
  }
  return boxes;
}

export function getWordEl(
  iframe: HTMLIFrameElement,
  groupIndex: number,
  wordIndex: number,
): HTMLElement | null {
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return null;
  }
  if (!doc) return null;
  const groupEl = doc.querySelectorAll<HTMLElement>(".caption-group")[groupIndex];
  if (!groupEl) return null;
  const wordEls: HTMLElement[] = [];
  for (const child of groupEl.children) {
    const el = child as HTMLElement;
    if (el.dataset.captionWrapper === "true") {
      const inner = el.querySelector<HTMLElement>(":scope > span");
      if (inner) wordEls.push(inner);
    } else if (el.tagName === "SPAN") {
      wordEls.push(el);
    }
  }
  return wordEls[wordIndex] ?? null;
}

/**
 * Read GSAP's internal transform state for an element.
 * GSAP stores transforms in its own cache, not in el.style.transform.
 */
export function readGsapTransform(
  el: HTMLElement,
  iframeWin: Window,
): { x: number; y: number; scale: number; rotation: number } {
  const gsap = (
    iframeWin as unknown as { gsap?: { getProperty?: (el: HTMLElement, prop: string) => number } }
  ).gsap;
  if (gsap && gsap.getProperty) {
    return {
      x: gsap.getProperty(el, "x") || 0,
      y: gsap.getProperty(el, "y") || 0,
      scale: gsap.getProperty(el, "scale") || 1,
      rotation: gsap.getProperty(el, "rotation") || 0,
    };
  }
  const t = el.style.transform || "";
  const scaleMatch = t.match(/scale\(([^)]+)\)/);
  const rotMatch = t.match(/rotate\(([^)]+)deg\)/);
  const txyMatch = t.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
  return {
    x: txyMatch ? parseFloat(txyMatch[1]) : 0,
    y: txyMatch ? parseFloat(txyMatch[2]) : 0,
    scale: scaleMatch ? parseFloat(scaleMatch[1]) : 1,
    rotation: rotMatch ? parseFloat(rotMatch[1]) : 0,
  };
}

/**
 * Get or create an inline-block wrapper span around a word element.
 * Transforms are applied to the wrapper so the word's GSAP animations are preserved.
 */
export function getOrCreateWrapper(el: HTMLElement): HTMLElement {
  if (el.dataset.captionWrapper === "true") return el;
  const parent = el.parentElement;
  if (parent && parent.dataset.captionWrapper === "true") return parent;
  const doc = el.ownerDocument;
  const wrapper = doc.createElement("span");
  wrapper.style.display = "inline-block";
  wrapper.dataset.captionWrapper = "true";
  el.parentNode?.insertBefore(wrapper, el);
  wrapper.appendChild(el);
  return wrapper;
}

/**
 * Write transform values to a wrapper span around the word element.
 */
export function writeTransform(
  el: HTMLElement,
  iframeWin: Window,
  x: number,
  y: number,
  scale: number,
  rotation: number,
) {
  const wrapper = getOrCreateWrapper(el);
  const gsap = (
    iframeWin as unknown as {
      gsap?: { set?: (el: HTMLElement, props: Record<string, number>) => void };
    }
  ).gsap;
  if (gsap && gsap.set) {
    gsap.set(wrapper, { x, y, scale, rotation });
  } else {
    wrapper.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rotation.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
  }
}

// ---------------------------------------------------------------------------
// Iframe registry — lets non-component code (undo/redo in useAppHotkeys)
// reapply a restored model's transforms to the live preview.
// ---------------------------------------------------------------------------

let registeredIframe: React.RefObject<HTMLIFrameElement | null> | null = null;

export function registerCaptionIframe(ref: React.RefObject<HTMLIFrameElement | null>): () => void {
  registeredIframe = ref;
  return () => {
    if (registeredIframe === ref) registeredIframe = null;
  };
}

/**
 * True when the caption preview iframe is mounted AND visible. The caption
 * store's isEditMode stays true while the preview is merely hidden, so hotkeys must not
 * route ⌘Z to the caption stack unless the user can see the captions the undo would change.
 */
export function isCaptionPreviewVisible(): boolean {
  const iframe = registeredIframe?.current;
  return Boolean(iframe?.isConnected && iframe.offsetParent !== null);
}

/** Reapply every segment's transform from a (restored) model to the preview DOM. */
export function applyCaptionModelToIframe(model: {
  groupOrder: string[];
  groups: Map<string, { segmentIds: string[] }>;
  segments: Map<string, { style: { x?: number; y?: number; scaleX?: number; rotation?: number } }>;
}): void {
  const iframe = registeredIframe?.current;
  if (!iframe) return;
  if (previewFrameOpaque(iframe)) {
    model.groupOrder.forEach((groupId, group) =>
      model.groups.get(groupId)?.segmentIds.forEach((segmentId, word) => {
        const s = model.segments.get(segmentId)?.style;
        if (!s) return;
        const set = { x: s.x ?? 0, y: s.y ?? 0, scale: s.scaleX ?? 1, rotation: s.rotation ?? 0 };
        void frameWordTransform(iframe, { group, word, set });
      }),
    );
    return;
  }
  let win: Window | null = null;
  try {
    win = iframe.contentWindow;
  } catch {
    return;
  }
  if (!win) return;
  for (let gi = 0; gi < model.groupOrder.length; gi++) {
    const group = model.groups.get(model.groupOrder[gi]);
    if (!group) continue;
    for (let wi = 0; wi < group.segmentIds.length; wi++) {
      const seg = model.segments.get(group.segmentIds[wi]);
      if (!seg) continue;
      const wordEl = getWordEl(iframe, gi, wi);
      if (!wordEl) continue;
      const s = seg.style;
      writeTransform(wordEl, win, s.x ?? 0, s.y ?? 0, s.scaleX ?? 1, s.rotation ?? 0);
    }
  }
}

/** Compute style deltas from the current wrapper transform — used by syncToStore in the overlay. */
export function computeTransformStyle(el: HTMLElement, iframeWin: Window): Record<string, number> {
  return transformStyle(readGsapTransform(getOrCreateWrapper(el), iframeWin));
}

export function transformStyle({ x, y, scale, rotation }: WordTransform): Record<string, number> {
  const style: Record<string, number> = {};
  if (Math.abs(x) > 0.5) style.x = x;
  if (Math.abs(y) > 0.5) style.y = y;
  if (Math.abs(scale - 1) > 0.001) {
    style.scaleX = scale;
    style.scaleY = scale;
  }
  if (Math.abs(rotation) > 0.1) style.rotation = rotation;
  return style;
}

export interface WordTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}
type WordEntry = EditingParams<"caption-transform">["entries"][number];
export interface FrameWord {
  transform: WordTransform;
  rect: { x: number; y: number; width: number; height: number };
}

const allFinite = (value: unknown, keys: string[]) =>
  isPlainRecord(value) && keys.every((key) => Number.isFinite(value[key]));

function readFrameWord(value: unknown): FrameWord | null {
  if (!isPlainRecord(value)) return null;
  const ok =
    allFinite(value.transform, ["x", "y", "scale", "rotation"]) &&
    allFinite(value.rect, ["x", "y", "width", "height"]);
  return ok ? (value as unknown as FrameWord) : null;
}

export function findCaptionWord(
  model: { groupOrder: string[]; groups: Map<string, { segmentIds: string[] }> },
  segmentId: string,
): { group: number; word: number } | null {
  for (let group = 0; group < model.groupOrder.length; group++) {
    const word = model.groups.get(model.groupOrder[group])?.segmentIds.indexOf(segmentId) ?? -1;
    if (word >= 0) return { group, word };
  }
  return null;
}

/** `readWordBoxes` for a frame Studio cannot read; null when its runtime does not answer. */
export async function readFrameWordBoxes(
  iframe: HTMLIFrameElement,
  model: { groupOrder: string[]; groups: Map<string, { segmentIds: string[] }> },
  overlayEl: HTMLElement,
): Promise<WordBox[] | null> {
  const words = model.groupOrder.map((id) => model.groups.get(id)?.segmentIds.length ?? 0);
  const reply = await previewRequest(iframe, "caption-words", { words });
  const boxes: unknown = reply?.boxes;
  if (!Array.isArray(boxes)) return null;
  const iframeDisplayRect = iframe.getBoundingClientRect();
  const overlayRect = overlayEl.getBoundingClientRect();
  const nativeW = parseFloat(iframe.style.width) || iframeDisplayRect.width;
  const cssScale = iframeDisplayRect.width / nativeW;
  const offsetX = iframeDisplayRect.left - overlayRect.left;
  const offsetY = iframeDisplayRect.top - overlayRect.top;
  return boxes.flatMap((box: unknown): WordBox[] => {
    if (!isPlainRecord(box) || !allFinite(box.rect, ["x", "y", "width", "height"])) return [];
    const { group, word } = box;
    if (!Number.isSafeInteger(group) || !Number.isSafeInteger(word)) return [];
    const groupId = model.groupOrder[group as number];
    const segmentId = groupId && model.groups.get(groupId)?.segmentIds[word as number];
    if (!segmentId) return [];
    const rect = box.rect as FrameWord["rect"];
    return [
      {
        segmentId,
        groupId,
        groupIndex: group as number,
        wordIndex: word as number,
        x: rect.x * cssScale + offsetX,
        y: rect.y * cssScale + offsetY,
        width: rect.width * cssScale,
        height: rect.height * cssScale,
      },
    ];
  });
}

type Op = { entry: WordEntry; done: Array<(word: FrameWord | null) => void> };
const transformQueues = new WeakMap<HTMLIFrameElement, { ops: Op[]; sending: boolean }>();

function sendTransforms(iframe: HTMLIFrameElement, queue: { ops: Op[]; sending: boolean }) {
  if (queue.sending || !queue.ops.length) return;
  const ops = queue.ops.splice(0, MAX_DESCRIBE_HANDLES);
  queue.sending = true;
  const entries = ops.map((op) => op.entry);
  void previewRequest(iframe, "caption-transform", { entries })
    .then((reply) => {
      const words: unknown = reply?.words;
      ops.forEach((op, i) => {
        const word = Array.isArray(words) ? readFrameWord(words[i]) : null;
        op.done.forEach((done) => done(word));
      });
    })
    .finally(() => {
      queue.sending = false;
      sendTransforms(iframe, queue);
    });
}

/** One request in flight per frame; a waiting write to the same word takes the later one's parts. */
export function frameWordTransform(
  iframe: HTMLIFrameElement,
  entry: WordEntry,
): Promise<FrameWord | null> {
  let queue = transformQueues.get(iframe);
  if (!queue) transformQueues.set(iframe, (queue = { ops: [], sending: false }));
  const { ops } = queue;
  const promise = new Promise<FrameWord | null>((resolve) => {
    const last = ops[ops.length - 1];
    const sameWord = last?.entry.group === entry.group && last.entry.word === entry.word;
    if (last && sameWord && last.entry.set && entry.set) {
      last.entry = { ...entry, set: { ...last.entry.set, ...entry.set } };
      last.done.push(resolve);
    } else ops.push({ entry, done: [resolve] });
  });
  sendTransforms(iframe, queue);
  return promise;
}
