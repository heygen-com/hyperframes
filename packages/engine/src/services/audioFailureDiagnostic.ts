import type { AudioFailureDiagnostic, AudioSubprocessEvidence } from "./audioMixer.types.js";

const STAGES = new Set([
  "source",
  "download",
  "probe",
  "extract",
  "prepare",
  "mix",
  "silence",
  "cancelled",
  "internal",
]);
const REASONS = new Set([
  "source_not_found",
  "download_failed",
  "probe_failed",
  "invalid_media",
  "ffmpeg_unsupported",
  "ffmpeg_timeout",
  "ffmpeg_unavailable",
  "external_interruption",
  "ffmpeg_failed",
  "cancelled",
  "internal",
]);
const TERMINATIONS = new Set(["exit", "abort", "deadline", "inactivity", "spawn_error"]);
const SIGNALS = new Set([
  "SIGABRT",
  "SIGBUS",
  "SIGFPE",
  "SIGHUP",
  "SIGILL",
  "SIGINT",
  "SIGKILL",
  "SIGPIPE",
  "SIGQUIT",
  "SIGSEGV",
  "SIGTERM",
  "SIGTRAP",
  "SIGXCPU",
  "SIGXFSZ",
]);
const CODES = new Set([
  "EACCES",
  "EAGAIN",
  "EBUSY",
  "EIO",
  "EISDIR",
  "EMFILE",
  "ENAMETOOLONG",
  "ENFILE",
  "ENOENT",
  "ENOEXEC",
  "ENOMEM",
  "ENOSPC",
  "ENOTDIR",
  "EPERM",
  "ETIMEDOUT",
]);

function isStage(value: unknown): value is AudioFailureDiagnostic["stage"] {
  return typeof value === "string" && STAGES.has(value);
}

function isReason(value: unknown): value is AudioFailureDiagnostic["reason"] {
  return typeof value === "string" && REASONS.has(value);
}

function isTermination(
  value: unknown,
): value is NonNullable<AudioSubprocessEvidence["terminationReason"]> {
  return typeof value === "string" && TERMINATIONS.has(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function audioSubprocessEvidence(value: unknown): AudioSubprocessEvidence {
  if (!record(value)) return {};
  const evidence: AudioSubprocessEvidence = {};
  if (
    typeof value.exitCode === "number" &&
    Number.isInteger(value.exitCode) &&
    value.exitCode >= -2147483648 &&
    value.exitCode <= 4294967295
  )
    evidence.exitCode = value.exitCode;
  if (typeof value.signal === "string" && SIGNALS.has(value.signal)) evidence.signal = value.signal;
  if (isTermination(value.terminationReason)) evidence.terminationReason = value.terminationReason;
  const error = record(value.error) ? value.error : value;
  if (typeof error.code === "string" && CODES.has(error.code)) evidence.code = error.code;
  return evidence;
}

/** Re-project at the wire boundary: neither typed callers nor warning details are a privacy boundary. */
export function audioFailureDiagnostics(values: readonly unknown[]): AudioFailureDiagnostic[] {
  const result: AudioFailureDiagnostic[] = [];
  for (const value of values.slice(0, 16)) {
    if (
      !record(value) ||
      !isStage(value.stage) ||
      !isReason(value.reason) ||
      (value.owner !== "user" && value.owner !== "system") ||
      typeof value.retryable !== "boolean"
    )
      continue;
    result.push({
      stage: value.stage,
      reason: value.reason,
      owner: value.owner,
      retryable: value.retryable,
      ...(record(value.subprocess)
        ? { subprocess: audioSubprocessEvidence(value.subprocess) }
        : {}),
    });
  }
  return result;
}
