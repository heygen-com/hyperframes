import { CAPTURE_CANVAS_SELECTOR } from "./htmlInCanvas";

type UaWindow = { navigator: { userAgent: string } };

/** Major Chrome version from the user agent (HeadlessChrome included), or null when unknown. */
export function chromeMajor(win: UaWindow = window): number | null {
  const m = /Chrome\/(\d+)/.exec(win.navigator.userAgent);
  return m?.[1] ? Number(m[1]) : null;
}

export interface CaptureDefect {
  code: string;
  reason: string;
}

export interface DefectEnv {
  isAccelerated: (canvas: HTMLCanvasElement) => boolean;
  /** Result of `scanBackfaceDefect`, refreshed whenever the scene is rescanned. */
  backface: boolean;
}

// Every defect blocks on every Chrome version: render and preview browsers can differ.
interface Defect {
  code: string;
  reason: string;
  detect: (root: HTMLElement, env: DefectEnv) => boolean;
}

const hasHidden3dFace = (_root: HTMLElement, env: DefectEnv): boolean => env.backface;

// The whole document: a render's shader-transition canvas sits in <body>, preview's in the root.
const hasAcceleratedCanvas = (root: HTMLElement, env: DefectEnv): boolean =>
  Array.from(root.ownerDocument.querySelectorAll("canvas")).some(env.isAccelerated);

const IDENTITY_TRANSFORM =
  /^matrix\(\s*1,\s*0,\s*0,\s*1,\s*0,\s*0\s*\)$|^matrix3d\(\s*1,\s*0,\s*0,\s*0,\s*0,\s*1,\s*0,\s*0,\s*0,\s*0,\s*1,\s*0,\s*0,\s*0,\s*0,\s*1\s*\)$/;

const moves = (value: string | undefined, identity: number): boolean =>
  !!value && value !== "none" && !value.split(/\s+/).every((p) => parseFloat(p) === identity);

// `scale`, `rotate` and `translate` transform the root just as `transform` does.
const hasRootTransform = (root: HTMLElement): boolean => {
  const cs = getComputedStyle(root);
  const t = cs.transform.trim();
  if (moves(cs.scale, 1) || moves(cs.rotate, 0) || moves(cs.translate, 0)) return true;
  return t !== "none" && t !== "" && !IDENTITY_TRANSFORM.test(t);
};

const hasRootBlend = (root: HTMLElement): boolean => {
  const mode = getComputedStyle(root).mixBlendMode;
  return !!mode && mode !== "normal";
};

const hasRootOpacity = (root: HTMLElement): boolean =>
  Number.parseFloat(getComputedStyle(root).opacity) < 1;

// Moving the root tears these down and starts them again: a frame reloads, a custom element reconnects.
const hasReinitialised = (root: HTMLElement): boolean =>
  root.querySelector("iframe, object, embed") !== null ||
  Array.from(root.querySelectorAll("*")).some(
    (el) => el.localName.includes("-") && customElements.get(el.localName) !== undefined,
  );

const DEFECTS: readonly Defect[] = [
  {
    code: "nested-capture-canvas",
    reason: "the composition already uses html-in-canvas",
    detect: (root) => root.querySelector(CAPTURE_CANVAS_SELECTOR) !== null,
  },
  {
    // Chrome <=156 captures the canvas frozen at its pre-wrap frame; 157 fixed it.
    code: "accelerated-canvas",
    reason: "the composition draws a WebGL/WebGPU canvas, which html-in-canvas captures frozen",
    detect: hasAcceleratedCanvas,
  },
  {
    code: "backface-visibility",
    reason: "backface-visibility: hidden inside a 3D transform is drawn mirrored by html-in-canvas",
    detect: hasHidden3dFace,
  },
  {
    code: "iframe-in-root",
    reason:
      "the composition contains an <iframe>, <object>, <embed> or custom element, which is re-initialised when blur wraps the root",
    detect: hasReinitialised,
  },
  {
    code: "root-transform",
    reason: "html-in-canvas can ignore a transform on the composition root",
    detect: hasRootTransform,
  },
  {
    code: "root-opacity",
    reason: "html-in-canvas can ignore the composition root's own opacity",
    detect: hasRootOpacity,
  },
  {
    code: "root-blend-mode",
    reason: "html-in-canvas can ignore the composition root's own mix-blend-mode",
    detect: hasRootBlend,
  },
];

