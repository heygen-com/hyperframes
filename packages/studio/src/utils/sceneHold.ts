import type { TimelineElement } from "../player";
import { previewFrameOpaque, previewRequest } from "../player/lib/previewChannel";

type SceneHoldingWindow = Window & { __hfHoldScenes?: (names: string[]) => Promise<void> };

/** Mounts the scenes holding a timeline element; undefined, so no wait, where the preview mounts every scene. */
export function holdScenesOf(
  iframe: HTMLIFrameElement | null,
  element: TimelineElement | null,
): Promise<void> | undefined {
  const names = element
    ? [...(element.compositionAncestors ?? []), element.parentCompositionId ?? ""].filter(Boolean)
    : [];
  if (iframe && previewFrameOpaque(iframe))
    return previewRequest(iframe, "hold-scenes", { names }).then(() => {});
  let hold: SceneHoldingWindow["__hfHoldScenes"];
  try {
    hold = (iframe?.contentWindow as SceneHoldingWindow | null)?.__hfHoldScenes;
  } catch {
    return undefined;
  }
  if (!hold) return undefined;
  return hold(names).catch(() => {});
}
