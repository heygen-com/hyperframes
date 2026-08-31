import { describe, expect, it } from "vitest";
import {
  normalizeWebCaptureDiagnostics,
  WEB_CAPTURE_FAILURE_CODES,
  WEB_CAPTURE_PRODUCER_DIAGNOSTICS,
  WEB_CAPTURE_REJECTION_REASONS,
} from "./webCaptureDiagnostics";

describe("normalizeWebCaptureDiagnostics", () => {
  it("sorts by the registry and aggregates repeated codes", () => {
    expect(
      normalizeWebCaptureDiagnostics([
        { code: "still.cropped", count: 1 },
        { code: "animation.staticized", count: 2 },
        { code: "still.cropped", count: 3 },
      ]),
    ).toEqual([
      { code: "animation.staticized", count: 2 },
      { code: "still.cropped", count: 4 },
    ]);
  });

  it("keeps the registry data-only", () => {
    expect(WEB_CAPTURE_PRODUCER_DIAGNOSTICS).toEqual({
      "animation.staticized": { rank: 10, severity: "warning" },
      "control.redacted": { rank: 20, severity: "warning" },
      "opaque.replaced": { rank: 30, severity: "info" },
      "media.seek-unverified": { rank: 40, severity: "warning" },
      "still.cropped": { rank: 50, severity: "warning" },
    });
    expect(WEB_CAPTURE_REJECTION_REASONS).toEqual({
      "budget.exceeded": { rank: 10 },
      "media.protected-or-unavailable": { rank: 20 },
      "representation.unavailable": { rank: 30 },
      "source.changed": { rank: 40 },
    });
    expect(Object.keys(WEB_CAPTURE_FAILURE_CODES)).toEqual([
      "route.unrecognized",
      "clipboard.mime-mismatch",
      "grammar.malformed",
      "grammar.non-canonical",
      "grammar.duplicate-key",
      "protocol.legacy-v1",
      "protocol.unsupported-version",
      "schema.unknown-key",
      "schema.invalid",
      "schema.invalid-artifact",
      "budget.html-css-bytes",
      "budget.resources",
      "budget.diagnostics",
      "budget.raster-pixels",
      "budget.device-pixel-ratio",
      "budget.media-dimension",
      "budget.media-duration-ms",
      "budget.materialized-bytes",
      "budget.decoded-font-bytes",
      "budget.aggregate-decoded-pixels",
      "budget.final-utf8-bytes",
      "resource.duplicate-id",
      "resource.hash-mismatch",
      "resource.invalid-data",
      "resource.mime-mismatch",
      "resource.dimensions-mismatch",
      "resource.decoded-size-mismatch",
      "resource.duration-mismatch",
      "resource.materialization-failed",
      "resource.materialization-aborted",
      "integrity.digest-mismatch",
    ]);
  });

  it("rejects unknown codes and invalid counts", () => {
    expect(() => normalizeWebCaptureDiagnostics([{ code: "page.url", count: 1 } as never])).toThrow(
      "Unknown web capture diagnostic",
    );
    expect(() => normalizeWebCaptureDiagnostics([{ code: "still.cropped", count: 0 }])).toThrow(
      "positive integer",
    );
  });
});