/** The first defect that makes html-in-canvas capture this root wrongly in any supported browser, or null. */
export function findCaptureDefect(root: HTMLElement, env: DefectEnv): CaptureDefect | null {
  const defect = DEFECTS.find((d) => d.detect(root, env));
  return defect ? { code: defect.code, reason: defect.reason } : null;
}

const FACE_3D_TRANSFORM = /perspective\(|rotate3d\(|rotate[XY]\(|matrix3d\(/;

function isHidden(cs: CSSStyleDeclaration): boolean {
  return (
    cs.getPropertyValue("backface-visibility") === "hidden" ||
    cs.getPropertyValue("-webkit-backface-visibility") === "hidden"
  );
}

const individualTurnsIn3d = (cs: CSSStyleDeclaration): boolean =>
  !/^(none|-?[\d.]+[a-z]+)?$/.test(cs.rotate ?? "") ||
  (cs.translate ?? "").trim().split(/\s+/).length > 2;

function transformsIn3d(el: HTMLElement, cs: CSSStyleDeclaration): boolean {
  return (
    FACE_3D_TRANSFORM.test(cs.transform) ||
    FACE_3D_TRANSFORM.test(el.style.transform) ||
    individualTurnsIn3d(cs)
  );
}

function in3dContext(el: HTMLElement, root: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (cs.transformStyle === "preserve-3d" || transformsIn3d(node, cs)) return true;
    if (node !== el && cs.perspective !== "none" && cs.perspective !== "") return true;
    if (node === root) break;
  }
  return false;
}

interface StyleBlock {
  selector: string;
  style: CSSStyleDeclaration;
}

const MAX_RULE_DEPTH = 16;

const KF = "@keyframes ";

function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list.charAt(i);
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(list.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(list.slice(from).trim());
  return parts;
}

/** A nested rule's selector made absolute: `&` is the parent, and no `&` means a descendant. */
function resolveNested(selector: string, parent: string | null): string {
  if (parent === null) return selector;
  const outer = `:is(${parent})`;
  return splitSelectorList(selector)
    .map((part) => (part.includes("&") ? part.replaceAll("&", outer) : `${outer} ${part}`))
    .join(", ");
}

function* styleBlocks(
  rules: CSSRuleList,
  parent: string | null,
  seen: Set<CSSStyleSheet>,
  depth: number,
): Generator<StyleBlock> {
  if (depth > MAX_RULE_DEPTH) return;
  for (const rule of Array.from(rules)) yield* ruleBlocks(rule, parent, seen, depth);
}

function nestedDeclarations(rule: CSSRule, parent: string | null): StyleBlock | null {
  const style: unknown = "style" in rule ? rule.style : null;
  return parent !== null && style instanceof CSSStyleDeclaration
    ? { selector: parent, style }
    : null;
}

function* ruleBlocks(
  rule: CSSRule,
  parent: string | null,
  seen: Set<CSSStyleSheet>,
  depth: number,
): Generator<StyleBlock> {
  if (rule instanceof CSSStyleRule) {
    const selector = resolveNested(rule.selectorText, parent);
    yield { selector, style: rule.style };
    yield* styleBlocks(rule.cssRules, selector, seen, depth + 1);
    return;
  }
  if (rule instanceof CSSImportRule) {
    if (rule.styleSheet) yield* sheetBlocks(rule.styleSheet, seen, depth + 1);
    return;
  }
  const declarations = nestedDeclarations(rule, parent);
  if (declarations) yield declarations;
  else if ("cssRules" in rule && rule.cssRules instanceof CSSRuleList) {
    const scope = rule instanceof CSSKeyframesRule ? KF + rule.name : parent;
    yield* styleBlocks(rule.cssRules, scope, seen, depth + 1);
  }
}

function sheetRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}

function* sheetBlocks(
  sheet: CSSStyleSheet,
  seen: Set<CSSStyleSheet>,
  depth: number,
): Generator<StyleBlock> {
  const rules = seen.has(sheet) ? null : sheetRules(sheet);
  seen.add(sheet);
  if (rules) yield* styleBlocks(rules, null, seen, depth);
}

function matching(root: HTMLElement, selector: string): HTMLElement[] {
  try {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector));
    return root.matches(selector) ? [root, ...found] : found;
  } catch {
    return [];
  }
}

