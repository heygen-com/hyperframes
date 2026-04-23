export type RuntimeJson =
  | string
  | number
  | boolean
  | null
  | RuntimeJson[]
  | { [key: string]: RuntimeJson };

export type RuntimeBridgeControlAction =
  | "play"
  | "pause"
  | "seek"
  | "set-muted"
  | "set-media-output-muted"
  | "set-playback-rate"
  | "enable-pick-mode"
  | "disable-pick-mode"
  | "flash-elements";

export type RuntimeBridgeControlMessage = {
  source: "hf-parent";
  type: "control";
  action: RuntimeBridgeControlAction;
  frame?: number;
  muted?: boolean;
  playbackRate?: number;
  seekMode?: "drag" | "commit";
};

export type RuntimeStateMessage = {
  source: "hf-preview";
  type: "state";
  frame: number;
  isPlaying: boolean;
  muted: boolean;
  playbackRate: number;
};

export type RuntimeTimelineClip = {
  id: string | null;
  label: string;
  start: number;
  duration: number;
  track: number;
  kind: "video" | "audio" | "image" | "element" | "composition";
  tagName: string | null;
  compositionId: string | null;
  compositionAncestors: string[];
  parentCompositionId: string | null;
  nodePath: string | null;
  compositionSrc: string | null;
  assetUrl: string | null;
  timelineRole: string | null;
  timelineLabel: string | null;
  timelineGroup: string | null;
  timelinePriority: number | null;
};

export type RuntimeTimelineScene = {
  id: string;
  label: string;
  start: number;
  duration: number;
  thumbnailUrl: string | null;
  avatarName: string | null;
};

export type RuntimeTimelineMessage = {
  source: "hf-preview";
  type: "timeline";
  durationInFrames: number;
  clips: RuntimeTimelineClip[];
  scenes: RuntimeTimelineScene[];
  compositionWidth: number;
  compositionHeight: number;
};

export type RuntimeDiagnosticMessage = {
  source: "hf-preview";
  type: "diagnostic";
  code: string;
  details: Record<string, RuntimeJson>;
};

export type RuntimePickerBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RuntimePickerElementInfo = {
  id: string | null;
  tagName: string;
  selector: string;
  label: string;
  boundingBox: RuntimePickerBoundingBox;
  textContent: string | null;
  src: string | null;
  dataAttributes: Record<string, string>;
};

export type RuntimePickerHoveredMessage = {
  source: "hf-preview";
  type: "element-hovered";
  elementInfo: RuntimePickerElementInfo;
};

export type RuntimePickerCandidatesMessage = {
  source: "hf-preview";
  type: "element-pick-candidates";
  candidates: RuntimePickerElementInfo[];
  selectedIndex: number;
  point: { x: number; y: number };
};

export type RuntimePickerPickedMessage = {
  source: "hf-preview";
  type: "element-picked";
  elementInfo: RuntimePickerElementInfo;
};

export type RuntimePickerPickedManyMessage = {
  source: "hf-preview";
  type: "element-picked-many";
  elementInfos: RuntimePickerElementInfo[];
};

export type RuntimePickerCancelledMessage = {
  source: "hf-preview";
  type: "pick-mode-cancelled";
};

export type RuntimeStageSizeMessage = {
  source: "hf-preview";
  type: "stage-size";
  width: number;
  height: number;
};

/**
 * Fired once per session when the runtime's attempt to play a timed media
 * element is rejected with `NotAllowedError`. The parent (web component / host
 * app) uses this as the signal to promote to parent-frame audio proxies —
 * iframes lose autoplay privileges when the user gesture originated in the
 * parent frame, so the host has to take over audible playback there.
 */
export type RuntimeMediaAutoplayBlockedMessage = {
  source: "hf-preview";
  type: "media-autoplay-blocked";
};

/**
 * Analytics events emitted by the runtime.
 *
 * The host app receives these via postMessage and forwards to its analytics
 * provider (PostHog, Mixpanel, Amplitude, custom logging, etc.).
 * No analytics SDK runs inside this iframe.
 */
export type RuntimeAnalyticsMessage = {
  source: "hf-preview";
  type: "analytics";
  event:
    | "composition_loaded"
    | "composition_played"
    | "composition_paused"
    | "composition_seeked"
    | "composition_ended"
    | "element_picked";
  properties: Record<string, string | number | boolean | null>;
};

/**
 * Numeric performance metrics emitted by the runtime — scrub latency, sustained
 * fps, dropped frames, decoder count, composition load time, media sync drift.
 * The host aggregates per-session values (p50/p95) and forwards to its
 * observability pipeline. Distinct from `analytics` events because perf data
 * is continuous and numeric, not discrete.
 */
export type RuntimePerformanceMessage = {
  source: "hf-preview";
  type: "perf";
  name: string;
  value: number;
  tags: Record<string, string | number | boolean | null>;
};

export type RuntimeOutboundMessage =
  | RuntimeStateMessage
  | RuntimeTimelineMessage
  | RuntimeDiagnosticMessage
  | RuntimePickerHoveredMessage
  | RuntimePickerCandidatesMessage
  | RuntimePickerPickedMessage
  | RuntimePickerPickedManyMessage
  | RuntimePickerCancelledMessage
  | RuntimeStageSizeMessage
  | RuntimeMediaAutoplayBlockedMessage
  | RuntimeAnalyticsMessage
  | RuntimePerformanceMessage;

export type RuntimePlayer = {
  _timeline: RuntimeTimelineLike | null;
  play: () => void;
  pause: () => void;
  seek: (timeSeconds: number) => void;
  renderSeek: (timeSeconds: number) => void;
  getTime: () => number;
  getDuration: () => number;
  isPlaying: () => boolean;
  setPlaybackRate: (rate: number) => void;
  getPlaybackRate: () => number;
};

export type RuntimeTimelineLike = {
  play: () => void;
  pause: () => void;
  seek: (timeSeconds: number, suppressEvents?: boolean) => void;
  totalTime?: (timeSeconds: number, suppressEvents?: boolean) => void;
  time: () => number;
  duration: () => number;
  add: (timeline: RuntimeTimelineLike, startAtSeconds: number) => void;
  paused: (paused?: boolean) => void;
  timeScale?: (rate: number) => void;
  set: (target: RuntimeGsapSetTarget, vars: RuntimeGsapSetVars, atSeconds?: number) => void;
};

export type RuntimeDeterministicAdapter = {
  name: string;
  discover: () => void;
  seek: (ctx: { time: number }) => void;
  pause: () => void;
  play?: () => void;
  revert?: () => void;
};

export type RuntimeGsapSetTarget = string | Element | Element[] | null;

export type RuntimeGsapSetVars = Record<string, string | number | boolean | null | undefined>;
