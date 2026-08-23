export type AuthoredTimingValue = string | number | null | undefined;

export interface RawAuthoredTiming {
  start?: AuthoredTimingValue;
  duration?: AuthoredTimingValue;
  authoredDuration?: AuthoredTimingValue;
  end?: AuthoredTimingValue;
  authoredEnd?: AuthoredTimingValue;
}

export interface AuthoredTimingWindow {
  start: number;
  duration: number | null;
  end: number | null;
}

function finiteNumber(value: AuthoredTimingValue): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveAuthoredTimingWindow(
  values: RawAuthoredTiming,
): AuthoredTimingWindow | null {
  const parsedStart = finiteNumber(values.start);
  if (parsedStart == null) return null;
  const start = Math.max(0, parsedStart);

  const publicDuration = finiteNumber(values.duration);
  const preservedDuration = finiteNumber(values.authoredDuration);
  const duration =
    publicDuration != null && publicDuration > 0
      ? publicDuration
      : preservedDuration != null && preservedDuration > 0
        ? preservedDuration
        : null;
  if (duration != null) return { start, duration, end: start + duration };

  const publicEnd = finiteNumber(values.end);
  const preservedEnd = finiteNumber(values.authoredEnd);
  const end =
    publicEnd != null && publicEnd > start
      ? publicEnd
      : preservedEnd != null && preservedEnd > start
        ? preservedEnd
        : null;
  return { start, duration: end == null ? null : end - start, end };
}
