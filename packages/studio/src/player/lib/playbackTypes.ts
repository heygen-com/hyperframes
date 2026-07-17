/**
 * Shared type definitions for the timeline playback subsystem.
 * Kept in a separate module so adapter, DOM, and hook modules can all import
 * from here without creating circular dependencies.
 */

export interface PlaybackAdapter {
  play: () => void;
  pause: () => void;
  seek: (time: number, options?: { keepPlaying?: boolean }) => void;
  getTime: () => number;
  getDuration: () => number;
  isPlaying: () => boolean;
}

export type RuntimePlaybackAdapter = PlaybackAdapter & {
  renderSeek?: (time: number) => void;
};

export interface StaticSeekPlaybackClock {
  now: () => number;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
}

export interface TimelineLike {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  time: () => number;
  duration: () => number;
  isActive: () => boolean;
}

export interface ClipManifestClip {
  id: string | null;
  label: string;
  start: number;
  duration: number;
  track: number;
  zIndex?: number;
  stackingContextId?: string | null;
  kind: "video" | "audio" | "image" | "element" | "composition";
  tagName: string | null;
  compositionId: string | null;
  compositionAncestors?: string[];
  parentCompositionId: string | null;
  compositionSrc: string | null;
  playbackStart?: number;
  playbackRate?: number;
  assetUrl: string | null;
}

export interface ClipManifest {
  protocolVersion?: number;
  compositionContractVersion?: number;
  capabilities?: readonly string[];
  fps?: { numerator: number; denominator: number };
  durationSeconds?: number;
  clips: ClipManifestClip[];
  scenes: Array<{ id: string; label: string; start: number; duration: number }>;
  durationInFrames: number;
  compositionWidth?: number;
  compositionHeight?: number;
}

export type IframeWindow = Window & {
  __player?: RuntimePlaybackAdapter;
  __timeline?: TimelineLike;
  __timelines?: Record<string, TimelineLike>;
  __clipManifest?: ClipManifest;
};
