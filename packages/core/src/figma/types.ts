export interface FigmaRef {
  fileKey: string;
  nodeId?: string;
}

export type FigmaAssetFormat = "png" | "svg" | "jpg" | "pdf";

export interface FigmaProvenance {
  source: "figma";
  fileKey: string;
  nodeId: string;
  version?: string;
  format?: FigmaAssetFormat;
  scale?: number;
}

export interface FigmaManifestRecord {
  id: string;
  type: "image" | "video";
  path: string;
  source: string;
  description?: string;
  /** media-use interop: lets `resolve --entity` find figma-imported assets */
  entity?: string;
  width?: number;
  height?: number;
  provenance: FigmaProvenance;
}

export interface AssetSnippet {
  path: string;
  html: string;
}

/** A motion.dev easing value as returned by get_motion_context: a named ease
 *  (e.g. "linear") or a cubic-bezier control-point array [x1,y1,x2,y2]. */
export type MotionEase = string | [number, number, number, number];

/** One animated property, normalized from get_motion_context's motion.dev snippet. */
export interface MotionTrack {
  /** motion.dev property name: "opacity" | "x" | "y" | "scaleX" | "scaleY" | "rotation" | ... */
  property: string;
  values: Array<number | string>;
  /** normalized 0..1, same length as values */
  times: number[];
  /** length values.length - 1; ease[i] governs the segment values[i] -> values[i+1] */
  ease: MotionEase[];
  /** seconds */
  duration: number;
  /** Infinity or a finite count; clamped to finite during translation */
  repeat?: number;
}

export interface MotionDoc {
  /** string-literal CSS selector for the target element, e.g. "#hero-title" */
  selector: string;
  tracks: MotionTrack[];
}

export type MappedEase =
  | { kind: "named"; ease: string }
  | { kind: "bezier"; bezier: [number, number, number, number] };

export interface CustomEaseRef {
  name: string;
  bezier: [number, number, number, number];
}

export interface GsapKeyframeStep {
  value: number | string;
  /** seconds */
  duration: number;
  /** GSAP ease string or a registered CustomEase name */
  ease: string;
}

export interface GsapTween {
  selector: string;
  property: string;
  initial: number | string;
  steps: GsapKeyframeStep[];
  /** finite; 0 = play once */
  repeat: number;
}

export interface TimelineSpec {
  timelineId: string;
  tweens: GsapTween[];
  customEases: CustomEaseRef[];
}
