/**
 * Bounded raw-frame storage for one HDR video: fixed windows of frames, extracted on first lease,
 * least-recently-used evicted past `maxResident`. A leased window is never evicted.
 */
import { closeSync, constants, openSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface HdrFrameLease {
  fd: number;
  offset: number;
  release(): void;
}

export interface HdrWindowSpec {
  firstFrame: number;
  frames: number;
  path: string;
}

export interface HdrFrameWindows {
  readonly totalFrames: number;
  lease(frameIndex: number): Promise<HdrFrameLease | null>;
  close(): void;
}

interface Window {
  firstFrame: number;
  path: string;
  frames: number;
  fd: number;
  pins: number;
  ready: Promise<void>;
}

export function createHdrFrameWindows(opts: {
  dir: string;
  frameSize: number;
  totalFrames: number;
  windowFrames: number;
  maxResident: number;
  extract: (spec: HdrWindowSpec) => Promise<number>;
}): HdrFrameWindows {
  const { dir, frameSize, windowFrames, maxResident, extract } = opts;
  let totalFrames = opts.totalFrames;
  // Map order is recency order: a leased window moves to the end.
  const windows = new Map<number, Window>();

  const drop = (index: number, w: Window): void => {
    windows.delete(index);
    if (w.fd >= 0) closeSync(w.fd);
    rmSync(w.path, { force: true });
  };

  const open = (index: number): Window => {
    const known = windows.get(index);
    if (known) {
      windows.delete(index);
      windows.set(index, known);
      return known;
    }
    for (const [i, w] of windows) {
      if (windows.size < maxResident) break;
      if (w.pins === 0) drop(i, w);
    }
    const firstFrame = index * windowFrames;
    const w: Window = {
      firstFrame,
      path: join(dir, `window-${index}.rgb48le`),
      frames: 0,
      fd: -1,
      pins: 0,
      ready: Promise.resolve(),
    };
    w.ready = extract({
      firstFrame,
      frames: Math.min(windowFrames, totalFrames - firstFrame),
      path: w.path,
    }).then((produced) => {
      if (produced < 1) return;
      w.fd = openSync(w.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      w.frames = produced;
    });
    windows.set(index, w);
    return w;
  };

  return {
    get totalFrames() {
      return totalFrames;
    },
    async lease(frameIndex) {
      for (;;) {
        if (totalFrames < 1) return null;
        const index = Math.min(Math.max(0, frameIndex), totalFrames - 1);
        const key = Math.floor(index / windowFrames);
        const w = open(key);
        w.pins += 1;
        try {
          await w.ready;
        } catch (error) {
          w.pins -= 1;
          windows.delete(key);
          throw error;
        }
        const local = index - w.firstFrame;
        if (local < w.frames) {
          return {
            fd: w.fd,
            offset: local * frameSize,
            release: () => {
              w.pins -= 1;
            },
          };
        }
        // The source ended inside or before this window: hold its last frame.
        w.pins -= 1;
        totalFrames = Math.min(totalFrames, w.firstFrame + w.frames);
      }
    },
    close() {
      for (const [i, w] of [...windows]) drop(i, w);
    },
  };
}
