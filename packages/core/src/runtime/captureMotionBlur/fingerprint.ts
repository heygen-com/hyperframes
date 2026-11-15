import {
  emptyMotionBlurFingerprint,
  type MotionBlurFingerprint,
  type MotionBlurFingerprintField,
} from "../../motionBlurFingerprint";
import { isAcceleratedCanvas } from "../../pageMotionBlur";
import { isHtmlElement } from "../domRealm";
import { CONTENT_NODE_LIMIT, holdsFixedChild, pseudoBox, within } from "./frames";

const NODE_LIMIT = 4096;
const SCROLL_SLACK = 1;

const isNone = (value: string | undefined): boolean => !value || value === "none";

function scrolls(overflow: string, scroll: number, client: number): boolean {
  return (overflow === "auto" || overflow === "scroll") && scroll > client + SCROLL_SLACK;
}

function tallyCanvases(root: HTMLElement, fp: MotionBlurFingerprint): void {
  for (const canvas of root.ownerDocument.querySelectorAll("canvas")) {
    if (isAcceleratedCanvas(canvas)) fp.webgl++;
    else fp.canvas2d++;
  }
}

type ElementTest = readonly [
  MotionBlurFingerprintField,
  (el: Element, cs: CSSStyleDeclaration) => boolean,
];

const ELEMENT_TESTS: readonly ElementTest[] = [
  ["video", (el) => el.localName === "video"],
  ["iframe", (el) => el.localName === "iframe"],
  ["customElement", (el) => isHtmlElement(el) && el.localName.includes("-")],
  ["svgClip", (_, cs) => cs.clipPath.startsWith("url(")],
  ["mask", (_, cs) => !isNone(cs.maskImage) || !isNone(cs.mask)],
  [
    "scrollContainer",
    (el, cs) =>
      scrolls(cs.overflowX, el.scrollWidth, el.clientWidth) ||
      scrolls(cs.overflowY, el.scrollHeight, el.clientHeight),
  ],
  ["threeD", (_, cs) => cs.transformStyle === "preserve-3d" || !isNone(cs.perspective)],
  ["blendMode", (_, cs) => !!cs.mixBlendMode && cs.mixBlendMode !== "normal"],
];

function tallyElement(el: Element, fp: MotionBlurFingerprint): void {
  const cs = getComputedStyle(el);
  for (const [field, test] of ELEMENT_TESTS) if (test(el, cs)) fp[field]++;
}

function pokesOut(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  if (cs.overflowX !== "visible" && cs.overflowY !== "visible") return false;
  if (el.scrollWidth > el.offsetWidth + SCROLL_SLACK) return true;
  if (el.scrollHeight > el.offsetHeight + SCROLL_SLACK) return true;
  const own = el.getBoundingClientRect();
  const outside = (r: DOMRect): boolean => r.width > 0 && r.height > 0 && !within(r, own);
  const text = el.ownerDocument.createRange();
  text.selectNodeContents(el);
  if (outside(text.getBoundingClientRect())) return true;
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
  for (let n = 0; n < CONTENT_NODE_LIMIT && walker.nextNode(); n++) {
    if (outside((walker.currentNode as Element).getBoundingClientRect())) return true;
  }
  return false;
}

function pseudoPokesOut(el: HTMLElement): boolean {
  return (["::before", "::after"] as const).some((which) => {
    const box = pseudoBox(el, which);
    return (
      box !== null &&
      (box[0] < 0 || box[1] < 0 || box[2] > el.offsetWidth || box[3] > el.offsetHeight)
    );
  });
}

const MAX_SAMPLES = 24;

function coveredAtCentre(el: HTMLElement, root: HTMLElement): boolean {
  if (typeof el.checkVisibility === "function" && !el.checkVisibility({ visibilityProperty: true }))
    return false;
  if (getComputedStyle(el).pointerEvents === "none") return false;
  const box = el.getBoundingClientRect();
  if (!box.width || !box.height) return false;
  const stack = el.ownerDocument.elementsFromPoint(
    box.left + box.width / 2,
    box.top + box.height / 2,
  );
  const own = stack.findIndex((hit) => el.contains(hit));
  return stack.slice(0, Math.max(own, 0)).some((hit) => root.contains(hit));
}

export function coverageSampler(root: HTMLElement) {
  const covered = new Set<HTMLElement>();
  const sample = (step: number, steps: number, fast: ReadonlySet<HTMLElement>): void => {
    if (
      step % Math.ceil(steps / MAX_SAMPLES) !== 0 ||
      typeof root.ownerDocument.elementsFromPoint !== "function"
    )
      return;
    for (const el of fast) if (!covered.has(el) && coveredAtCentre(el, root)) covered.add(el);
  };
  return { covered, sample };
}

function tallyMover(el: HTMLElement, fp: MotionBlurFingerprint): void {
  const cs = getComputedStyle(el);
  const backdrop = cs.backdropFilter || cs.getPropertyValue("-webkit-backdrop-filter");
  if (!isNone(backdrop) && (!cs.mixBlendMode || cs.mixBlendMode === "normal")) fp.blendMode++;
  if (pokesOut(el)) fp.overflowingMover++;
  if (holdsFixedChild(el)) fp.fixedInMover++;
  if (pseudoPokesOut(el)) fp.pseudoOutside++;
}

export function compositionFingerprint(
  root: HTMLElement,
  movers: readonly HTMLElement[],
  covered: ReadonlySet<HTMLElement> = new Set(),
): MotionBlurFingerprint {
  const fp = emptyMotionBlurFingerprint();
  tallyCanvases(root, fp);
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let n = 0; n < NODE_LIMIT && walker.nextNode(); n++) {
    tallyElement(walker.currentNode as Element, fp);
  }
  for (const mover of movers) {
    tallyMover(mover, fp);
    if (covered.has(mover)) fp.frontOfMover++;
  }
  return fp;
}
