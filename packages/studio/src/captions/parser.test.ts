// @vitest-environment node
import { describe, it, expect } from "vitest";
import { extractTranscript } from "./parser.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STANDARD_CAPTION_SOURCE = `
(function () {
  const TRANSCRIPT = [
    { text: "We", start: 0.119, end: 0.259 },
    { text: "asked", start: 0.319, end: 0.479 },
    { text: "what", start: 0.519, end: 0.659 },
    { text: "you", start: 0.699, end: 0.819 },
    { text: "needed.", start: 0.859, end: 1.819 },
  ];
  // rest of composition code ...
})();
`;

const SCRIPT_VARIABLE_SOURCE = `
(function () {
  const script = [
    { text: "We", start: 0.119, end: 0.259 },
    { text: "asked", start: 0.319, end: 0.479 },
    { text: "what", start: 0.519, end: 0.659 },
  ];
  // rest of composition code ...
})();
`;

const LET_TRANSCRIPT_SOURCE = `
(function () {
  let TRANSCRIPT = [
    { text: "Hello", start: 0.0, end: 0.5 },
    { text: "world", start: 0.6, end: 1.0 },
  ];
})();
`;

const VAR_TRANSCRIPT_SOURCE = `
(function () {
  var TRANSCRIPT = [
    { text: "Hello", start: 0.0, end: 0.5 },
  ];
})();
`;

const SINGLE_QUOTED_SOURCE = `
(function () {
  const TRANSCRIPT = [
    { text: 'We', start: 0.119, end: 0.259 },
    { text: 'asked', start: 0.319, end: 0.479 },
  ];
})();
`;

const TRAILING_COMMA_SOURCE = `
(function () {
  const TRANSCRIPT = [
    { text: "We", start: 0.119, end: 0.259, },
    { text: "asked", start: 0.319, end: 0.479, },
  ];
})();
`;

const NON_CAPTION_SOURCE = `
(function () {
  const config = { fps: 30, duration: 10 };
  const elements = ["title", "subtitle"];
  gsap.to(".clip", { opacity: 1 });
})();
`;

const EMPTY_SOURCE = ``;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractTranscript", () => {
  describe("TRANSCRIPT variable", () => {
    it("extracts words from a standard TRANSCRIPT array", () => {
      const words = extractTranscript(STANDARD_CAPTION_SOURCE);
      expect(words).toHaveLength(5);
      expect(words[0]).toEqual({ text: "We", start: 0.119, end: 0.259 });
      expect(words[1]).toEqual({ text: "asked", start: 0.319, end: 0.479 });
      expect(words[4]).toEqual({ text: "needed.", start: 0.859, end: 1.819 });
    });

    it("handles let TRANSCRIPT declaration", () => {
      const words = extractTranscript(LET_TRANSCRIPT_SOURCE);
      expect(words).toHaveLength(2);
      expect(words[0]).toEqual({ text: "Hello", start: 0.0, end: 0.5 });
      expect(words[1]).toEqual({ text: "world", start: 0.6, end: 1.0 });
    });

    it("handles var TRANSCRIPT declaration", () => {
      const words = extractTranscript(VAR_TRANSCRIPT_SOURCE);
      expect(words).toHaveLength(1);
      expect(words[0]).toEqual({ text: "Hello", start: 0.0, end: 0.5 });
    });
  });

  describe("script variable name", () => {
    it("extracts words from a const script array (warm-grain template variant)", () => {
      const words = extractTranscript(SCRIPT_VARIABLE_SOURCE);
      expect(words).toHaveLength(3);
      expect(words[0]).toEqual({ text: "We", start: 0.119, end: 0.259 });
      expect(words[2]).toEqual({ text: "what", start: 0.519, end: 0.659 });
    });
  });

  describe("non-caption source", () => {
    it("returns empty array when no TRANSCRIPT or script variable is found", () => {
      const words = extractTranscript(NON_CAPTION_SOURCE);
      expect(words).toEqual([]);
    });

    it("returns empty array for an empty string", () => {
      const words = extractTranscript(EMPTY_SOURCE);
      expect(words).toEqual([]);
    });
  });

  describe("single-quoted values", () => {
    it("parses arrays with single-quoted text values", () => {
      const words = extractTranscript(SINGLE_QUOTED_SOURCE);
      expect(words).toHaveLength(2);
      expect(words[0]).toEqual({ text: "We", start: 0.119, end: 0.259 });
      expect(words[1]).toEqual({ text: "asked", start: 0.319, end: 0.479 });
    });
  });

  describe("trailing commas", () => {
    it("handles trailing commas inside objects", () => {
      const words = extractTranscript(TRAILING_COMMA_SOURCE);
      expect(words).toHaveLength(2);
      expect(words[0]).toEqual({ text: "We", start: 0.119, end: 0.259 });
    });
  });

  describe("real-world source samples", () => {
    it("handles a realistic production-style TRANSCRIPT block with many words", () => {
      const source = `
        (function() {
          const TRANSCRIPT = [
            { text: "We", start: 0.119, end: 0.259 },
            { text: "asked", start: 0.319, end: 0.479 },
            { text: "what", start: 0.519, end: 0.659 },
            { text: "you", start: 0.699, end: 0.819 },
            { text: "needed.", start: 0.859, end: 1.819 },
            { text: "Forty-seven", start: 1.86, end: 2.299 },
            { text: "percent", start: 2.399, end: 2.679 },
            { text: "of", start: 2.7, end: 2.799 },
          ];
        })();
      `;
      const words = extractTranscript(source);
      expect(words).toHaveLength(8);
      expect(words[5]).toEqual({ text: "Forty-seven", start: 1.86, end: 2.299 });
    });

    it("handles words with punctuation in text values", () => {
      const source = `
        const TRANSCRIPT = [
          { text: "graphics,", start: 3.579, end: 4.599 },
          { text: "you", start: 4.679, end: 5.179 },
          { text: "attention.", start: 5.299, end: 5.759 },
        ];
      `;
      const words = extractTranscript(source);
      expect(words).toHaveLength(3);
      expect(words[0].text).toBe("graphics,");
      expect(words[2].text).toBe("attention.");
    });
  });
});
