import { describe, expect, it } from "vitest";
import { parsePort } from "./port.js";

describe("parsePort", () => {
  it.each([
    ["1", 1],
    ["3003", 3003],
    ["65535", 65535],
  ])("parses valid port %s", (value, expected) => {
    expect(parsePort(value)).toBe(expected);
  });

  it.each(["", "0", "65536", "-1", "22.5", "3003oops", "banana"])(
    "rejects invalid port %j",
    (value) => {
      expect(() => parsePort(value)).toThrow("--port must be an integer between 1 and 65535");
    },
  );

  it("names the option in validation errors", () => {
    expect(() => parsePort("9222oops", "--remote-debugging-port")).toThrow(
      "--remote-debugging-port must be an integer between 1 and 65535",
    );
  });
});
