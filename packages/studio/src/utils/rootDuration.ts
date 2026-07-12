import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";

export function extendRootDurationInSource(source: string, newEnd: number): string {
  const rootDurMatch = source.match(
    /(<[^>]*data-composition-id="[^"]*"[^>]*data-duration=")([^"]*)(")/,
  );
  if (rootDurMatch) {
    const rootDur = parseFloat(rootDurMatch[2]!);
    if (newEnd > rootDur) {
      return source.replace(
        rootDurMatch[0],
        `${rootDurMatch[1]}${formatTimelineAttributeNumber(newEnd)}${rootDurMatch[3]}`,
      );
    }
  }
  return source;
}
