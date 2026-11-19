import { readTextLayer, type TextLayerRead } from "@hyperframes/core/runtime/editing-port";
import { parseCssColor } from "../../components/editor/colorValue";
import type { TimelineText } from "../store/timelineElement";

/** A text layer's row text from the runtime's read; the background only when it is opaque. */
export function timelineTextOf(read: TextLayerRead | null | undefined): TimelineText | undefined {
  if (!read) return undefined;
  const { backgroundColor, ...look } = read;
  return {
    ...look,
    background: parseCssColor(backgroundColor)?.alpha === 1 ? backgroundColor : undefined,
  };
}

export function readTimelineText(el: Element): TimelineText | undefined {
  return timelineTextOf(readTextLayer(el));
}

export function sameTimelineText(a?: TimelineText, b?: TimelineText): boolean {
  if (!a || !b) return a === b;
  return (
    a.value === b.value &&
    a.fontFamily === b.fontFamily &&
    a.fontWeight === b.fontWeight &&
    a.color === b.color &&
    a.background === b.background
  );
}