function runningFaces(root: HTMLElement): HTMLElement[] {
  return (document.getAnimations?.() ?? []).flatMap(({ effect }) => {
    if (!(effect instanceof KeyframeEffect)) return [];
    const el = effect.target;
    const keyed = effect.getKeyframes().some((k) => k.backfaceVisibility === "hidden");
    return keyed && el instanceof HTMLElement && root.contains(el) ? [el] : [];
  });
}

function namedFaces(root: HTMLElement, keyframed: string[]): HTMLElement[] {
  if (keyframed.length === 0) return [];
  return [root, ...root.querySelectorAll<HTMLElement>("*")].filter((el) =>
    getComputedStyle(el)
      .animationName.split(", ")
      .some((n) => keyframed.includes(KF + n)),
  );
}

function hiddenSelectors(): string[] {
  const seen = new Set<CSSStyleSheet>();
  const sheets = [...Array.from(document.styleSheets), ...(document.adoptedStyleSheets ?? [])];
  const out: string[] = [];
  for (const sheet of sheets) {
    for (const block of sheetBlocks(sheet, seen, 0))
      if (isHidden(block.style)) out.push(block.selector);
  }
  return out;
}

function backfaceCandidates(root: HTMLElement, selectors: string[]): Set<HTMLElement> {
  const keyframed = selectors.filter((s) => s.startsWith(KF));
  const found = new Set<HTMLElement>([
    ...root.querySelectorAll<HTMLElement>('[style*="backface"]'),
    ...runningFaces(root),
    ...namedFaces(root, keyframed),
  ]);
  for (const selector of selectors) for (const el of matching(root, selector)) found.add(el);
  return found;
}

/**
 * Whether a `backface-visibility: hidden` element is in a 3D context right now (flat uses are
 * harmless); call it at several timeline times to see a rotation that a later tween applies.
 */
function createBackfaceCheck(root: HTMLElement): { scan: () => boolean; recheck: () => boolean } {
  const selectors = hiddenSelectors();
  let candidates = new Set<HTMLElement>();
  const anyFace = (): boolean => {
    for (const el of candidates) {
      if (isHidden(getComputedStyle(el)) && in3dContext(el, root)) return true;
    }
    return false;
  };
  return {
    scan: () => {
      candidates = new Set([...candidates, ...backfaceCandidates(root, selectors)]);
      return anyFace();
    },
    recheck: anyFace,
  };
}

export function scanBackfaceDefect(root: HTMLElement): boolean {
  return createBackfaceCheck(root).scan();
}

const FACE_EVERY = 10;

export interface DefectScan {
  sample: (i: number, steps: number, at: number) => void;
  result: () => CaptureDefect | null;
  facesNow: () => boolean;
}

export function createDefectScan(
  root: HTMLElement,
  isAccelerated: DefectEnv["isAccelerated"],
): DefectScan {
  const faces = createBackfaceCheck(root);
  let found: CaptureDefect | null = null;
  return {
    sample: (i, steps, at) => {
      if (found) return;
      const checkFaces = i % FACE_EVERY === 0 || i === steps;
      const defect = findCaptureDefect(root, {
        isAccelerated,
        backface: checkFaces && faces.scan(),
      });
      if (defect)
        found = { ...defect, reason: `${defect.reason} (first seen at t=${at.toFixed(1)}s)` };
    },
    result: () => found,
    facesNow: faces.recheck,
  };
}
