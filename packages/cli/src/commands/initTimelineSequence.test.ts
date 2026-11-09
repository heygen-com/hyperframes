import { describe, expect, it } from "vitest";
import { concatList, ffmpegSequenceArgs, resolveSequenceFiles } from "./initTimelineSequence.js";

const images = (...names: string[]) => names.map((name) => `frames/${name}.png`);

describe("resolveSequenceFiles", () => {
  const present =
    (...names: string[]) =>
    (image: string) => {
      const name = image.replace(/^frames\//, "").replace(/\.png$/, "");
      return names.includes(name) ? `/disk/${name}.png` : undefined;
    };

  it("lists the file for each frame, in order", () => {
    const result = resolveSequenceFiles(images("a", "b", "c"), present("a", "b", "c"));
    expect(result).toEqual({ files: ["/disk/a.png", "/disk/b.png", "/disk/c.png"], missing: 0 });
  });

  it("keeps an image listed for several frames", () => {
    const result = resolveSequenceFiles(images("a", "a", "b", "b"), present("a", "b"));
    expect(result?.files).toEqual(["/disk/a.png", "/disk/a.png", "/disk/b.png", "/disk/b.png"]);
    expect(result?.missing).toBe(0);
  });

  it("holds the previous image over a missing one and counts it", () => {
    const result = resolveSequenceFiles(images("a", "b", "c", "d"), present("a", "b", "d"));
    expect(result).toEqual({
      files: ["/disk/a.png", "/disk/b.png", "/disk/b.png", "/disk/d.png"],
      missing: 1,
    });
  });

  it("uses the first image found when the clip starts on a gap", () => {
    const result = resolveSequenceFiles(images("a", "b", "c", "d"), present("c", "d"));
    expect(result?.files).toEqual(["/disk/c.png", "/disk/c.png", "/disk/c.png", "/disk/d.png"]);
    expect(result?.missing).toBe(2);
  });

  it("returns null when no image exists", () => {
    expect(resolveSequenceFiles(images("a", "b"), present())).toBeNull();
  });

  it("asks the locator for exactly what the list says", () => {
    const asked: string[] = [];
    resolveSequenceFiles(["x/1.png", "file:///y/2.png"], (image) => {
      asked.push(image);
      return `/disk/${image.length}`;
    });
    expect(asked).toEqual(["x/1.png", "file:///y/2.png"]);
  });
});

describe("ffmpeg inputs", () => {
  it("shows each file for one frame, gives every image the rate, and repeats the last file", () => {
    expect(concatList(["/a.png", "/b.png"], 24)).toBe(
      [
        "ffconcat version 1.0",
        "file '/a.png'",
        "option framerate 24",
        "duration 0.041666666666666664",
        "file '/b.png'",
        "option framerate 24",
        "duration 0.041666666666666664",
        "file '/b.png'",
        "option framerate 24",
        "",
      ].join("\n"),
    );
  });

  it("names the rate on every image, not just the first", () => {
    const text = concatList(["/a.png", "/b.png", "/c.png"], 59.94005994);
    expect(text.match(/option framerate 59\.94005994/g)).toHaveLength(4);
  });

  it("quotes paths with apostrophes", () => {
    expect(concatList(["/it's/a.png"], 24)).toContain("file '/it'\\''s/a.png'");
  });

  it("bounds the output to one frame per listed image, at the rate", () => {
    const args = ffmpegSequenceArgs("/l.ffconcat", "/a.png", 23.976023976, 120, "/out.mp4");
    expect(args.slice(args.indexOf("-frames:v"), args.indexOf("-frames:v") + 2)).toEqual([
      "-frames:v",
      "120",
    ]);
    expect(args.slice(args.indexOf("-r"), args.indexOf("-r") + 2)).toEqual(["-r", "23.976023976"]);
    expect(args).toContain("pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p"); // even size, and no fps filter to resample
    expect(args.some((a) => a.startsWith("fps="))).toBe(false);
    expect(args.slice(-1)).toEqual(["/out.mp4"]);
    expect(args).not.toContain("-apply_trc");
  });

  it("decodes EXR as display light, whatever the case of the extension", () => {
    for (const first of ["/a.exr", "/A.EXR"]) {
      const args = ffmpegSequenceArgs("/l", first, 24, 1, "/o.mp4");
      expect(args.slice(args.indexOf("-apply_trc"), args.indexOf("-apply_trc") + 2)).toEqual([
        "-apply_trc",
        "iec61966_2_1",
      ]);
      expect(args.indexOf("-apply_trc")).toBeLessThan(args.indexOf("-i"));
    }
  });
});
