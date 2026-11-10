import type { CaptureDefect } from "../../htmlInCanvasDefects";
import type { MotionBlurFingerprint } from "../../motionBlurFingerprint";

/** What the runtime drives: capture blur or the filter fallback, the same way. */

export interface CaptureMotionBlurHost {
  root: HTMLElement;
  fps: number;
  durationSeconds: () => number;
  /** The bound root timeline; movers are re-scanned when it changes. */
  timeline: () => unknown;
  now: () => number;
  /** Seek the timeline and adapters (not media) for a pose read. */
  seek: (t: number, suppressEvents: boolean) => void;
  holdFrame?: () => (t: number) => void;
  muteCallbacks?: () => () => void;
  ignoreMutations?: (write: () => void) => void;
}

export interface Config {
  shutterDeg: number;
  phaseDeg: number | null;
  samples: number | null;
  events: boolean;
  tier: "auto" | "capture" | "filter";
}

export interface Report {
  state: "on" | "off";
  tier: "capture" | "filter" | null;
  /** Why blur is off, or why the fallback is in use. */
  reason: string | null;
  reasonCode: string | null;
  movers: number;
  /** The blurred elements, as `tag#id.class`, for diagnosing what was (not) picked. */
  moverNames: string[];
  scanMs: number;
  shutterDeg: number;
  phaseDeg: number | null;
  frames: number;
  meanMs: number;
  failures: number;
  failedFrames: number;
  fingerprint: MotionBlurFingerprint | null;
  readEvents: boolean;
}

export interface Tier {
  root: HTMLElement;
  paint: (t: number, engineMode: boolean) => Promise<void>;
  probe: () => Report;
  rest: () => boolean;
  arm: () => void;
  finish: () => void;
  teardown: () => void;
  suspend: () => void;
  report: () => Report;
  busy: () => boolean;
  rediscover: () => void;
}

export interface TierChoice {
  tier: Config["tier"];
  form: boolean;
  defect: CaptureDefect | null;
  fallback: boolean;
}

/** The filter tier unless the page asks for capture and it can run; off if told to be. */
export function chooseTier(c: TierChoice): "capture" | "filter" | "off" {
  if (c.defect?.code === "renderer-off") return "off";
  const capturable = c.form && !c.defect;
  if (c.fallback && (c.tier !== "capture" || !capturable)) return "filter";
  return capturable ? "capture" : "off";
}
