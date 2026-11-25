import type { Fps } from "@hyperframes/core";
import type { CapturePlan } from "./capturePlan.js";

/** A part of the film in seconds of the film; the output starts at 0. No end = to the film's end. */
export interface RenderRange {
  startSeconds: number;
  endSeconds?: number;
}

/** The film frames `[startFrame, endFrame)` a render captures. */
export interface FrameWindow {
  startFrame: number;
  endFrame: number;
}

/** The frames a range covers at an exact frame rate; an end past the film stops at the film's end. */
export function resolveFrameWindow(range: RenderRange, fps: Fps, filmFrames: number): FrameWindow {
  const frameAt = (seconds: number) => Math.round((seconds * fps.num) / fps.den);
  const startFrame = frameAt(range.startSeconds);
  const endFrame = Math.min(
    range.endSeconds === undefined ? filmFrames : frameAt(range.endSeconds),
    filmFrames,
  );
  if (!(endFrame > startFrame)) {
    throw new Error(
      `The range ${range.startSeconds}s to ${range.endSeconds ?? "the end"}s holds no frame: the film has ` +
        `${filmFrames} frames at ${fps.num}/${fps.den} fps.`,
    );
  }
  return { startFrame, endFrame };
}

export function windowStartFrame(frameWindow: FrameWindow | undefined): number {
  return frameWindow?.startFrame ?? 0;
}

/** The disk and layered routes capture a frame window; the streaming routes render whole films. */
export function assertRangeSupported(
  frameWindow: FrameWindow | undefined,
  route: CapturePlan["kind"],
): void {
  if (!frameWindow || route === "sdr_disk" || route === "hdr_layered") return;
  throw new Error(
    `This composition renders on the "${route}" capture route, which renders the whole film only; ` +
      "render it without a start or end.",
  );
}
