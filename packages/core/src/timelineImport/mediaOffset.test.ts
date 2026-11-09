import { describe, expect, it } from "vitest";
import { resolveMediaStart } from "./index";

const resolve = (
  mediaStart: number,
  fileOrigin: number,
  mediaOrigin: number | null,
  fileDuration: number | undefined,
) => resolveMediaStart({ mediaStart, fileOrigin, mediaOrigin, fileDuration });

describe("resolveMediaStart: the cases real files produced", () => {
  it("a file whose timecode starts where the edit says (ALab: no range, a 2.17 s file at 00:00:41:18)", () => {
    expect(resolve(41.75, 41.75, null, 2.1667)).toEqual({ mediaStart: 0, basis: "file" });
    expect(resolve(41.75 + 0.5, 41.75, null, 2.1667)).toEqual({ mediaStart: 0.5, basis: "file" });
  });

  it("a long file with no timecode and a window for a range (Picchu: 4047 s file, start 3510.83 s)", () => {
    // The window's start (3509.2 s) is not the file's origin. The file has none, so it is 0.
    expect(resolve(3510.83, 0, 3509.2, 4047.12)).toEqual({ mediaStart: 3510.83, basis: "file" });
  });

  it("a WAV that starts at one hour, with the clip on the same clock", () => {
    expect(resolve(3600 + 12.5, 3600, null, 103)).toEqual({ mediaStart: 12.5, basis: "file" });
  });

  it("an EDL: a source timecode on a file that carries that timecode", () => {
    expect(resolve(3600 + 10, 3600, null, 60)).toEqual({ mediaStart: 10, basis: "file" });
  });

  it("file-relative times from a converter, on a file with no timecode", () => {
    expect(resolve(10, 0, 0, 60)).toEqual({ mediaStart: 10, basis: "file" });
  });
});

describe("resolveMediaStart: when the file's timecode does not fit", () => {
  it("falls back to the converter's hint (no timecode in the file, the editor numbers from one hour)", () => {
    expect(resolve(3600 + 10, 0, 3600, 60)).toEqual({ mediaStart: 10, basis: "hint" });
  });

  it("falls back to the hint when the converter wrote file-relative times on a file that has a timecode", () => {
    expect(resolve(10, 3600, 0, 60)).toEqual({ mediaStart: 10, basis: "hint" });
  });

  it("reads the offset as seconds into the file when nothing else fits and it does", () => {
    // A converter that already subtracted the origin and sent no hint, on a file with a timecode.
    expect(resolve(10, 3600, null, 60)).toEqual({ mediaStart: 10, basis: "relative" });
    // The same when the hint is wrong for this clip.
    expect(resolve(10, 3600, 7200, 60)).toEqual({ mediaStart: 10, basis: "relative" });
  });

  it("tries the file, then the hint, then the offset as it stands, in that order", () => {
    // 3650 fits under the file's timecode (3600) and under a hint of 3000: the file wins.
    expect(resolve(3650, 3600, 3000, 100).basis).toBe("file");
    // Under 3600 it is -250; the hint 3000 puts it at 650, past a 100 s file; as it stands it is 3650: unfit.
    expect(resolve(3650, 3900, 3000, 100).basis).toBe("unfit");
    // A hint that fits beats reading the offset as it stands.
    expect(resolve(40, 3600, 30, 100)).toEqual({ mediaStart: 10, basis: "hint" });
  });

  it("reports a clip no reading puts inside the file, and keeps the file's reading", () => {
    // EDL timecode of one hour on a file with no timecode and no hint: it cannot be placed.
    expect(resolve(3610, 0, null, 60)).toEqual({ mediaStart: 3610, basis: "unfit" });
    // A hint that does not fit either.
    expect(resolve(3610, 0, 7200, 60)).toEqual({ mediaStart: 3610, basis: "unfit" });
  });

  it("never returns a negative offset", () => {
    expect(resolve(0, 3600, null, 60).mediaStart).toBe(0);
    expect(resolve(-0.05, 0, null, 60).mediaStart).toBe(0);
  });

  it("prefers the file over the hint when both fit, because the file knows where it starts", () => {
    // Both put the clip inside a 100 s file; the file's own timecode wins.
    expect(resolve(50, 0, 20, 100)).toEqual({ mediaStart: 50, basis: "file" });
  });

  it("ignores a hint that is the same as the file's origin", () => {
    expect(resolve(3610, 0, 0, 60).basis).toBe("unfit");
  });
});

describe("resolveMediaStart: edges", () => {
  it("tolerates a clip that starts a few frames before the file does", () => {
    expect(resolve(-0.04, 0, null, 60)).toEqual({ mediaStart: 0, basis: "file" });
  });

  it("judges a clip by its start, not its end", () => {
    // 1.9 s into a 2 s file is fine however long the clip is; 2.05 s is past the end.
    expect(resolve(1.9, 0, null, 2).basis).toBe("file");
    expect(resolve(2.2, 0, null, 2).basis).toBe("unfit");
  });

  it("accepts the file's reading when its length is unknown", () => {
    expect(resolve(30, 0, null, undefined)).toEqual({ mediaStart: 30, basis: "file" });
    expect(resolve(-5, 0, null, undefined).basis).toBe("unfit");
  });

  it("rounds up to the microsecond, so a frame boundary never lands a hair early", () => {
    // 10 frames at 29.97 fps is 0.33366666... s; a rounded-up value is never below it.
    const exact = 10 / (30000 / 1001);
    const { mediaStart } = resolve(exact + 5, 5, null, 60);
    expect(mediaStart).toBeGreaterThanOrEqual(exact);
    expect(mediaStart - exact).toBeLessThan(1.1e-6);
    // and an exact value is not pushed up a microsecond by float noise
    expect(resolve(3.0000000000000004, 1, null, 60).mediaStart).toBe(2);
  });
});
