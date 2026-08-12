/**
 * The capture setup both preview generators need, in one place.
 *
 * They diverged only in how they picked width and height, so keeping two copies
 * meant the opaque-capture rationale below had to be re-derived, and re-read,
 * every time either script changed.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
// Import from source — bun workspace linking doesn't resolve for scripts outside packages/.
import {
  createFileServer,
  createCaptureSession,
  initializeSession,
  getCompositionDuration,
} from "../packages/producer/src/index.js";

const FPS = { num: 30, den: 1 } as const;

/** Duration to assume when the composition does not report one. */
const FALLBACK_DURATION_SECONDS = 5;

export interface OpaqueCapture {
  fileServer: Awaited<ReturnType<typeof createFileServer>>;
  session: Awaited<ReturnType<typeof createCaptureSession>>;
  /** Seconds. Falls back to {@link FALLBACK_DURATION_SECONDS}. */
  duration: number;
}

/**
 * Serve `projectDir`, open a capture session over it and read its duration.
 *
 * Capture is opaque on purpose. `format: "png"` is the engine's TRANSPARENT
 * mode: it forces `background-image: none !important` on every
 * `[data-composition-id]`, so any composition painting its own backdrop (the
 * VS Code snippets sit on a desktop wallpaper) loses it and the poster comes
 * out empty. These posters are page images, never a compositing layer, so
 * capture opaque and transcode to the .png the pages reference.
 *
 * The caller owns both handles and must close them.
 */
export async function openOpaqueCapture(params: {
  projectDir: string;
  width: number;
  height: number;
}): Promise<OpaqueCapture> {
  const framesDir = join(params.projectDir, "_thumb_frames");
  mkdirSync(framesDir, { recursive: true });

  const fileServer = await createFileServer({ projectDir: params.projectDir, port: 0, fps: FPS });
  try {
    const session = await createCaptureSession(fileServer.url, framesDir, {
      width: params.width,
      height: params.height,
      fps: FPS,
      format: "jpeg",
      quality: 95,
    });
    await initializeSession(session);

    let duration: number;
    try {
      duration = await getCompositionDuration(session);
    } catch {
      duration = FALLBACK_DURATION_SECONDS;
    }
    return { fileServer, session, duration };
  } catch (error) {
    // The session never reached the caller, so nothing else will close the
    // server this function opened.
    fileServer.close();
    throw error;
  }
}
