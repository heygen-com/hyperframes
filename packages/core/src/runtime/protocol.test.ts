import { describe, expect, it } from "vitest";
import {
  inspectRuntimeProtocol,
  runtimeProtocolFpsFromNumber,
  runtimeProtocolFpsToNumber,
  runtimeProtocolMetadata,
} from "./protocol";

describe("runtime protocol", () => {
  it.each([24, 30, 60, 24_000 / 1_001, 30_000 / 1_001])(
    "round-trips %s fps as a rational",
    (fps) => {
      expect(runtimeProtocolFpsToNumber(runtimeProtocolFpsFromNumber(fps))).toBeCloseTo(fps, 6);
    },
  );

  it("accepts protocol v1 metadata and exposes its fps", () => {
    expect(inspectRuntimeProtocol(runtimeProtocolMetadata(60))).toMatchObject({
      status: "supported",
      fps: 60,
    });
  });

  it("tolerates additive capabilities within protocol v1", () => {
    const metadata = runtimeProtocolMetadata(30);
    expect(
      inspectRuntimeProtocol({
        ...metadata,
        capabilities: [...metadata.capabilities, "future-cap"],
      }),
    ).toMatchObject({ status: "supported", fps: 30 });
  });

  it("keeps an explicit legacy fallback", () => {
    expect(inspectRuntimeProtocol({ source: "hf-preview" }, 24)).toEqual({
      status: "legacy",
      fps: 24,
    });
  });

  it("rejects unknown protocol versions and malformed v1 metadata", () => {
    expect(inspectRuntimeProtocol({ protocolVersion: 2 })).toMatchObject({
      status: "unsupported",
      code: "unsupported_protocol_version",
    });
    expect(
      inspectRuntimeProtocol({ protocolVersion: 1, fps: { numerator: 30, denominator: 1 } }),
    ).toMatchObject({ status: "unsupported", code: "invalid_protocol_metadata" });
  });
});
