// text_over_face: text painted in front of a video, over a face in it. The page reports the text's
// word boxes and where the video's frame lands (layout-audit.browser.js); the faces come from the
// file itself, with the detector `measure face` uses, because headless Chrome has none.
import type {
  AnchoredLayoutIssue,
  CheckBbox,
  FaceCheck,
  TextOverVideoCandidate,
} from "./checkTypes.js";
import { normalizeErrorMessage } from "./errorMessage.js";

/** Below this share of the face a descender or a letter's corner touches it, which hides nothing. */
export const FACE_COVER_REPORT = 0.05;
/** From about a third of the face, an eye or the mouth is under the text. */
export const FACE_COVER_WARNING = 0.3;
// A face the video's own box crops to less than half is not one the viewer is shown.
const FACE_SHOWN_MIN = 0.5;
const MESSAGE_TEXT_MAX = 40;

type VideoPlacement = Pick<TextOverVideoCandidate["video"], "box" | "frame" | "flipX" | "flipY">;

/** Each asked media time's frame, and that frame's faces as [x, y, w, h] shares of it. */
export type FaceFinder = (
  file: string,
  times: number[],
) => Promise<Map<number, { frame: number; boxes: number[][] }>>;

const area = (box: CheckBbox) => box.width * box.height;

function intersect(a: CheckBbox, b: CheckBbox): CheckBbox | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** A face given in shares of the video frame, in canvas pixels, cut to what the video's box shows. */
export function faceRectOnCanvas(face: readonly number[], video: VideoPlacement): CheckBbox | null {
  const [fx = 0, fy = 0, fw = 0, fh = 0] = face;
  const { frame } = video;
  const whole = {
    x: frame.x + (video.flipX ? 1 - fx - fw : fx) * frame.width,
    y: frame.y + (video.flipY ? 1 - fy - fh : fy) * frame.height,
    width: fw * frame.width,
    height: fh * frame.height,
  };
  const shown = intersect(whole, video.box);
  return shown && area(shown) >= FACE_SHOWN_MIN * area(whole) ? shown : null;
}

