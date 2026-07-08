const SEEK_TIMEOUT_MS = 500;

/** Map a composition time to a media element's local time. */
export function mediaLocalTime(start: number, mediaStart: number, timeSeconds: number): number {
  return timeSeconds - start + mediaStart;
}

function parseTime(value: string | null): number {
  const parsed = value == null ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function seekOne(element: HTMLMediaElement, timeSeconds: number): Promise<void> {
  const local = mediaLocalTime(
    parseTime(element.getAttribute("data-start")),
    parseTime(element.getAttribute("data-media-start")),
    timeSeconds,
  );
  const outOfWindow = local < 0 || (Number.isFinite(element.duration) && local > element.duration);
  if (outOfWindow) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      element.removeEventListener("seeked", done);
      resolve();
    };
    element.addEventListener("seeked", done);
    // A media element that never fires seeked (detached src, decode error)
    // must not deadlock the whole export.
    setTimeout(done, SEEK_TIMEOUT_MS);
    element.currentTime = local;
  });
}

/**
 * Frame-align every <video> layer before rasterizing: unlike GSAP inline
 * styles, media element seeks are asynchronous, so the capture has to wait
 * for their seeked events.
 */
export async function seekMediaElements(scope: ParentNode, timeSeconds: number): Promise<void> {
  const media = Array.from(scope.querySelectorAll("video[src]")) as HTMLMediaElement[];
  await Promise.all(media.map((element) => seekOne(element, timeSeconds)));
}
