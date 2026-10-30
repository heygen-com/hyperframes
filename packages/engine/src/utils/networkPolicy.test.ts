import { describe, expect, it } from "vitest";
import { isBlockedNetworkHost } from "./networkPolicy.js";

describe("special-use network list", () => {
  it.each(["192.0.0.0", "192.0.0.8", "192.0.0.255", "192.0.2.1"])("blocks reserved %s", (ip) =>
    expect(isBlockedNetworkHost(ip)).toBe(true),
  );
  // 192.0.64.0/18 is WordPress VIP (nasa.gov is 192.0.66.108): public, outside the two reserved /24s.
  it.each(["192.0.66.108", "192.0.1.1", "192.0.3.1"])("leaves public %s reachable", (ip) =>
    expect(isBlockedNetworkHost(ip)).toBe(false),
  );
});
