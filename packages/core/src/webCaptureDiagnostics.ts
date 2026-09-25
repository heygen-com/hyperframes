export const WEB_CAPTURE_PRODUCER_DIAGNOSTICS = {
  "animation.staticized": { rank: 10, severity: "warning" },
  "control.redacted": { rank: 20, severity: "warning" },
  "opaque.replaced": { rank: 30, severity: "info" },
  "model.localized": { rank: 40, severity: "info" },
  "media.seek-unverified": { rank: 50, severity: "warning" },
  "still.cropped": { rank: 60, severity: "warning" },
} as const satisfies Record<string, { rank: number; severity: "info" | "warning" }>;

export const WEB_CAPTURE_REJECTION_REASONS = {
  "budget.exceeded": { rank: 10 },
  "media.protected-or-unavailable": { rank: 20 },
  "representation.unavailable": { rank: 30 },
  "source.changed": { rank: 40 },
} as const satisfies Record<string, { rank: number }>;

export const WEB_CAPTURE_FAILURE_CODES = {
  "route.unrecognized": { phase: "route" },
  "clipboard.mime-mismatch": { phase: "route" },
  "grammar.malformed": { phase: "grammar" },
  "grammar.non-canonical": { phase: "grammar" },
  "grammar.duplicate-key": { phase: "grammar" },
  "protocol.legacy-v1": { phase: "protocol" },
  "protocol.unsupported-version": { phase: "protocol" },
  "schema.unknown-key": { phase: "schema" },
  "schema.invalid": { phase: "schema" },
  "schema.invalid-artifact": { phase: "schema" },
  "budget.html-css-bytes": { phase: "quota" },
  "budget.resources": { phase: "quota" },
  "budget.diagnostics": { phase: "quota" },
  "budget.raster-pixels": { phase: "quota" },
  "budget.device-pixel-ratio": { phase: "quota" },
  "budget.media-dimension": { phase: "quota" },
  "budget.media-duration-ms": { phase: "quota" },
  "budget.materialized-bytes": { phase: "quota" },
  "budget.decoded-font-bytes": { phase: "quota" },
  "budget.aggregate-decoded-pixels": { phase: "quota" },
  "budget.final-utf8-bytes": { phase: "quota" },
  "resource.duplicate-id": { phase: "resource" },
  "resource.hash-mismatch": { phase: "resource" },
  "resource.invalid-data": { phase: "resource" },
  "resource.mime-mismatch": { phase: "resource" },
  "resource.dimensions-mismatch": { phase: "resource" },
  "resource.decoded-size-mismatch": { phase: "resource" },
  "resource.duration-mismatch": { phase: "resource" },
  "resource.materialization-failed": { phase: "resource" },
  "resource.materialization-aborted": { phase: "resource" },
  "integrity.digest-mismatch": { phase: "integrity" },
} as const satisfies Record<
  string,
  { phase: "route" | "grammar" | "protocol" | "schema" | "quota" | "resource" | "integrity" }
>;

export type WebCaptureProducerDiagnosticCode = keyof typeof WEB_CAPTURE_PRODUCER_DIAGNOSTICS;
export type WebCaptureRejectionReason = keyof typeof WEB_CAPTURE_REJECTION_REASONS;
export type WebCaptureFailureCode = keyof typeof WEB_CAPTURE_FAILURE_CODES;

export interface WebCaptureDiagnostic {
  code: WebCaptureProducerDiagnosticCode;
  count: number;
}

export class WebCaptureDiagnosticError extends Error {}

export function isWebCaptureProducerDiagnosticCode(
  value: string,
): value is WebCaptureProducerDiagnosticCode {
  return Object.hasOwn(WEB_CAPTURE_PRODUCER_DIAGNOSTICS, value);
}

export function normalizeWebCaptureDiagnostics(
  diagnostics: readonly WebCaptureDiagnostic[],
): WebCaptureDiagnostic[] {
  const counts = new Map<WebCaptureProducerDiagnosticCode, number>();
  for (const diagnostic of diagnostics) {
    if (!isWebCaptureProducerDiagnosticCode(diagnostic.code)) {
      throw new WebCaptureDiagnosticError(
        `Unknown web capture diagnostic: ${String(diagnostic.code)}`,
      );
    }
    if (!Number.isSafeInteger(diagnostic.count) || diagnostic.count <= 0) {
      throw new WebCaptureDiagnosticError(
        `Web capture diagnostic count must be a positive integer`,
      );
    }
    counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + diagnostic.count);
  }
  return [...counts.entries()]
    .sort(
      ([left], [right]) =>
        WEB_CAPTURE_PRODUCER_DIAGNOSTICS[left].rank - WEB_CAPTURE_PRODUCER_DIAGNOSTICS[right].rank,
    )
    .map(([code, count]) => ({ code, count }));
}
