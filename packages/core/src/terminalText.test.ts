import { describe, expect, it } from "vitest";
import { terminalLines, terminalText, terminalTextDeep } from "./terminalText.js";

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

describe("terminalLines", () => {
  it("keeps line breaks and escapes every other control in each line", () => {
    expect(terminalLines("Install failed\n  a\u001b]0;t\u0007\r\n  b\u009b")).toBe(
      "Install failed\n  a\\x1b]0;t\\x07\\x0d\n  b\\x9b",
    );
  });
});

describe("terminalTextDeep", () => {
  it("escapes every string in nested arrays and objects and keeps other values", () => {
    const shown = terminalTextDeep({
      id: "a\u001b]52;c;x\u0007",
      list: [{ selector: "#b\u001b[2J", n: 3 }],
      ok: true,
    });
    expect(shown).toEqual({
      id: "a\\x1b]52;c;x\\x07",
      list: [{ selector: "#b\\x1b[2J", n: 3 }],
      ok: true,
    });
  });

  it("escapes object keys too", () => {
    expect(terminalTextDeep({ "x\u001b]52;c;cGF5\u0007": 1 })).toEqual({
      "x\\x1b]52;c;cGF5\\x07": 1,
    });
  });
});
