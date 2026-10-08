import { describe, expect, it } from "vitest";
import { detectionWindows, parseDetection, pickLanguage, requestedLanguage } from "./language.js";

describe("detectionWindows", () => {
  it("leaves a clip under a minute with no intro, or under 30 s of speech, to whisper's own pick", () => {
    expect(detectionWindows(59, null)).toEqual([]);
    expect(detectionWindows(69, 40)).toEqual([]);
  });
  it("puts all three windows on the speech after an intro, overlapping when it is short", () => {
    expect(detectionWindows(90, 40)).toEqual([40, 50, 60]);
  });
  it("spreads three 30 s windows over the clip, centred at a sixth, a half and five sixths", () => {
    expect(detectionWindows(120, null)).toEqual([5, 45, 85]);
  });
  it("starts after the onset of speech and never runs past the end", () => {
    expect(detectionWindows(100, 40)).toEqual([40, 55, 70]);
  });
});

describe("pickLanguage", () => {
  it("takes the language two confident windows agree on, over a music window", () => {
    const votes = [
      { language: "en", p: 0.53 },
      { language: "es", p: 0.98 },
      { language: "es", p: 0.99 },
    ];
    expect(pickLanguage(votes)).toBe("es");
  });
  it("leaves the pick to whisper when the windows disagree or none is confident", () => {
    const disagree = ["en", "es", "fr"].map((language) => ({ language, p: 0.95 }));
    expect(pickLanguage(disagree)).toBeNull();
    const unsure = ["es", "es", "es"].map((language) => ({ language, p: 0.6 }));
    expect(pickLanguage(unsure)).toBeNull();
  });
});

describe("parseDetection", () => {
  it("reads whisper-cli's detection line", () => {
    const line = "whisper_full_with_state: auto-detected language: es (p = 0.989864)";
    expect(parseDetection(line)).toEqual({ language: "es", p: 0.989864 });
    expect(parseDetection("whisper_init_from_file: loading model")).toBeNull();
  });
});

it("reads --language auto, in any case, as no language", () => {
  expect(["auto", " AUTO "].map(requestedLanguage)).toEqual([undefined, undefined]);
  expect(requestedLanguage("es")).toBe("es");
  expect(requestedLanguage(undefined)).toBeUndefined();
});
