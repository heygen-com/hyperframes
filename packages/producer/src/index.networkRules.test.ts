import { describe, expect, it } from "vitest";
import { isBlockedNetworkHost } from "./index.js";

describe("isBlockedNetworkHost from the producer entry", () => {
  it.each([
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "198.18.0.1",
    "240.0.0.1",
    "64:ff9b::a00:1",
    "localhost",
  ])("refuses %s", (host) => expect(isBlockedNetworkHost(host)).toBe(true));

  it("allows a public address", () => expect(isBlockedNetworkHost("93.184.216.34")).toBe(false));
});
