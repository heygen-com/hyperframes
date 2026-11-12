import {
  extractMediaMetadata,
  measureVideoShownBoxRanges,
  resolveProjectRelativeSrc,
  type ShownBox,
  type VideoElement,
} from "@hyperframes/engine";
import type { Page } from "puppeteer-core";
import type { ProducerLogger } from "../../logger.js";

/** Seconds between samples of a video's box; a 693 s film with one video is ~2.8k seeks. */
const SHOWN_BOX_STRIDE_S = 0.25;
/** A box that changes may peak between samples, so it gets this much more. A static box is exact. */
const MOVING_BOX_HEADROOM = 1.1;

/** Local videos whose source is larger than the canvas: only these can be extracted smaller. */
export async function oversizedVideos(
  videos: readonly VideoElement[],
  projectDir: string,
  compiledDir: string,
  canvas: { width: number; height: number },
): Promise<VideoElement[]> {
  const sized = await Promise.all(
    videos.map(async (video) => {
      if (/^https?:\/\//i.test(video.src)) return false;
      try {
        const path = resolveProjectRelativeSrc(video.src, projectDir, compiledDir);
        const { width, height } = await extractMediaMetadata(path);
        return width > canvas.width || height > canvas.height;
      } catch {
        return false; // extraction reports the unreadable source
      }
    }),
  );
  return videos.filter((_, index) => sized[index]);
}

/** Each video's first and last frame and every stride between, in composition seconds, ascending. */
export function shownBoxTimes(
  videos: readonly VideoElement[],
  fps: { num: number; den: number },
): number[] {
  const frame = fps.den / fps.num;
  const times = new Set<number>();
  for (const { start, end } of videos) {
    const last = Math.max(start, end - frame);
    for (let t = start; t < last; t += SHOWN_BOX_STRIDE_S) times.add(t);
    times.add(last);
  }
  return [...times].sort((a, b) => a - b);
}

/**
 * The box to extract each video at: the largest it is drawn at, plus headroom when it moves. Undefined when
 * the measure fails, and every video then keeps its full size.
 */
export async function measureLocalShownBoxes(
  page: Page,
  videos: readonly VideoElement[],
  fps: { num: number; den: number },
  log: ProducerLogger,
): Promise<Map<string, ShownBox> | undefined> {
  const times = shownBoxTimes(videos, fps);
  const startedAt = Date.now();
  try {
    const ranges = await measureVideoShownBoxRanges(
      page,
      videos.map((video) => video.id),
      times,
    );
    await page.evaluate(() =>
      (window as { __hf?: { seek?: (t: number) => void } }).__hf?.seek?.(0),
    );
    const boxes = new Map<string, ShownBox>();
    for (const [id, { largest, smallest }] of ranges) {
      const moves = largest.width !== smallest.width || largest.height !== smallest.height;
      const grow = moves ? MOVING_BOX_HEADROOM : 1;
      boxes.set(id, { width: largest.width * grow, height: largest.height * grow });
    }
    log.info("[Render] Measured the boxes videos are shown at", {
      videos: videos.length,
      boxed: boxes.size,
      seeks: times.length,
      elapsedMs: Date.now() - startedAt,
    });
    return boxes;
  } catch (error) {
    log.warn("[Render] Could not measure the boxes videos are shown at; extracting at full size", {
      error: error instanceof Error ? error.message : String(error),
      seeks: times.length,
      elapsedMs: Date.now() - startedAt,
    });
    return undefined;
  }
}
