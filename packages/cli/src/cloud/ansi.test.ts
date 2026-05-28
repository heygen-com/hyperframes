import { describe, expect, it } from "vitest";
import { padEndVisible, stripAnsi, visibleLength } from "./ansi.js";

describe("cloud/ansi", () => {
  describe("stripAnsi", () => {
    it("strips basic SGR codes (16-color)", () => {
      expect(stripAnsi("\x1b[32mok\x1b[39m")).toBe("ok");
    });

    it("strips bright SGR codes", () => {
      expect(stripAnsi("\x1b[91merr\x1b[39m")).toBe("err");
    });

    it("strips 24-bit truecolor sequences (used by c.accent)", () => {
      expect(stripAnsi("\x1b[38;2;60;230;172maccent\x1b[39m")).toBe("accent");
    });

    it("strips reset codes", () => {
      expect(stripAnsi("\x1b[0mreset")).toBe("reset");
    });

    it("leaves non-ANSI text alone", () => {
      expect(stripAnsi("plain")).toBe("plain");
    });

    it("handles nested codes", () => {
      expect(stripAnsi("\x1b[1m\x1b[32mbold-green\x1b[39m\x1b[22m")).toBe("bold-green");
    });
  });

  describe("visibleLength", () => {
    it("returns the visible-only character count", () => {
      expect(visibleLength("\x1b[32mok\x1b[39m")).toBe(2);
      expect(visibleLength("\x1b[38;2;60;230;172maccent\x1b[39m")).toBe(6);
    });
  });

  describe("padEndVisible", () => {
    it("pads to target visible width regardless of ANSI overhead", () => {
      const padded = padEndVisible("\x1b[32mok\x1b[39m", 6);
      // visible "ok" is 2 chars; padded to 6 visible chars = "ok    " plus the ANSI overhead
      expect(visibleLength(padded)).toBe(6);
    });

    it("does not trim when input is already longer than target", () => {
      expect(padEndVisible("longer", 3)).toBe("longer");
    });
  });
});
