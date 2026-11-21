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
  timing:
    | {
        requestedAtMs: number;
        queuedMs: number;
        connectMs: number;
        firstByteMs: number;
        downloadMs: number;
      }
    | "no-entry";
}

const ms = (value: number) => Math.max(0, Math.round(value));

export function describeLateImage(
  src: string,
  pageOrigin: string,
  raw: RawResourceTiming | undefined,
): LateImageRecord {
  const url = new URL(src);
  const segments = url.pathname.split("/").filter(Boolean);
  const name = segments.at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  const connectMs = raw ? raw.connectEnd - raw.connectStart : 0;
  return {
    from: url.origin === pageOrigin ? "page-server" : "other-origin",
    pathDepth: segments.length,
    extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : "",
    timing: raw
      ? {
          requestedAtMs: ms(raw.startTime),
          queuedMs: ms(raw.requestStart - raw.fetchStart - connectMs),
          connectMs: ms(connectMs),
          firstByteMs: ms(raw.responseStart - raw.requestStart),
          downloadMs: ms(raw.responseEnd - raw.responseStart),
        }
      : "no-entry",
  };
}
