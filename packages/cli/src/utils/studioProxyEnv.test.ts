import { describe, expect, it } from "vitest";
import { studioProxyEnv } from "./studioProxyEnv.js";

describe("studioProxyEnv", () => {
  it("forwards an explicit --proxy decision to a Studio child process", () => {
    expect(studioProxyEnv(true, { KEEP: "yes" })).toEqual({
      KEEP: "yes",
      HYPERFRAMES_AUTO_PROXY: "true",
    });
    expect(studioProxyEnv(false, { KEEP: "yes" })).toEqual({
      KEEP: "yes",
      HYPERFRAMES_AUTO_PROXY: "false",
    });
  });
});
