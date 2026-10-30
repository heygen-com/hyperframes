export const RUNTIME_PROTOCOL_VERSION = 1 as const;

export const RUNTIME_FILLER = "hf-runtime-filler";

export const RUNTIME_MEDIA_LOAD_FAILED = "runtime_media_load_failed";

export const RUNTIME_PROTOCOL_CAPABILITIES = [
  "seconds-time",
  "rational-fps",
  "seek-keep-playing",
  "composition-manifest-v1",
  "runtime-data",
  "play-range",
] as const;

export type RuntimeProtocolFps = {
  numerator: number;
  denominator: number;
};

export type RuntimeProtocolV1 = {
  protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  capabilities: readonly string[];
  fps: RuntimeProtocolFps;
};

export type RuntimeProtocolInspection =
  | { status: "legacy"; fps: number }
  | { status: "supported"; fps: number; metadata: RuntimeProtocolV1 }
  | {
      status: "unsupported";
      code: "unsupported_protocol_version" | "invalid_protocol_metadata";
      receivedVersion: unknown;
    };

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left || 1;
}

export function runtimeProtocolFpsFromNumber(value: number): RuntimeProtocolFps {
  const safe = Number.isFinite(value) && value > 0 ? value : 30;
  const isNtscRate = Math.abs(safe * 1001 - Math.round(safe * 1001)) < 1e-6;
  const denominator = Number.isInteger(safe) ? 1 : isNtscRate ? 1001 : 1_000_000;
  const numerator = Math.round(safe * denominator);
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export function playRangeHoldTime(start: number, end: number, fps: number): number {
  return Math.max(start, (Math.ceil(end * fps - 1e-6) - 1) / fps);
}

export function runtimeProtocolFpsToNumber(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const fps = value as Partial<RuntimeProtocolFps>;
  if (!Number.isFinite(fps.numerator) || !Number.isFinite(fps.denominator)) return null;
  if ((fps.numerator ?? 0) <= 0 || (fps.denominator ?? 0) <= 0) return null;
  return Number(fps.numerator) / Number(fps.denominator);
}

export function runtimeProtocolMetadata(fps: number): RuntimeProtocolV1 {
  return {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    capabilities: RUNTIME_PROTOCOL_CAPABILITIES,
    fps: runtimeProtocolFpsFromNumber(fps),
  };
}

export function frameDisplayScale(frame: HTMLElement): number | null {
  const layoutWidth = frame.offsetWidth;
  const shownWidth = frame.getBoundingClientRect().width;
  return layoutWidth > 0 && shownWidth > 0 ? shownWidth / layoutWidth : null;
}

function hasDeclaredCapabilities(value: unknown): boolean {
  return Array.isArray(value) && value.every((capability) => typeof capability === "string");
}

export function inspectRuntimeProtocol(value: unknown, legacyFps = 30): RuntimeProtocolInspection {
  if (typeof value !== "object" || value === null) return { status: "legacy", fps: legacyFps };
  const message = value as Record<string, unknown>;
  if (message.protocolVersion === undefined) return { status: "legacy", fps: legacyFps };
  if (message.protocolVersion !== RUNTIME_PROTOCOL_VERSION) {
    return {
      status: "unsupported",
      code: "unsupported_protocol_version",
      receivedVersion: message.protocolVersion,
    };
  }
  const fps = runtimeProtocolFpsToNumber(message.fps);
  if (fps === null || !hasDeclaredCapabilities(message.capabilities)) {
    return {
      status: "unsupported",
      code: "invalid_protocol_metadata",
      receivedVersion: message.protocolVersion,
    };
  }
  return {
    status: "supported",
    fps,
    metadata: message as RuntimeProtocolV1,
  };
}

const STAGES = ["fetch", "decode", "element"] as const;
export type MediaLoadStage = (typeof STAGES)[number];

export interface MediaLoadFailure {
  elementId: string | null;
  kind: string;
  stage: MediaLoadStage;
  code: number | null;
  bytes: number | null;
  extension: string | null;
}

const numberOrNull = (n: unknown) => (typeof n === "number" ? n : null);
const stringOrNull = (s: unknown) => (typeof s === "string" ? s : null);

export function parseMediaLoadFailure(value: unknown): MediaLoadFailure | null {
  if (typeof value !== "object" || value === null) return null;
  const { elementId, kind, stage, code, bytes, extension } = value as Record<string, unknown>;
  const known = STAGES.find((s) => s === stage);
  if (!known || typeof kind !== "string") return null;
  return {
    elementId: stringOrNull(elementId),
    kind,
    stage: known,
    code: numberOrNull(code),
    bytes: numberOrNull(bytes),
    extension: stringOrNull(extension),
  };
}
