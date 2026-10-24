/** The visibility pass's mark on a timed clip it hides; the runtime's rules hide the clip's contents by it. */
export const CLIP_HIDDEN_ATTR = "data-hf-clip-hidden";

type ShaderWindow = Window & {
  HyperShader?: unknown;
  __hf?: { transitions?: unknown };
  __hfClipRevealAware?: boolean;
};

/** Shows a clip the visibility pass hid, contents included; returns a function that puts the mark back. */
export function revealClip(el: HTMLElement, priority = ""): () => void {
  el.style.setProperty("visibility", "visible", priority);
  if (!el.hasAttribute(CLIP_HIDDEN_ATTR)) return () => {};
  el.removeAttribute(CLIP_HIDDEN_ATTR);
  return function putClipHiddenMarkBack() {
    el.setAttribute(CLIP_HIDDEN_ATTR, "");
  };
}

/** Called by shader-transitions builds on load: their revealers go through revealClip. */
export function declareClipRevealAware(): void {
  if (typeof window !== "undefined") (window as ShaderWindow).__hfClipRevealAware = true;
}

/** A shader-transitions build is on the page whose revealers predate revealClip. */
export function olderShaderBuildOnPage(): boolean {
  const win = window as ShaderWindow;
  const shaderOnPage = win.HyperShader !== undefined || win.__hf?.transitions !== undefined;
  return shaderOnPage && win.__hfClipRevealAware !== true;
}
