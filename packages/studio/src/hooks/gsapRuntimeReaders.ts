/**
 * Low-level GSAP runtime property readers shared by gsapRuntimeBridge and gsapDragCommit.
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { classifyPropertyGroup, type PropertyGroupName } from "@hyperframes/core/gsap-parser";
import { getIframeGsap, queryIframeElement } from "./gsapShared";
import { settleGsapSnapshot } from "./gsapFrameSnapshot";
import { previewComputedStyles, previewFrameOpaque } from "../player/lib/previewChannel";
import { gsapWritesChannels } from "./gsapRuntimeKeyframes";
import { roundTo3 } from "../utils/rounding";

export function readGsapProperty(
  iframe: HTMLIFrameElement | null,
  selector: string | null,
  prop: string,
): number | null {
  if (!selector) return null;
  const gsap = getIframeGsap(iframe);
  if (!gsap) return null;
  const el = queryIframeElement(iframe, selector);
  if (!el) return null;
  try {
    const val = Number(gsap.getProperty(el, prop));
    if (!Number.isFinite(val)) return null;
    return POSITION_PROPS.has(prop) ? Math.round(val) : roundTo3(val);
  } catch {
    return null;
  }
}

export const POSITION_PROPS = new Set(["x", "y", "xPercent", "yPercent"]);
export async function readAllAnimatedProperties(
  iframe: HTMLIFrameElement | null,
  selector: string,
  anim: GsapAnimation,
  group?: PropertyGroupName,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  if (!iframe) return result;
  await settleGsapSnapshot(iframe);
  const gsap = getIframeGsap(iframe);
  if (!gsap) return result;
  const el = queryIframeElement(iframe, selector);
  if (!el) return result;

  const propKeys = new Set<string>();
  if (anim.keyframes) {
    for (const kf of anim.keyframes.keyframes) {
      for (const p of Object.keys(kf.properties)) {
        if (typeof kf.properties[p] === "number") propKeys.add(p);
      }
    }
  } else {
    for (const p of Object.keys(anim.properties)) propKeys.add(p);
  }

  // When a group filter is specified, only properties belonging to that group
  // may enter the result — including the baseline passes below. The whole
  // point of property-group tweens is that a rotation commit never carries
  // opacity/rotationX/etc. captured from unrelated tweens on the element.
  const inGroup = (p: string) => !group || classifyPropertyGroup(p) === group;
  const groupedPropKeys = new Set([...propKeys].filter(inGroup));

  for (const prop of groupedPropKeys) {
    const val = Number(gsap.getProperty(el, prop));
    if (Number.isFinite(val)) {
      result[prop] = POSITION_PROPS.has(prop) ? Math.round(val) : roundTo3(val);
    }
  }

  // Element-dependent properties — their "default" depends on the
  // stylesheet, so we compare GSAP's runtime value against the element's
  // computed CSS value. Only capture if GSAP has actively changed it.
  const COMPUTED_BASELINE = [
    "borderRadius",
    "borderTopLeftRadius",
    "borderTopRightRadius",
    "borderBottomLeftRadius",
    "borderBottomRightRadius",
    "letterSpacing",
    "wordSpacing",
    "lineHeight",
    "fontSize",
    "outlineOffset",
    "outlineWidth",
    "strokeDashoffset",
    "strokeWidth",
    "backgroundPositionX",
    "backgroundPositionY",
  ];
  const css = await computedCss(iframe, el, selector, COMPUTED_BASELINE.map(kebabCase));
  for (const prop of COMPUTED_BASELINE) {
    if (prop in result) continue;
    if (!inGroup(prop)) continue;
    if (gsapWritesChannels(el, [prop])) continue;
    const gsapVal = Number(gsap.getProperty(el, prop));
    if (!Number.isFinite(gsapVal)) continue;
    const cssVal = parseFloat(css[kebabCase(prop)] ?? "");
    if (Number.isFinite(cssVal) && Math.round(gsapVal * 1000) === Math.round(cssVal * 1000))
      continue;
    result[prop] = roundTo3(gsapVal);
  }

  return result;
}

const kebabCase = (prop: string) => prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** The element's computed CSS for `names`: over the port for a sealed frame, as the live element answers. */
async function computedCss(
  iframe: HTMLIFrameElement,
  el: Element,
  selector: string,
  names: string[],
): Promise<Record<string, string>> {
  if (previewFrameOpaque(iframe))
    return (await previewComputedStyles(iframe, selector, names)) ?? {};
  try {
    const style = iframe.contentDocument?.defaultView?.getComputedStyle(el);
    return style
      ? Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]))
      : {};
  } catch {
    return {};
  }
}
