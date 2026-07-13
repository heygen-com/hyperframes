export const RUNTIME_PROTOCOL_VERSION = 1 as const;

export const RUNTIME_PROTOCOL_CAPABILITIES = [
  "seconds-time",
  "rational-fps",
  "seek-keep-playing",
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
  const denominator = Number.isInteger(safe) ? 1 : 1_000_000;
  const numerator = Math.round(safe * denominator);
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
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
