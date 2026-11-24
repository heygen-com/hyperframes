// Studio's live value preview (a 3D-transform slider mid-drag) in a frame it cannot script.
import { drawDrafts, rebaseDrawnPosition } from "../editingDraft";
import { EDITING_ELEMENT_HANDLE, type EditingElementHandle } from "../editingElement";
import { elementForHandle } from "../editingHandles";
import type { EditingDraft } from "../editingPort";

const GSAP_SET_CHANNELS = new Set([
  "x",
  "y",
  "z",
  "rotation",
  "rotationX",
  "rotationY",
  "rotationZ",
  "transformPerspective",
  "scale",
  "scaleX",
  "scaleY",
  "opacity",
  "width",
  "height",
]);

export type GsapSetParams = {
  handle: EditingElementHandle;
  props: Record<string, number>;
  drafts?: EditingDraft[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";

export function parseGsapSet(params: unknown): GsapSetParams | null {
  if (!isRecord(params) || Object.keys(params).sort().join() !== "handle,props") return null;
  const { handle, props } = params;
  if (typeof handle !== "string" || !EDITING_ELEMENT_HANDLE.test(handle) || !isRecord(props))
    return null;
  const entries = Object.entries(props);
  const valid = entries.every(
    ([channel, value]) =>
      GSAP_SET_CHANNELS.has(channel) && typeof value === "number" && Number.isFinite(value),
  );
  return valid && entries.length > 0 ? { handle, props: props as Record<string, number> } : null;
}

type FrameGsap = { set?: (target: Element, vars: Record<string, number>) => void };

export function gsapSet({ handle, props, drafts }: GsapSetParams): { applied: boolean } {
  if (drafts) drawDrafts(drafts);
  const element = elementForHandle(handle);
  const gsap = (window as { gsap?: FrameGsap }).gsap;
  if (!element || typeof gsap?.set !== "function") return { applied: false };
  gsap.set(element, { ...props });
  rebaseDrawnPosition(element, props);
  return { applied: true };
}
