import type { ReactNode } from "react";
import { getTimelineTrackStyle, type TimelineTrackStyle } from "./timelineTheme";

export interface TrackVisualStyle extends TimelineTrackStyle {
  icon: ReactNode;
}

const ICON_BASE = "/icons/timeline";
function TimelineIcon({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      width={12}
      height={12}
      style={{ filter: "brightness(0) invert(1)" }}
      draggable={false}
    />
  );
}

const IconCaptions = <TimelineIcon src={`${ICON_BASE}/captions.svg`} />;
const IconImage = <TimelineIcon src={`${ICON_BASE}/image.svg`} />;
const IconMusic = <TimelineIcon src={`${ICON_BASE}/music.svg`} />;
const IconText = <TimelineIcon src={`${ICON_BASE}/text.svg`} />;
const IconComposition = <TimelineIcon src={`${ICON_BASE}/composition.svg`} />;
const IconAudio = <TimelineIcon src={`${ICON_BASE}/audio.svg`} />;

const ICONS: Record<string, ReactNode> = {
  video: IconImage,
  audio: IconMusic,
  img: IconImage,
  div: IconComposition,
  span: IconCaptions,
  p: IconText,
  h1: IconText,
  section: IconComposition,
  sfx: IconAudio,
};

export function getTrackStyle(tag: string): TrackVisualStyle {
  if (!tag) console.warn("[Timeline] getTrackStyle received empty tag, defaulting to div");
  const safeTag = tag || "div";
  const trackStyle = getTimelineTrackStyle(safeTag);
  const normalized = safeTag.toLowerCase();
  const icon =
    normalized.startsWith("h") && normalized.length === 2 && "123456".includes(normalized[1] ?? "")
      ? ICONS.h1
      : (ICONS[normalized] ?? IconComposition);
  return { ...trackStyle, icon };
}
