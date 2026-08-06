import { formatTime } from "../lib/time";
import type { TimelinePromptElement } from "./timelineEditing";

/**
 * The prompts a timeline edit request is written into.
 *
 * Tracks are named in AUTHORED space here, the `data-track-index` values the
 * agent will actually read and write. Studio packs those onto contiguous
 * display lanes, so on any composition with gaps the lane a user clicked and
 * the number in the file are different, and telling the agent the lane sends
 * it to the wrong element.
 */

/** What a clip is called when the agent goes looking for it in the file. */
function authoredTrackOf(element: TimelinePromptElement): number {
  return element.authoredTrack ?? element.track;
}

function describeElement(element: TimelinePromptElement): string {
  const from = formatTime(element.start);
  const to = formatTime(element.start + element.duration);
  return `- #${element.id} (${element.tag}) - ${from} to ${to}, track ${authoredTrackOf(element)}`;
}

export function buildTimelineAgentPrompt({
  rangeStart,
  rangeEnd,
  elements,
  prompt,
  track,
}: {
  rangeStart: number;
  rangeEnd: number;
  elements: TimelinePromptElement[];
  prompt: string;
  /**
   * The authored track the request is scoped to, when the user picked one.
   * This is what makes "add a clip here" answerable: without it the agent has
   * a time window and has to guess which track a new clip belongs on.
   */
  track?: number;
}): string {
  const start = Math.min(rangeStart, rangeEnd);
  const end = Math.max(rangeStart, rangeEnd);
  const elementLines = elements.map(describeElement).join("\n");
  const scope = track === undefined ? "" : `\nTrack: ${track} (data-track-index="${track}")\n`;
  const scopeInstruction =
    track === undefined
      ? ""
      : `\nThis request is about track ${track} only. Any element you add belongs on that track, with data-track-index="${track}". Leave every other track alone.`;

  return `Edit the following HyperFrames composition:

Time range: ${formatTime(start)} - ${formatTime(end)}
${scope}
Elements in range:
${elementLines || "(none)"}

User request:
${prompt.trim() || "(no prompt provided)"}

Instructions:
Modify only the elements listed above within the specified time range.
The composition uses HyperFrames data attributes (data-start, data-duration, data-track-index) and GSAP for animations.
Preserve all other elements and timing outside this range.${scopeInstruction}`;
}

export function buildPromptCopyText(prompt: string): string {
  return prompt.trim();
}

export function buildTimelineElementAgentPrompt(element: {
  id: string;
  tag: string;
  start: number;
  duration: number;
  track: number;
  authoredTrack?: number;
  sourceFile?: string;
  selector?: string;
  compositionSrc?: string;
}): string {
  const lines = [
    "Studio cannot directly move or resize this timeline clip because its visible timing is not fully controlled by patchable HTML timing attributes.",
    "",
    "Please update the source so the clip's actual visible timing stays consistent with the authored timeline.",
    "",
    "Clip:",
    `- id: ${element.id}`,
    `- tag: ${element.tag}`,
    `- time: ${formatTime(element.start)} to ${formatTime(element.start + element.duration)}`,
    `- track: ${element.authoredTrack ?? element.track}`,
  ];

  if (element.sourceFile) lines.push(`- source file: ${element.sourceFile}`);
  if (element.selector) lines.push(`- selector: ${element.selector}`);
  if (element.compositionSrc) lines.push(`- composition src: ${element.compositionSrc}`);

  lines.push(
    "",
    "If this clip is animated with GSAP or another JS timeline, update the authored animation timing there as well instead of only changing data-start/data-duration.",
  );

  return lines.join("\n");
}
