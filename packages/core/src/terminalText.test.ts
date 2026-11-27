import { describe, expect, it } from "vitest";
import { quotedFilePath, terminalLines, terminalText, terminalTextDeep } from "./terminalText.js";

describe("terminalText", () => {
  it("leaves ordinary text and tabs alone", () => {
    expect(terminalText("intro-scene\tassets/clip é.mp4")).toBe("intro-scene\tassets/clip é.mp4");
  });

  it("writes C0, DEL and C1 controls out as visible escapes", () => {
    expect(terminalText("a\u001b[31mb\u0007c\nd\u007fe\u009bf\u0085")).toBe(
      "a\\x1b[31mb\\x07c\\x0ad\\x7fe\\x9bf\\x85",
    );
  });

  it("writes text direction marks out as visible escapes and keeps right-to-left letters", () => {
    expect(
      terminalText("clip\u202egpj.exe\u202c \u2066a\u2069 \u202a\u202b\u202d\u2067\u2068"),
    ).toBe("clip\\u202egpj.exe\\u202c \\u2066a\\u2069 \\u202a\\u202b\\u202d\\u2067\\u2068");
    expect(terminalText("שלום \u200f مرحبا")).toBe("שלום \u200f مرحبا");
  });

  it("writes the line and paragraph separators out as visible escapes", () => {
    expect(terminalText("a\u2028b\u2029c\u200d\u061c")).toBe("a\\u2028b\\u2029c\u200d\u061c");
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

describe("quotedFilePath", () => {
  it("shows invisible, bidi and compatibility characters distinctly from literal escapes", () => {
    const raw = "art/.assets/lo\u200bgo\u202e.ｐng";
    const shown = quotedFilePath(raw);
    expect(shown).toBe('"art/.assets/lo\\u200bgo\\u202e.\\uff50ng"');
    expect(shown).not.toBe(quotedFilePath(String.raw`art/.assets/lo\u200bgo\u202e.\uff50ng`));
    for (const path of [raw, 'a\n"tab\t', "a\u0085", "emoji\u{e0100}", "a\u2028b"]) {
      expect(JSON.parse(quotedFilePath(path))).toBe(path);
    }
  });
  it("keeps ordinary multilingual filenames readable", () => {
    expect(quotedFilePath("ブランド/.صور/été 🐈.png")).toBe('"ブランド/.صور/été 🐈.png"');
  });
});
