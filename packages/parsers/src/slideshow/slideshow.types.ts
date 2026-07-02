// packages/core/src/slideshow/slideshow.types.ts

/** Current manifest schema version. Stamped on persist so future schema
 *  changes can detect and migrate older islands. */
export const SLIDESHOW_MANIFEST_VERSION = 1;

/** Raw author-facing shapes parsed from the JSON island. */
export interface SlideshowManifest {
  /** Schema version (absent on pre-versioning islands → treat as 1). */
  version?: number;
  slides: SlideRef[];
  slideSequences?: SlideSequence[];
}

export interface SlideRef {
  sceneId: string;
  startTime?: number;
  endTime?: number;
  notes?: string;
  fragments?: number[];
  hotspots?: SlideHotspot[];
  /**
   * When true, the slide's first `<video>` plays automatically on enter (the
   * presenter lands on the slide and the clip plays). The slideshow still holds
   * — it never auto-advances — so the presenter clicks Next when ready.
   * Defaults to false. Use it when the video is the slide's primary content and
   * its natural end is the cue to advance, not for background/ambient clips.
   */
  autoplay?: boolean;
  // Reserved — TTS deferred. Parsed and carried, never consumed.
  ttsScript?: string;
  ttsAudioUrl?: string;
  ttsDurationMs?: number;
}

export interface SlideHotspot {
  id: string;
  label: string;
  target: string; // references a SlideSequence.id
  region?: { x: number; y: number; w: number; h: number }; // % of slide
}

export interface SlideSequence {
  id: string;
  label: string;
  slides: SlideRef[];
}

/** A slide with its time range resolved from the matching scene. */
export interface ResolvedSlide extends SlideRef {
  start: number;
  end: number;
  fragments: number[]; // always present, sorted, defaulted to []
  hotspots: SlideHotspot[]; // always present, defaulted to []
}

export interface ResolvedSlideSequence {
  id: string;
  label: string;
  slides: ResolvedSlide[];
}

export interface ResolvedSlideshow {
  slides: ResolvedSlide[];
  sequences: Record<string, ResolvedSlideSequence>; // keyed by sequence id
}
