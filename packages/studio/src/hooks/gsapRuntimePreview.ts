import { getIframeGsap } from "./gsapShared";

export function previewKeyframeChange(
  iframe: HTMLIFrameElement | null,
  selector: string,
  properties: Record<string, number | string>,
): boolean {
  const gsap = getIframeGsap(iframe);
  if (!gsap?.set) return false;
  try {
    gsap.set(selector, properties);
    return true;
  } catch {
    return false;
  }
}
