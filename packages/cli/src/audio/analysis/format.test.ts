import { describe, expect, it } from "vitest";
import { formatReport, sparkline } from "./format.js";
import type { AudioItem } from "./run.js";

const item = (fields: Partial<AudioItem>): AudioItem => ({
  file: "sfx/hit.wav",
  ref: "#hit",
  element: "audio",
  placement: { start: 10, end: 11, dataStart: 10, mediaStart: 0.5, playbackRate: 1, volume: 1 },
  timebase: "file",
  window: { from: 0.5, to: 1.5 },
  duration: 1.5,
  sampleRate: 48000,
  channels: 2,
  provenance: {},
  warnings: [],
  ...fields,
});

describe("sparkline", () => {
  it("draws the quiet floor low and the loudest slice high, one character per slice", () => {
    const line = sparkline({ hopMs: 10, scale: "db", values: [-80, -80, -40, -6, -3, -20] }, 6);
    expect(line[0]).toBe("▁");
    expect(line.at(-2)).toBe("█");
    expect([...line]).toHaveLength(6);
  });
});

describe("formatReport", () => {
  it("prints control characters from the project's src, id, errors and warnings as visible escapes", () => {
    const text = formatReport({
      version: 1,
      items: [
        item({ file: "a\x1b[2K.wav", ref: "#x\x07", warnings: ["w\x1b]52;c;aGk=\x07", "a\nb"] }),
        item({ file: "gone\x9b.wav", ref: null, error: "missing \x1b[8m" }),
      ],
    });
    expect(text).toContain("a\\x1b[2K.wav #x\\x07");
    expect(text).toContain("! w\\x1b]52;c;aGk=\\x07");
    expect(text).toContain("! a\\x0ab");
    expect(text).toContain("gone\\x9b.wav: missing \\x1b[8m");
    for (const raw of ["\x07", "\x1b", "\x9b"]) expect(text).not.toContain(raw);
  });

  it("prints file seconds as film seconds through the clip's placement", () => {
    const text = formatReport({
      version: 1,
      items: [item({ moments: { onset: 0.6, steepest: 0.61, peak: 0.62, tailEnd: 1.2 } })],
    });
    expect(text).toContain("onset 10.100  steepest 10.110  peak 10.120  tail end 10.700");
  });

  it("caps the hit list and says how many more there are", () => {
    const events = Array.from({ length: 15 }, (_, i) => ({ t: 0.5 + i * 0.05, strength: 1 }));
    const text = formatReport({
      version: 1,
      items: [item({ onsets: { method: "spectral-flux", events } })],
    });
    expect(text).toMatch(/hits (\S+ ){12}\+3$/m);
  });

  it("shows an item's error in place of its measurements", () => {
    expect(formatReport({ version: 1, items: [item({ error: "file not found" })] })).toBe(
      "sfx/hit.wav #hit: file not found",
    );
  });
});
