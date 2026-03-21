/**
 * @hyperframes/engine — Protocol Types
 *
 * The engine's page contract. Any web page that wants to be rendered
 * as video must expose `window.__hf` implementing the HfProtocol interface.
 */

// ── Seek Protocol ──────────────────────────────────────────────────────────────

/**
 * Declares a media element the engine should handle.
 *
 * Headless Chrome in BeginFrame mode cannot play <video> or produce audio.
 * The engine pre-extracts video frames and audio tracks from declared media
 * elements and handles injection/mixing automatically.
 */
export interface HfMediaElement {
  /** DOM id of the <video> or <audio> element */
  elementId: string;
  /** Source file path or URL */
  src: string;
  /** When in the composition this element appears (seconds) */
  startTime: number;
  /** When in the composition this element disappears (seconds) */
  endTime: number;
  /** Offset into the source file (seconds, default: 0) */
  mediaOffset?: number;
  /** Audio volume 0-1 (default: 1) */
  volume?: number;
  /** Whether this element has audio that should be extracted */
  hasAudio?: boolean;
}

/**
 * The seek protocol. The only contract between the engine and a page.
 *
 * The engine reads `duration` to calculate total frames, calls `seek(time)`
 * before each frame capture, and uses `media` (if provided) to handle
 * video frame injection and audio mixing.
 *
 * The engine does NOT care what animation framework drives the page.
 * GSAP, Framer Motion, CSS animations, Three.js — anything works as long
 * as `seek()` produces deterministic visual output for a given time.
 */
export interface HfProtocol {
  /** Total duration of the composition in seconds */
  duration: number;
  /** Seek to a specific time. Must produce deterministic visual output. */
  seek(time: number): void;
  /** Optional: media elements the engine should handle */
  media?: HfMediaElement[];
}

// ── Capture Types ──────────────────────────────────────────────────────────────

export interface CaptureOptions {
  width: number;
  height: number;
  fps: number;
  format?: "jpeg" | "png";
  quality?: number;
  deviceScaleFactor?: number;
}

export interface CaptureResult {
  frameIndex: number;
  time: number;
  path: string;
  captureTimeMs: number;
}

export interface CaptureBufferResult {
  buffer: Buffer;
  captureTimeMs: number;
}

export interface CapturePerfSummary {
  frames: number;
  avgTotalMs: number;
  avgSeekMs: number;
  avgBeforeCaptureMs: number;
  avgScreenshotMs: number;
}

// ── Global Augmentation ────────────────────────────────────────────────────────

declare global {
  interface Window {
    __hf?: HfProtocol;
  }
}
