import type { TimelineTrimMode } from "./timelineTrimOps";

/**
 * The tools the timeline surface can be in. Select and razor predate the trim
 * tools; the four trim modes join the same union so exactly one tool is active
 * at a time and the store needs no second flag.
 */
export type TimelineTool = "select" | "razor" | TimelineTrimMode;

/** The trim operation a tool selection implies, or null for select / razor. */
export function activeTrimMode(tool: TimelineTool): TimelineTrimMode | null {
  return tool === "select" || tool === "razor" ? null : tool;
}

/**
 * One place that names the trim tools: the toolbar buttons, the keyboard
 * handler and the shortcuts panel all read this, so a relabelled tool or a
 * rebound key can never disagree with itself across three surfaces.
 */
export interface TimelineTrimToolSpec {
  mode: TimelineTrimMode;
  label: string;
  /** Display form of the shortcut, e.g. "⇧T". */
  shortcut: string;
  /** One line on what the tool does to the lane, shown in the tooltip. */
  hint: string;
}

export const TIMELINE_TRIM_TOOLS: readonly TimelineTrimToolSpec[] = [
  {
    mode: "ripple",
    label: "Ripple trim",
    shortcut: "T",
    hint: "Drag a clip edge. Every later clip on the track follows, so no gap opens.",
  },
  {
    mode: "roll",
    label: "Roll edit",
    shortcut: "⇧T",
    hint: "Drag the cut between two clips. One grows by exactly what the other gives up.",
  },
  {
    mode: "slip",
    label: "Slip",
    shortcut: "Y",
    hint: "Drag inside a clip to slide the media behind it. The clip stays put, a different part of the source plays.",
  },
  {
    mode: "slide",
    label: "Slide",
    shortcut: "⇧Y",
    hint: "Drag a clip along the track. Its neighbours absorb the move.",
  },
];

/**
 * Keyboard bindings, paired by what the tool acts on: T/⇧T move an edit point,
 * Y/⇧Y move the media inside one. Keyed by `"shift+"`-prefixed lowercase key.
 */
export const TRIM_TOOL_KEYS: Readonly<Record<string, TimelineTrimMode>> = {
  t: "ripple",
  "shift+t": "roll",
  y: "slip",
  "shift+y": "slide",
};

/**
 * Which tool grabs which part of a clip. Ripple and roll act on an edit point,
 * so they live on the trim handles; slip and slide re-time the whole clip, so
 * their handle is the clip body. One owner for that matrix, because the
 * pointerdown path has to answer it for both surfaces.
 */
export function trimToolFor(tool: TimelineTool, surface: "edge" | "body"): TimelineTrimMode | null {
  const mode = activeTrimMode(tool);
  if (!mode) return null;
  const belongsOnEdge = mode === "ripple" || mode === "roll";
  return belongsOnEdge === (surface === "edge") ? mode : null;
}
