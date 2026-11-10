import { describe, expect, it } from "vitest";
import { originForListeningAddress } from "./serverOrigin";

describe("originForListeningAddress", () => {
  it.each([
    [{ address: "127.0.0.1", family: "IPv4", port: 3002 }, "http://127.0.0.1:3002"],
    [{ address: "0.0.0.0", family: "IPv4", port: 3002 }, "http://127.0.0.1:3002"],
    [{ address: "::", family: "IPv6", port: 3002 }, "http://127.0.0.1:3002"],
    [{ address: "::1", family: "IPv6", port: 3002 }, "http://[::1]:3002"],
    [{ address: "192.168.1.20", family: "IPv4", port: 5190 }, "http://192.168.1.20:5190"],
  ])("reaches %o at %s", (address, origin) => {
    expect(originForListeningAddress(address)).toBe(origin);
  });

  it("has no origin for a pipe or a server that is not listening", () => {
    expect(originForListeningAddress("/tmp/studio.sock")).toBeUndefined();
    expect(originForListeningAddress(null)).toBeUndefined();
  });
});
