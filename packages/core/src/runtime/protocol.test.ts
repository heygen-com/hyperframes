import { describe, expect, it } from "vitest";
import {
  inspectRuntimeProtocol,
  isMessageList,
  MAX_MESSAGE_LIST,
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

  it.each([24_000, 30_000, 60_000])("states %s/1001 fps exactly", (numerator) => {
    expect(runtimeProtocolFpsFromNumber(numerator / 1_001)).toEqual({
      numerator,
      denominator: 1_001,
    });
  });

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

  // fails without the fix: the inspector walked whatever length the sender declared.
  it("rejects capabilities too long to walk or with holes, without walking them", () => {
    const metadata = runtimeProtocolMetadata(30);
    const inspect = (capabilities: unknown[]) =>
      inspectRuntimeProtocol({ ...metadata, capabilities });
    const rejected = { status: "unsupported", code: "invalid_protocol_metadata" };

    expect(inspect(Array(MAX_MESSAGE_LIST + 1).fill("seconds-time"))).toMatchObject(rejected);
    const holey = ["seconds-time"];
    holey[2] = "play-range";
    expect(inspect(holey)).toMatchObject(rejected);
    expect(inspect(new Array(2 ** 32 - 1))).toMatchObject(rejected);
    expect(inspect(Array(MAX_MESSAGE_LIST).fill("seconds-time"))).toMatchObject({
      status: "supported",
    });
  });

  it("reads a list against the cap its reader names", () => {
    expect(isMessageList([1, 2, 3], 3)).toBe(true);
    expect(isMessageList([1, 2, 3, 4], 3)).toBe(false);
  });
});