/** The share of `face` under the union of `rects`: overlapping word boxes count once. */
export function coveredShare(rects: readonly CheckBbox[], face: CheckBbox): number {
  const inside = rects.flatMap((rect) => intersect(rect, face) ?? []);
  const edges = [...new Set(inside.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort(
    (a, b) => a - b,
  );
  let covered = 0;
  edges.slice(1).forEach((right, index) => {
    const left = edges[index] ?? right;
    const spans = inside
      .filter((rect) => rect.x <= left && rect.x + rect.width >= right)
      .map((rect) => ({ top: rect.y, bottom: rect.y + rect.height }))
      .sort((a, b) => a.top - b.top);
    let reached = Number.NEGATIVE_INFINITY;
    for (const { top, bottom } of spans) {
      if (bottom <= reached) continue;
      covered += (bottom - Math.max(top, reached)) * (right - left);
      reached = bottom;
    }
  });
  return area(face) > 0 ? covered / area(face) : 0;
}

export function faceCoverSeverity(coveredFraction: number): "warning" | "info" | null {
  if (coveredFraction < FACE_COVER_REPORT) return null;
  return coveredFraction >= FACE_COVER_WARNING ? "warning" : "info";
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function quoted(text: string): string {
  return `"${text.length > MESSAGE_TEXT_MAX ? `${text.slice(0, MESSAGE_TEXT_MAX - 3)}...` : text}"`;
}

/** The finding for the face this text covers most, or none when it covers no face enough. */
export function textOverFaceIssue(
  candidate: TextOverVideoCandidate,
  faces: readonly (readonly number[])[],
): AnchoredLayoutIssue[] {
  let most: { faceRect: CheckBbox; coveredFraction: number } | null = null;
  for (const face of faces) {
    const faceRect = faceRectOnCanvas(face, candidate.video);
    if (!faceRect) continue;
    const coveredFraction = round2(coveredShare(candidate.wordRects, faceRect));
    if (!most || coveredFraction > most.coveredFraction) most = { faceRect, coveredFraction };
  }
  const severity = most ? faceCoverSeverity(most.coveredFraction) : null;
  if (!most || !severity) return [];
  const { faceRect, coveredFraction } = most;
  return [
    {
      code: "text_over_face",
      severity,
      time: candidate.time,
      selector: candidate.selector,
      containerSelector: candidate.video.selector,
      text: candidate.text,
      message: `${quoted(candidate.text)} covers ${Math.round(coveredFraction * 100)}% of a face in the video beneath it.`,
      rect: candidate.rect,
      coveredFraction,
      faceRect: {
        x: round2(faceRect.x),
        y: round2(faceRect.y),
        width: round2(faceRect.width),
        height: round2(faceRect.height),
      },
      fixHint:
        "Move the text off the face, or mark an intended overlap with data-layout-allow-on-face.",
      dataAttributes: candidate.dataAttributes,
      sourceFile: candidate.sourceFile,
      bbox: candidate.bbox,
    },
  ];
}

// Loaded on first use: a check with no text in front of a video never pays for OpenCV.
const facesInFile: FaceFinder = async (file, times) => {
  const [{ faceBoxesAt }, { frameAt, probeVideo }] = await Promise.all([
    import("../measure/face.js"),
    import("../measure/media.js"),
  ]);
  const info = probeVideo(file);
  const frameOf = (time: number) => Math.min(Math.max(0, info.frames - 1), frameAt(time, info.fps));
  const frames = [...new Set(times.map(frameOf))].sort((a, b) => a - b);
  const found = await faceBoxesAt(info, frames);
  // A frame that did not decode shifts every later one, so the boxes no longer belong to their times.
  if (found.length !== frames.length) throw new Error(`could not read every frame of ${file}`);
  const byFrame = new Map(found.map((sample) => [sample.frame, sample.boxes]));
  return new Map(
    times.map((time) => [time, { frame: frameOf(time), boxes: byFrame.get(frameOf(time)) ?? [] }]),
  );
};

/**
 * The text_over_face findings for what the page saw in front of videos, and whether the pass
 * could look. Each video file is read once, for the distinct frames its samples landed on. A file
 * or a detector that cannot be read costs the finding, never the check: stderr says so in one line.
 */
export async function findTextOverFace(
  candidates: readonly TextOverVideoCandidate[],
  facesIn: FaceFinder = facesInFile,
  onFile: () => void = () => {},
): Promise<{ issues: AnchoredLayoutIssue[]; faceCheck: FaceCheck }> {
  const timesByFile = new Map<string, Set<number>>();
  for (const { video } of candidates) {
    const times = timesByFile.get(video.file) ?? new Set<number>();
    timesByFile.set(video.file, times.add(video.mediaTime));
  }
  const faces = new Map<string, Awaited<ReturnType<FaceFinder>>>();
  const unread: string[] = [];
  for (const [file, times] of timesByFile) {
    onFile();
    try {
      faces.set(file, await facesIn(file, [...times]));
    } catch (error) {
      unread.push(normalizeErrorMessage(error));
    }
  }
  const reason = unread[0];
  if (reason !== undefined) {
    console.error(
      `[hyperframes] check: text over a face was not looked for in ${unread.length} of ${timesByFile.size} video(s): ${reason}`,
    );
    if (faces.size === 0) return { issues: [], faceCheck: { ran: false, reason } };
  }
  const framesWithFace = new Set<string>();
  for (const [file, byTime] of faces) {
    for (const { frame, boxes } of byTime.values()) {
      if (boxes.length > 0) framesWithFace.add(`${file}\0${frame}`);
    }
  }
  const issues = candidates.flatMap((candidate) =>
    textOverFaceIssue(
      candidate,
      faces.get(candidate.video.file)?.get(candidate.video.mediaTime)?.boxes ?? [],
    ),
  );
  return {
    // Worst first: a finding collapsed over time keeps the numbers of its first sample.
    issues: issues.sort((a, b) => (b.coveredFraction ?? 0) - (a.coveredFraction ?? 0)),
    faceCheck: {
      ran: true,
      candidates: candidates.length,
      faces: framesWithFace.size,
      ...(unread.length > 0 ? { unreadVideos: unread.length } : {}),
    },
  };
}
