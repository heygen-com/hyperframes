import { describe, expect, it } from "vitest";
import { CHROMIUM_UNSAFE_PORTS, isChromiumUnsafePort } from "./chromiumUnsafePorts.js";

describe("isChromiumUnsafePort", () => {
  it("recognizes Chromium's restricted PasswordServer port", () => {
    expect(CHROMIUM_UNSAFE_PORTS.has(3659)).toBe(true);
    expect(isChromiumUnsafePort(3659)).toBe(true);
  });

  it("allows a representative ephemeral port", () => {
    expect(isChromiumUnsafePort(49_152)).toBe(false);
  });
});
