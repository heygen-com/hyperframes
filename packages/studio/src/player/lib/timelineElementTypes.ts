/**
 * Timeline element + keyframe-cache shapes shared across the player store and
 * its ~70 consumers. Split out of `playerStore.ts` (re-exported from there
 * for backward compatibility) purely to keep that file under this repo's
 * per-file line-count convention — no behavior here, types only.
 */

/** Minimal keyframe cache types — mirrors GsapKeyframesData without pulling in Node-only gsap-parser. */
export interface KeyframeCacheEntry {
  format: string;
  keyframes: Array<{
    percentage: number;
    /** Original tween-relative percentage (server mutations need this, not the clip-relative `percentage`). */
    tweenPercentage?: number;
    /** Which property group the source tween belongs to (position, scale, rotation, visual, etc.). */
    propertyGroup?: string;
    properties: Record<string, number | string>;
    ease?: string;
  }>;
  ease?: string;
  easeEach?: string;
}

export interface TimelineElement {
  id: string;
  label?: string;
  key?: string;
  tag: string;
  start: number;
  duration: number;
  track: number;
  /**
   * The data-track-index as written in the source file. Set at the manifest
   * translation boundary (createTimelineElementFromManifestClip) from the
   * runtime clip's verbatim track, and preserved through display-lane remaps
   * (normalizeToZones packs sparse authored tracks onto contiguous display
   * lanes; expanded sub-comp children get synthetic display rows). Lane edits
   * must persist THIS space — writing a display-lane number into a sparse file
   * re-targets the wrong track. For an expanded child the value is in its OWN
   * source file's coordinate space, not the host timeline's.
   */
  authoredTrack?: number;
  /** Resolved z-index for stacking-aware timeline ordering. */
  zIndex?: number;
  /** True when the effective z-index was authored inline or through CSS, not auto. */
  hasExplicitZIndex?: boolean;
  /** Canonical CSS stacking context this element's z-index participates in. */
  stackingContextId?: string | null;
  /** Nearest parent composition context, matching RuntimeTimelineClip. */
  parentCompositionId?: string | null;
  /** Composition ancestry from root to nearest parent, matching RuntimeTimelineClip. */
  compositionAncestors?: string[];
  domId?: string;
  /** Stable `data-hf-id` attribute value — used as primary patch target when present */
  hfId?: string;
  /** Best-effort selector used when patching source HTML back from timeline edits */
  selector?: string;
  /** Zero-based occurrence index for non-unique selectors */
  selectorIndex?: number;
  /** Source composition file that owns this element, when known */
  sourceFile?: string;
  src?: string;
  playbackStart?: number;
  playbackStartAttr?: "media-start" | "playback-start";
  playbackRate?: number;
  sourceDuration?: number;
  volume?: number;
  /** Path from data-composition-src — identifies sub-composition elements */
  compositionSrc?: string;
  /** Whether this row came from authored clip timing or Studio's full-duration layer fallback. */
  timingSource?: "authored" | "implicit";
  /** Set by data-timeline-locked on the host element — disables move and trim in Studio. */
  timelineLocked?: boolean;
  /** Set by data-hidden on the host element — hides the clip in preview and render. */
  hidden?: boolean;
  /** Value of data-timeline-role attribute — used to identify music vs. voiceover. */
  timelineRole?: string;
  /**
   * Set by useExpandedTimelineElements on an inline-expanded sub-composition
   * child: the absolute master-timeline start of the sub-comp host the child
   * lives in. Presence marks the element as expanded; edits subtract it to get
   * the child's local (sourceFile-relative) time. Works at any nesting depth.
   */
  expandedParentStart?: number;
}
