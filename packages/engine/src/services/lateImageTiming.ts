/** The PerformanceResourceTiming fields a late image's record is built from, read in the page. */
export interface RawResourceTiming {
  startTime: number;
  fetchStart: number;
  connectStart: number;
  connectEnd: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
}

/** Where a late image's load time went, with no host, query or file name. */
export interface LateImageRecord {
  from: "page-server" | "other-origin";
  pathDepth: number;
  extension: string;
  timing: LateImageTiming | "no-entry";
}

/** Another origin without Timing-Allow-Origin zeroes the request fields, so only the total is known. */
type LateImageTiming =
  | {
      requestedAtMs: number;
      totalMs: number;
      queuedMs: number;
      connectMs: number;
      firstByteMs: number;
      downloadMs: number;
    }
  | { requestedAtMs: number; totalMs: number; split: "not-exposed" };

const ms = (value: number) => Math.max(0, Math.round(value));

function splitTiming(raw: RawResourceTiming): LateImageTiming {
  const known = { requestedAtMs: ms(raw.startTime), totalMs: ms(raw.responseEnd - raw.startTime) };
  if (raw.requestStart === 0 || raw.responseStart === 0) return { ...known, split: "not-exposed" };
  const connectMs = raw.connectEnd - raw.connectStart;
  return {
    ...known,
    queuedMs: ms(raw.requestStart - raw.fetchStart - connectMs),
    connectMs: ms(connectMs),
    firstByteMs: ms(raw.responseStart - raw.requestStart),
    downloadMs: ms(raw.responseEnd - raw.responseStart),
  };
}

export function describeLateImage(
  src: string,
  pageOrigin: string,
  raw: RawResourceTiming | undefined,
): LateImageRecord {
  const url = URL.canParse(src) ? new URL(src) : undefined;
  const segments = url?.pathname.split("/").filter(Boolean) ?? [];
  const name = segments.at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return {
    from: url?.origin === pageOrigin ? "page-server" : "other-origin",
    pathDepth: segments.length,
    extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : "",
    timing: raw ? splitTiming(raw) : "no-entry",
  };
}
