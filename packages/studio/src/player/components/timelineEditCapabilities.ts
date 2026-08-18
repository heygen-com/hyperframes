export interface TimelineEditCapabilities {
  canMove: boolean;
  canTrimStart: boolean;
  canTrimEnd: boolean;
}

function isDeterministicTimelineWindow(input: {
  tag: string;
  kind?: "video" | "audio" | "image" | "element" | "composition";
  compositionSrc?: string;
  playbackStartAttr?: "media-start" | "playback-start";
  sourceDuration?: number;
}): boolean {
  if (input.kind === "composition" || input.compositionSrc || input.playbackStartAttr != null)
    return true;
  if (
    input.sourceDuration != null &&
    Number.isFinite(input.sourceDuration) &&
    input.sourceDuration > 0
  ) {
    return true;
  }
  return ["video", "audio", "img"].includes(input.tag.toLowerCase());
}

export function hasPatchableTimelineTarget(input: {
  domId?: string;
  selector?: string;
  hfId?: string;
}): boolean {
  // hfId counts as a stable target: Studio stamps data-hf-id into the source and
  // findElementForSelection resolves it before id/selector, so a clip carrying only
  // an hfId is just as patchable as one with an author-written id. Omitting it here
  // made those clips report canMove:false and surface "This clip can't be moved or
  // resized from the timeline yet", even though the write path fully supported them.
  return Boolean(input.domId || input.selector || input.hfId);
}

export function getTimelineEditCapabilities(input: {
  tag: string;
  kind?: "video" | "audio" | "image" | "element" | "composition";
  duration: number;
  domId?: string;
  selector?: string;
  hfId?: string;
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
