export interface TimelineEditCapabilities {
  canMove: boolean;
  canTrimStart: boolean;
  canTrimEnd: boolean;
}

function isDeterministicTimelineWindow(input: {
  tag: string;
  compositionSrc?: string;
  playbackStartAttr?: "media-start" | "playback-start";
  sourceDuration?: number;
}): boolean {
  if (input.compositionSrc || input.playbackStartAttr != null) return true;
  if (
    input.sourceDuration != null &&
    Number.isFinite(input.sourceDuration) &&
    input.sourceDuration > 0
  ) {
    return true;
  }
  return ["video", "audio", "img"].includes(input.tag.toLowerCase());
}

export function hasPatchableTimelineTarget(input: { domId?: string; selector?: string }): boolean {
  return Boolean(input.domId || input.selector);
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
  timingSource?: "authored" | "implicit";
  timelineLocked?: boolean;
}): TimelineEditCapabilities {
  if (input.timingSource === "implicit" || input.timelineLocked) {
    return { canMove: false, canTrimStart: false, canTrimEnd: false };
  }

  const canPatch = hasPatchableTimelineTarget(input);
  const hasFiniteDuration = Number.isFinite(input.duration) && input.duration > 0;
  const hasDeterministicWindow = isDeterministicTimelineWindow(input);
  return {
    canMove: canPatch && (hasDeterministicWindow || hasFiniteDuration),
    canTrimEnd: canPatch && hasFiniteDuration,
    canTrimStart: canPatch && hasFiniteDuration,
  };
}
