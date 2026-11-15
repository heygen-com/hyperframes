import { afterEach, describe, expect, it, vi } from "vitest";
import { ipv4HostClass, isBlockedNetworkHost } from "./networkPolicy.js";

describe("special-use network list", () => {
  it.each(["192.0.0.0", "192.0.0.8", "192.0.0.255", "192.0.2.1"])("blocks reserved %s", (ip) =>
    expect(isBlockedNetworkHost(ip)).toBe(true),
  );
  // 192.0.64.0/18 is WordPress VIP (nasa.gov is 192.0.66.108): public, outside the two reserved /24s.
  it.each(["192.0.66.108", "192.0.1.1", "192.0.3.1"])("leaves public %s reachable", (ip) =>
    expect(isBlockedNetworkHost(ip)).toBe(false),
  );
  it.each([
    "64:ff9b::a00:1",
    "64:ff9b::7f00:1",
    "64:ff9b::10.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b:1::808:808",
    "::ffff:10.0.0.1",
    "::ffff:a9fe:a9fe",
    "::ffff:127.0.0.1",
  ])("blocks %s: the IPv4 address it carries is not public", (ip) =>
    expect(isBlockedNetworkHost(ip)).toBe(true),
  );
  it.each(["64:ff9b::808:808", "64:ff9b::8.8.8.8", "::ffff:8.8.8.8", "::ffff:808:808"])(
    "leaves %s reachable: it carries a public IPv4 address (DNS64 answers look like this)",
    (ip) => expect(isBlockedNetworkHost(ip)).toBe(false),
  );
});

describe("IPv4 host class", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["0.0.0.0", "loopback"],
    ["10.1.2.3", "private"],
    ["172.31.255.1", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "link-local"],
    ["100.64.0.1", "carrier-grade"],
    ["100.127.255.254", "carrier-grade"],
    ["198.51.100.1", "reserved"],
    ["224.0.0.1", "reserved"],
    ["8.8.8.8", "public"],
    ["100.128.0.1", "public"],
  ])("%s is %s", (ip, hostClass) => expect(ipv4HostClass(ip)).toBe(hostClass));
});

describe("operator ranges", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("adds the operator's networks to the list and classes them as private", () => {
    expect(isBlockedNetworkHost("192.160.83.14")).toBe(false);
    vi.stubEnv("PRODUCER_NON_PUBLIC_CIDRS", "192.160.0.0/16, 2600:1f00::/24");
    expect(isBlockedNetworkHost("192.160.83.14")).toBe(true);
    expect(ipv4HostClass("192.160.83.14")).toBe("private");
    expect(isBlockedNetworkHost("2600:1f00::1")).toBe(true);
    expect(isBlockedNetworkHost("192.161.0.1")).toBe(false);
    expect(isBlockedNetworkHost("::ffff:192.160.83.14")).toBe(true);
    expect(isBlockedNetworkHost("64:ff9b::c0a0:530e")).toBe(true);
  });

  it.each(["192.160.0.0", "192.160.0.0/33", "not-a-network/8"])(
    "refuses every address under a malformed setting %s",
    (range) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubEnv("PRODUCER_NON_PUBLIC_CIDRS", range);
      expect(isBlockedNetworkHost("8.8.8.8")).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("PRODUCER_NON_PUBLIC_CIDRS"));
      warn.mockRestore();
    },
  );
});
