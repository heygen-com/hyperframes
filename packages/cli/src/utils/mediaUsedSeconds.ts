import { parseHTML } from "linkedom";

const number = (value: string | null | undefined): number | undefined => {
  const parsed = Number(value);
  return value !== null && value !== undefined && value.trim() !== "" && Number.isFinite(parsed)
    ? parsed
    : undefined;
};

/** `clip.mov?x#y`, `./clip.mov` and `/clip.mov` all name the file `/clip.mov`. */
function pathnameOf(src: string): string {
  const bare = src
    .replace(/[?#].*$/, "")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  try {
    return `/${decodeURIComponent(bare)}`;
  } catch {
    return `/${bare}`;
  }
}

function plannedDuration(video: Element): number | undefined {
  for (let node: Element | null = video; node; node = node.parentElement) {
    const duration = number(node.getAttribute("data-duration"));
    if (duration !== undefined) return duration;
  }
  return undefined;
}

/**
 * How many seconds from the start of each file the composition can play, by pathname. A file is
 * left out (play it whole) unless every `<video>` naming it plays a known stretch: no loop, a
 * `data-duration` on the video or an ancestor, and nothing but `<video>` elements naming it.
 * Rate and offsets only ever round the answer up.
 */
export function mediaUsedSeconds(html: string): Map<string, number> {
  const { document } = parseHTML(html);
  const used = new Map<string, number>();
  const whole = new Set<string>();
  for (const element of document.querySelectorAll("[src]")) {
    const pathname = pathnameOf(element.getAttribute("src") ?? "");
    const video = element.tagName === "VIDEO" ? element : null;
    const duration = video ? plannedDuration(video) : undefined;
    if (!video || duration === undefined || video.hasAttribute("loop")) {
      whole.add(pathname);
      continue;
    }
    const rate = Math.max(1, number(video.getAttribute("data-playback-rate")) ?? 1);
    const offset =
      (number(video.getAttribute("data-media-start")) ?? 0) +
      (number(video.getAttribute("data-playback-start")) ?? 0);
    used.set(pathname, Math.max(used.get(pathname) ?? 0, offset + duration * rate));
  }
  for (const pathname of whole) used.delete(pathname);
  return used;
}
