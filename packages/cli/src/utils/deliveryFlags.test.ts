import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliUsageError } from "./commandResult.js";
import { parseDeliveryFlags } from "./deliveryFlags.js";

describe("parseDeliveryFlags", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns nothing when no flag is set", () => {
    expect(parseDeliveryFlags({})).toEqual({});
  });

  it("reads the interval as seconds and keeps the bitrate strings as typed", () => {
    expect(
      parseDeliveryFlags({
        "keyframe-interval": "2.5",
        "max-bitrate": " 8M ",
        "buffer-size": "12M",
      }),
    ).toEqual({ keyframeIntervalSeconds: 2.5, maxBitrate: "8M", bufferSize: "12M" });
  });

  it("reads the ProRes profile and rejects an unknown name before any render starts", () => {
    expect(parseDeliveryFlags({ "prores-profile": " hq " })).toEqual({ proresProfile: "hq" });
    expect(() => parseDeliveryFlags({ "prores-profile": "422hq" })).toThrow(CliUsageError);
  });

  it.each([["0"], ["-1"], ["abc"], [""]])("rejects keyframe interval %j", (value) => {
    expect(() => parseDeliveryFlags({ "keyframe-interval": value })).toThrow(CliUsageError);
  });

  it("rejects a bad cap and a buffer without a cap before any render starts", () => {
    expect(() => parseDeliveryFlags({ "max-bitrate": "fast" })).toThrow(CliUsageError);
    expect(() => parseDeliveryFlags({ "buffer-size": "2M" })).toThrow(CliUsageError);
  });
});
