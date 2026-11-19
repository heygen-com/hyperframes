import {
  MAX_ELEMENT_VALUE,
  MAX_TIMELINE_TEXT,
  readTextLayer,
  type TextLayerRead,
} from "@hyperframes/core/runtime/editing-port";
import { parseCssColor } from "../../components/editor/colorValue";
import type { TimelineText } from "../store/timelineElement";

function timelineTextOf(read: TextLayerRead | null): TimelineText | undefined {
  if (!read) return undefined;
  const { backgroundColor, ...look } = read;
  return {
    ...look,
    background: parseCssColor(backgroundColor)?.alpha === 1 ? backgroundColor : undefined,
  };
}

const isSentText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;

/** The runtime's text read from a clip message: null unless every field is text within the runtime's caps. */
function receivedTextLayer(raw: unknown): TextLayerRead | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { value, fontFamily, fontWeight, color, backgroundColor } = raw as Record<string, unknown>;
  return isSentText(value, MAX_TIMELINE_TEXT) &&
    isSentText(fontFamily, MAX_ELEMENT_VALUE) &&
    isSentText(fontWeight, MAX_ELEMENT_VALUE) &&
    isSentText(color, MAX_ELEMENT_VALUE) &&
    isSentText(backgroundColor, MAX_ELEMENT_VALUE)
    ? { value, fontFamily, fontWeight, color, backgroundColor }
    : null;
}

export function readTimelineText(el: Element): TimelineText | undefined {
  return timelineTextOf(readTextLayer(el));
}

export function receivedTimelineText(raw: unknown): TimelineText | undefined {
  return timelineTextOf(receivedTextLayer(raw));
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
