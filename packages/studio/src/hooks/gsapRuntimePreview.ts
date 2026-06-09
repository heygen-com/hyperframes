export function previewKeyframeChange(
  iframe: HTMLIFrameElement | null,
  selector: string,
  properties: Record<string, number | string>,
): boolean {
  if (!iframe?.contentWindow) return false;
  try {
    const gsap = (
      iframe.contentWindow as unknown as {
        gsap?: { set: (target: string, vars: Record<string, number | string>) => void };
      }
    ).gsap;
    if (!gsap?.set) return false;
    gsap.set(selector, properties);
    return true;
  } catch {
    return false;
  }
}
