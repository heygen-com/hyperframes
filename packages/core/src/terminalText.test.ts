import { describe, expect, it } from "vitest";
import { terminalText } from "./terminalText.js";

describe("terminalText", () => {
  it("leaves ordinary text and tabs alone", () => {
    expect(terminalText("intro-scene\tassets/clip é.mp4")).toBe("intro-scene\tassets/clip é.mp4");
  });

  it("writes C0, DEL and C1 controls out as visible escapes", () => {
    expect(terminalText("a\u001b[31mb\u0007c\nd\u007fe\u009bf\u0085")).toBe(
      "a\\x1b[31mb\\x07c\\x0ad\\x7fe\\x9bf\\x85",
    );
  });
});
