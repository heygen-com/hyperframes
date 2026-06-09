/**
 * Low-level GSAP runtime property readers shared by gsapRuntimeBridge and gsapDragCommit.
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";

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
    return Number.isFinite(val) ? Math.round(val) : null;
  } catch {
    return null;
  }
}

export function readAllAnimatedProperties(
  iframe: HTMLIFrameElement | null,
  selector: string,
  anim: GsapAnimation,
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

  for (const prop of propKeys) {
    const val = Number(gsap.getProperty(el, prop));
    if (Number.isFinite(val)) result[prop] = Math.round(val);
  }
  return result;
}
