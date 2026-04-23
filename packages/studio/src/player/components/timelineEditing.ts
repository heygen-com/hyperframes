import { formatTime } from "../lib/time";

const TIME_PRECISION = 100;

function roundToCentiseconds(value: number): number {
  return Math.round(value * TIME_PRECISION) / TIME_PRECISION;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const EDGE_TRACK_CREATE_THRESHOLD = 0.55;
const AUTO_SCROLL_EDGE_ZONE = 40;
const AUTO_SCROLL_MAX_SPEED = 12;

export interface TimelineMoveInput {
  start: number;
  track: number;
  duration: number;
  originClientX: number;
  originClientY: number;
  originScrollLeft?: number;
  originScrollTop?: number;
  currentScrollLeft?: number;
  currentScrollTop?: number;
  pixelsPerSecond: number;
  trackHeight: number;
  maxStart: number;
  trackOrder: number[];
}

export interface TimelineResizeInput {
  start: number;
  duration: number;
  originClientX: number;
  pixelsPerSecond: number;
  minStart: number;
  maxEnd: number;
  minDuration?: number;
  playbackStart?: number;
  playbackRate?: number;
}

export interface TimelineAutoScrollBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function resolveTimelineAutoScroll(
  bounds: TimelineAutoScrollBounds,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const getAxisDelta = (start: number, end: number, pointer: number) => {
    if (pointer < start + AUTO_SCROLL_EDGE_ZONE) {
      const proximity = Math.max(0, 1 - (pointer - start) / AUTO_SCROLL_EDGE_ZONE);
      return -Math.round(AUTO_SCROLL_MAX_SPEED * proximity);
    }
    if (pointer > end - AUTO_SCROLL_EDGE_ZONE) {
      const proximity = Math.max(0, 1 - (end - pointer) / AUTO_SCROLL_EDGE_ZONE);
      return Math.round(AUTO_SCROLL_MAX_SPEED * proximity);
    }
    return 0;
  };

  return {
    x: getAxisDelta(bounds.left, bounds.right, clientX),
    y: getAxisDelta(bounds.top, bounds.bottom, clientY),
  };
}

export function resolveTimelineMove(
  input: TimelineMoveInput,
  clientX: number,
  clientY: number,
): { start: number; track: number } {
  const scrollDeltaX = (input.currentScrollLeft ?? 0) - (input.originScrollLeft ?? 0);
  const scrollDeltaY = (input.currentScrollTop ?? 0) - (input.originScrollTop ?? 0);
  const deltaTime =
    (clientX - input.originClientX + scrollDeltaX) / Math.max(input.pixelsPerSecond, 1);
  const trackDeltaRaw =
    (clientY - input.originClientY + scrollDeltaY) / Math.max(input.trackHeight, 1);
  const deltaTrack = Math.round(trackDeltaRaw);
  const currentTrackIndex = Math.max(0, input.trackOrder.indexOf(input.track));
  const desiredTrackIndex = currentTrackIndex + deltaTrack;
  const nextTrackIndex = clamp(desiredTrackIndex, 0, Math.max(0, input.trackOrder.length - 1));
  const minTrack = Math.min(...input.trackOrder);
  const maxTrack = Math.max(...input.trackOrder);
  let nextTrack = input.trackOrder[nextTrackIndex] ?? input.track;

  const startedOnFirstTrack = currentTrackIndex === 0;
  const startedOnLastTrack = currentTrackIndex === input.trackOrder.length - 1;

  if (
    startedOnFirstTrack &&
    desiredTrackIndex < 0 &&
    currentTrackIndex + trackDeltaRaw <= -EDGE_TRACK_CREATE_THRESHOLD
  ) {
    nextTrack = minTrack - 1;
  } else if (
    startedOnLastTrack &&
    desiredTrackIndex > input.trackOrder.length - 1 &&
    currentTrackIndex + trackDeltaRaw >= input.trackOrder.length - 1 + EDGE_TRACK_CREATE_THRESHOLD
  ) {
    nextTrack = maxTrack + 1;
  }

  return {
    start: clamp(roundToCentiseconds(input.start + deltaTime), 0, Math.max(0, input.maxStart)),
    track: nextTrack,
  };
}

export function buildTrackZIndexMap(tracks: number[]): Map<number, number> {
  const uniqueTracks = Array.from(new Set(tracks)).sort((a, b) => a - b);
  const maxZIndex = uniqueTracks.length;
  return new Map(uniqueTracks.map((track, index) => [track, maxZIndex - index]));
}

export function resolveTimelineResize(
  input: TimelineResizeInput,
  edge: "start" | "end",
  clientX: number,
): { start: number; duration: number; playbackStart?: number } {
  const minDuration = Math.max(0.05, input.minDuration ?? 0.1);
  const deltaTime = (clientX - input.originClientX) / Math.max(input.pixelsPerSecond, 1);

  if (edge === "end") {
    const nextDuration = clamp(
      roundToCentiseconds(input.duration + deltaTime),
      minDuration,
      Math.max(minDuration, input.maxEnd - input.start),
    );
    return {
      start: input.start,
      duration: nextDuration,
      playbackStart: input.playbackStart,
    };
  }

  const playbackRate = Math.max(0.1, input.playbackRate ?? 1);
  const maxLeftExtensionFromMedia =
    input.playbackStart != null ? input.playbackStart / playbackRate : Number.POSITIVE_INFINITY;
  const minDelta = -Math.min(input.start - input.minStart, maxLeftExtensionFromMedia);
  const maxDelta = input.duration - minDuration;
  const clampedDelta = clamp(deltaTime, minDelta, maxDelta);
  const nextStart = roundToCentiseconds(input.start + clampedDelta);
  const nextDuration = roundToCentiseconds(input.duration - clampedDelta);
  const nextPlaybackStart =
    input.playbackStart != null
      ? roundToCentiseconds(Math.max(0, input.playbackStart + clampedDelta * playbackRate))
      : undefined;

  return {
    start: nextStart,
    duration: nextDuration,
    playbackStart: nextPlaybackStart,
  };
}

export interface TimelinePromptElement {
  id: string;
  tag: string;
  start: number;
  duration: number;
  track: number;
}

export interface TimelineEditCapabilities {
  canMove: boolean;
  canTrimStart: boolean;
  canTrimEnd: boolean;
}

export type BlockedTimelineEditIntent = "move" | "resize-start" | "resize-end";

export interface TimelineRangeSelection {
  start: number;
  end: number;
  anchorX: number;
  anchorY: number;
}

function isDeterministicTimelineWindow(input: {
  tag: string;
  compositionSrc?: string;
  playbackStartAttr?: "media-start" | "playback-start";
  sourceDuration?: number;
}): boolean {
  if (input.compositionSrc) return true;
  if (input.playbackStartAttr != null) return true;
  if (
    input.sourceDuration != null &&
    Number.isFinite(input.sourceDuration) &&
    input.sourceDuration > 0
  ) {
    return true;
  }
  const normalizedTag = input.tag.toLowerCase();
  return ["video", "audio", "img"].includes(normalizedTag);
}

export function hasPatchableTimelineTarget(input: { domId?: string; selector?: string }): boolean {
  return Boolean(input.domId || input.selector);
}

export function canOffsetTrimClipStart(input: {
  tag: string;
  playbackStart?: number;
  playbackStartAttr?: "media-start" | "playback-start";
  sourceDuration?: number;
}): boolean {
  if (input.playbackStartAttr != null) return true;
  if (input.playbackStart != null) return true;
  const normalizedTag = input.tag.toLowerCase();
  return ["video", "audio"].includes(normalizedTag);
}

export function getTimelineEditCapabilities(input: {
  tag: string;
  duration: number;
  domId?: string;
  selector?: string;
  compositionSrc?: string;
  playbackStart?: number;
  playbackStartAttr?: "media-start" | "playback-start";
  sourceDuration?: number;
}): TimelineEditCapabilities {
  const canPatch = hasPatchableTimelineTarget(input);
  const hasFiniteDuration = Number.isFinite(input.duration) && input.duration > 0;
  const hasDeterministicWindow = isDeterministicTimelineWindow(input);
  return {
    canMove: canPatch && hasDeterministicWindow,
    canTrimEnd: canPatch && hasFiniteDuration && hasDeterministicWindow,
    canTrimStart: canPatch && hasFiniteDuration && canOffsetTrimClipStart(input),
  };
}

export function resolveBlockedTimelineEditIntent(input: {
  width: number;
  offsetX: number;
  handleWidth: number;
  capabilities: TimelineEditCapabilities;
}): BlockedTimelineEditIntent | null {
  if (input.capabilities.canMove) {
    return null;
  }

  const safeWidth = Math.max(0, input.width);
  const safeOffsetX = clamp(input.offsetX, 0, safeWidth);
  const safeHandleWidth = Math.max(0, input.handleWidth);

  if (safeOffsetX <= safeHandleWidth && !input.capabilities.canTrimStart) {
    return "resize-start";
  }
  if (safeOffsetX >= Math.max(0, safeWidth - safeHandleWidth) && !input.capabilities.canTrimEnd) {
    return "resize-end";
  }
  return "move";
}

export function buildClipRangeSelection(
  clip: { start: number; duration: number },
  anchor: { anchorX: number; anchorY: number },
): TimelineRangeSelection {
  return {
    start: clip.start,
    end: clip.start + clip.duration,
    anchorX: anchor.anchorX,
    anchorY: anchor.anchorY,
  };
}

export function buildTimelineAgentPrompt({
  rangeStart,
  rangeEnd,
  elements,
  prompt,
}: {
  rangeStart: number;
  rangeEnd: number;
  elements: TimelinePromptElement[];
  prompt: string;
}): string {
  const start = Math.min(rangeStart, rangeEnd);
  const end = Math.max(rangeStart, rangeEnd);
  const elementLines = elements
    .map(
      (el) =>
        `- #${el.id} (${el.tag}) — ${formatTime(el.start)} to ${formatTime(el.start + el.duration)}, track ${el.track}`,
    )
    .join("\n");

  return `Edit the following HyperFrames composition:

Time range: ${formatTime(start)} — ${formatTime(end)}

Elements in range:
${elementLines || "(none)"}

User request:
${prompt.trim() || "(no prompt provided)"}

Instructions:
Modify only the elements listed above within the specified time range.
The composition uses HyperFrames data attributes (data-start, data-duration, data-track-index) and GSAP for animations.
Preserve all other elements and timing outside this range.`;
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
    `- track: ${element.track}`,
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

export function formatTimelineAttributeNumber(value: number): string {
  return Number(roundToCentiseconds(value).toFixed(2)).toString();
}
