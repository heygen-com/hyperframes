// Read from the live element: by Studio for a preview it scripts, by the frame's gesture start when sealed.
import { splitTopLevelWhitespace } from "../positionEdits";

const cssValue = (style: CSSStyleDeclaration, prop: string) => {
  const value = style.getPropertyValue(prop).trim();
  return value === "none" ? "" : value;
};

// Without GSAP, the rotation GSAP will parse from the CSS `rotate`, `scale` and `transform`; with
// `withRotate` false, only the part `scale` and `transform` draw. GSAP folds them into one transform,
// and a list the browser rejects (e.g. `rotate: x 30deg`) leaves it only the plain transform.
export function readCssRotation(element: HTMLElement, withRotate = true): number {
  const view = element.ownerDocument.defaultView;
  if (!view) return 0;
  const style = view.getComputedStyle(element);
  const rotate = withRotate ? cssValue(style, "rotate") : "";
  const scale = cssValue(style, "scale");
  const transform = cssValue(style, "transform");
  const angle = (list: string) => {
    if (!list) return 0;
    const m = new view.DOMMatrix(list);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
  };
  const folded = [rotate && `rotate(${rotate})`, scale && `scale(${scale.split(/\s+/).join(",")})`];
  try {
    return angle([...folded, transform].join(" ").trim());
  } catch {
    return angle(transform);
  }
}

function lastRuleTransform(element: HTMLElement): string {
  let value = "";
  for (const sheet of Array.from(element.ownerDocument.styleSheets)) {
    let rules: CSSStyleRule[] = [];
    try {
      rules = Array.from(sheet.cssRules) as CSSStyleRule[];
    } catch {
      // a cross-origin sheet
    }
    for (const rule of rules) {
      const declared = rule.style?.getPropertyValue("transform");
      if (declared && element.matches(rule.selectorText)) value = declared;
    }
  }
  return value;
}

// ponytail: the authored transform if it moves the box, from the last matching rule in sheet order;
// specificity, !important and @media are not weighed. Weigh them when a film's rule is missed.
function translatingTransform(element: HTMLElement): string {
  const view = element.ownerDocument.defaultView;
  const computed = view?.getComputedStyle(element).transform ?? "none";
  const m = computed === "none" ? null : new view!.DOMMatrix(computed);
  if (!m || (m.m41 === 0 && m.m42 === 0)) return "";
  const value = element.style.getPropertyValue("transform") || lastRuleTransform(element);
  return value === "none" ? "" : value;
}

/** Where a plain rotate draws its turn, read once at press: the element's own `rotate`, or, when its
 *  transform translates it (often the translate(-50%, -50%) centring), a rotate() right after that
 *  translate, so the box turns in place in screen space. `share` is what the rest already turns. */
export interface CssRotationTarget {
  property: "rotate" | "transform";
  before: string;
  after: string;
  share: number;
  /** -1 when a mirroring `scale` property flips a turn made inside the transform. */
  sign: number;
  /** An inline box does not transform, so the turn makes it inline-block. */
  inline: boolean;
}

const TRANSLATE = /^translate(?:3d|X|Y|Z)?\(/i;
const OWN_TURN = /^rotate\(\s*-?[\d.]+(?:e[+-]?\d+)?deg\s*\)$/i;

export function readCssRotationTarget(element: HTMLElement): CssRotationTarget {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const inline = style?.display === "inline";
  const transform = translatingTransform(element);
  if (!transform) {
    const share = readCssRotation(element, false);
    return { property: "rotate", before: "", after: "", share, sign: 1, inline };
  }
  const parts = splitTopLevelWhitespace(transform);
  const lead = parts.findIndex((part) => !TRANSLATE.test(part));
  const split = lead < 0 ? parts.length : lead;
  const rest = parts.slice(split);
  if (OWN_TURN.test(rest[0] ?? "")) rest.shift();
  const [before, after] = [parts.slice(0, split).join(" "), rest.join(" ")];
  const [sx = 1, sy = sx] = splitTopLevelWhitespace(style?.getPropertyValue("scale") ?? "").map(
    Number.parseFloat,
  );
  const inlineStyle = element.style;
  const saved = [
    inlineStyle.getPropertyValue("transform"),
    inlineStyle.getPropertyPriority("transform"),
  ];
  inlineStyle.setProperty("transform", `${before} ${after}`.trim() || "none");
  const share = readCssRotation(element);
  inlineStyle.setProperty("transform", saved[0] ?? "", saved[1] ?? "");
  return { property: "transform", before, after, share, sign: sx * sy < 0 ? -1 : 1, inline };
}

export interface CssRotationStart {
  angle: number;
  target: CssRotationTarget;
}

export const readCssRotationStart = (element: HTMLElement): CssRotationStart => ({
  angle: readCssRotation(element),
  target: readCssRotationTarget(element),
});
