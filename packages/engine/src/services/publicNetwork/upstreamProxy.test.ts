import { describe, expect, it } from "vitest";
import { captureUpstreamProxy, connectAuthority } from "./upstreamProxy.js";

describe("captureUpstreamProxy", () => {
  it("is off when HYPERFRAMES_CAPTURE_PROXY is unset or blank, whatever HTTPS_PROXY says", () => {
    expect(captureUpstreamProxy({ HTTPS_PROXY: "http://proxy:3128" })).toBeUndefined();
    expect(captureUpstreamProxy({ HYPERFRAMES_CAPTURE_PROXY: "  " })).toBeUndefined();
  });

  it("refuses a value that is not an http:// proxy URL", () => {
    expect(() => captureUpstreamProxy({ HYPERFRAMES_CAPTURE_PROXY: "proxy:3128" })).toThrow(
      /must be an http:\/\/ proxy URL/,
    );
    expect(() => captureUpstreamProxy({ HYPERFRAMES_CAPTURE_PROXY: "https://proxy:3128" })).toThrow(
      /must be an http:\/\/ proxy URL/,
    );
    expect(() => captureUpstreamProxy({ HYPERFRAMES_CAPTURE_PROXY: "http://[bad" })).toThrow(
      /not a valid proxy URL/,
    );
    expect(() =>
      captureUpstreamProxy({ HYPERFRAMES_CAPTURE_PROXY: "http://user:%E0%A4%A@proxy:3128" }),
    ).toThrow(/not a valid proxy URL/);
  });

  it("reads host and port, and carries proxy credentials as Basic auth", () => {
    expect(
      captureUpstreamProxy({ HYPERFRAMES_CAPTURE_PROXY: "http://user:p%40ss@127.0.0.1:3128" }),
    ).toEqual({
      host: "127.0.0.1",
      port: 3128,
      authorization: `Basic ${Buffer.from("user:p@ss").toString("base64")}`,
    });
    expect(captureUpstreamProxy({ HYPERFRAMES_CAPTURE_PROXY: "http://[::1]" })).toEqual({
      host: "::1",
      port: 80,
      authorization: undefined,
    });
  });

  it("names the default port in CONNECT authorities", () => {
    expect(connectAuthority(new URL("https://example.com/a"))).toBe("example.com:443");
    expect(connectAuthority(new URL("https://example.com:8443/a"))).toBe("example.com:8443");
  });
});
