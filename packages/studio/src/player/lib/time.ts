export const STUDIO_PREVIEW_FPS = 30;

export function formatTime(time: number): string {
  if (!Number.isFinite(time) || time < 0) return "0:00";
  const mins = Math.floor(time / 60);
  const secs = Math.floor(time % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function secondsToFrame(time: number, fps = STUDIO_PREVIEW_FPS): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round(time * fps);
}

export function frameToSeconds(frame: number, fps = STUDIO_PREVIEW_FPS): number {
  if (!Number.isFinite(frame) || frame <= 0) return 0;
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  return frame / fps;
}

export function stepFrameTime(time: number, deltaFrames: number, fps = STUDIO_PREVIEW_FPS): number {
  const currentFrame = secondsToFrame(time, fps);
  const nextFrame = Math.max(0, currentFrame + deltaFrames);
  return frameToSeconds(nextFrame, fps);
}

export function formatFrameTime(time: number, duration: number, fps = STUDIO_PREVIEW_FPS): string {
  const currentFrame = secondsToFrame(time, fps);
  const totalFrames = secondsToFrame(duration, fps);
  return `${currentFrame}f / ${totalFrames}f`;
}
