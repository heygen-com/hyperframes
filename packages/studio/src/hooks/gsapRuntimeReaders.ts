/**
 * Low-level GSAP runtime property readers shared by gsapRuntimeBridge and gsapDragCommit.
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { classifyPropertyGroup, type PropertyGroupName } from "@hyperframes/core/gsap-parser";

interface IframeGsap {
  getProperty: (el: Element, prop: string) => number;
}

export function readGsapProperty(
  iframe: HTMLIFrameElement | null,
  selector: string | null,
  prop: string,
): number | null {
  if (!iframe?.contentWindow || !selector) return null;
  try {
    const gsap = (iframe.contentWindow as unknown as { gsap?: IframeGsap }).gsap;
    if (!gsap?.getProperty) return null;
    const el = iframe.contentDocument?.querySelector(selector);
    if (!el) return null;
    const val = Number(gsap.getProperty(el, prop));
    if (!Number.isFinite(val)) return null;
    return POSITION_PROPS.has(prop) ? Math.round(val) : Math.round(val * 1000) / 1000;
  } catch {
    return null;
  }
}

const POSITION_PROPS = new Set(["x", "y", "xPercent", "yPercent"]);
const GSAP_CONFIG_KEYS = new Set([
  "duration",
  "ease",
  "delay",
  "stagger",
  "id",
  "onComplete",
  "onUpdate",
  "onStart",
  "onRepeat",
  "repeat",
  "yoyo",
  "repeatDelay",
  "paused",
  "immediateRender",
  "lazy",
  "overwrite",
  "keyframes",
  "parent",
]);

export function readAllAnimatedProperties(
  iframe: HTMLIFrameElement | null,
  selector: string,
  anim: GsapAnimation,
  group?: PropertyGroupName,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (!iframe?.contentWindow) return result;
  let gsap: IframeGsap | undefined;
  try {
    gsap = (iframe.contentWindow as unknown as { gsap?: IframeGsap }).gsap;
  } catch {
    return result;
  }
  if (!gsap?.getProperty) return result;
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return result;
  }
  const el = doc?.querySelector(selector);
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

  // When a group filter is specified, only keep properties belonging to that group.
  if (group) {
    for (const p of propKeys) {
      if (classifyPropertyGroup(p) !== group) propKeys.delete(p);
    }
  }

  for (const prop of propKeys) {
    const val = Number(gsap.getProperty(el, prop));
    if (Number.isFinite(val)) {
      result[prop] = POSITION_PROPS.has(prop) ? Math.round(val) : Math.round(val * 1000) / 1000;
    }
  }

  const otherTweenProps = new Set<string>();
  try {
    const win = iframe.contentWindow as unknown as { __timelines?: Record<string, unknown> };
    const timelines = win.__timelines;
    if (timelines) {
      for (const tl of Object.values(timelines)) {
        const tlObj = tl as {
          getChildren?: (
            deep: boolean,
          ) => Array<{ targets?: () => Element[]; vars?: Record<string, unknown> }>;
        };
        if (!tlObj?.getChildren) continue;
        for (const child of tlObj.getChildren(true)) {
          if (typeof child.targets !== "function") continue;
          const targets = child.targets();
          if (!targets.includes(el)) continue;
          const vars = child.vars;
          if (!vars) continue;
          for (const k of Object.keys(vars)) {
            if (!GSAP_CONFIG_KEYS.has(k)) otherTweenProps.add(k);
          }
        }
      }
    }
  } catch (e) {
    console.warn(
      "Cross-tween guard failed — baseline capture may include values from other tweens",
      e,
    );
  }
  for (const p of propKeys) otherTweenProps.delete(p);

  // Tier 1: Transform + visual properties with universal CSS defaults.
  // Safe to compare against hardcoded values — these are always 0 or 1
  // regardless of the element's stylesheet.
  const UNIVERSAL_BASELINE: Record<string, number> = {
    opacity: 1,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    skewX: 0,
    skewY: 0,
    z: 0,
    xPercent: 0,
    yPercent: 0,
    transformPerspective: 0,
    blur: 0,
    brightness: 1,
    contrast: 1,
    saturate: 1,
    hueRotate: 0,
    grayscale: 0,
    sepia: 0,
    invert: 0,
  };
  // Collect all properties that ANY tween on this element explicitly targets.
  // Only capture baseline values for these — GSAP reports non-default values
  // (scaleZ=0, brightness=0) for untouched properties, polluting keyframes.
  const allTweenedProps = new Set([...propKeys, ...otherTweenProps]);
  for (const [prop, defaultVal] of Object.entries(UNIVERSAL_BASELINE)) {
    if (prop in result) continue;
    if (!allTweenedProps.has(prop)) continue;
    const val = Number(gsap.getProperty(el, prop));
    if (Number.isFinite(val) && Math.round(val * 1000) !== Math.round(defaultVal * 1000)) {
      result[prop] = Math.round(val * 1000) / 1000;
    }
  }

  // Tier 2: Element-dependent properties — their "default" depends on the
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
  let computedStyle: CSSStyleDeclaration | null = null;
  try {
    computedStyle = doc?.defaultView?.getComputedStyle(el) ?? null;
  } catch {}
  for (const prop of COMPUTED_BASELINE) {
    if (prop in result) continue;
    if (otherTweenProps.has(prop)) continue;
    const gsapVal = Number(gsap.getProperty(el, prop));
    if (!Number.isFinite(gsapVal)) continue;
    let cssVal = NaN;
    if (computedStyle) {
      const raw = computedStyle.getPropertyValue(
        prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
      );
      cssVal = parseFloat(raw);
    }
    if (Number.isFinite(cssVal) && Math.round(gsapVal * 1000) === Math.round(cssVal * 1000))
      continue;
    result[prop] = Math.round(gsapVal * 1000) / 1000;
  }

  return result;
}
