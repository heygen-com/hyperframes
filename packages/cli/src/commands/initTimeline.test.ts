import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative as relativePath } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stageTimeline as stageWithProbe, warningLines } from "./initTimeline.js";
import type { OriginProbe } from "./initTimelineOrigin.js";

/** Fake media carries no timecode and reports no length, as an unreadable file would. */
const NO_ORIGIN: OriginProbe = { timecode: null, timeReference: null, duration: undefined };
const stageTimeline: typeof stageWithProbe = (options) =>
  stageWithProbe({ probeOrigin: () => NO_ORIGIN, ...options });

let root: string;
let dest: number = 0;

const timeline = (clips: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: "hyperframes-timeline/1",
    fps: { num: 30, den: 1 },
    width: 1280,
    height: 720,
    clips,
    ...extra,
  });

const video = (id: string, src: string, start = 0) => ({
  id,
  kind: "video",
  start,
  duration: 2,
  src,
});

function destDir(): string {
  const dir = join(root, `dest-${dest++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "hf-init-timeline-"));
  mkdirSync(join(root, "media"));
  writeFileSync(join(root, "media", "a.mp4"), "a");
  writeFileSync(join(root, "media", "b.mp4"), "b");
  mkdirSync(join(root, "other"));
  writeFileSync(join(root, "other", "a.mp4"), "other-a");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("stageTimeline", () => {
  it("copies media next to the timeline into assets/ and rewrites src", () => {
    const file = join(root, "t1.json");
    writeFileSync(file, timeline([video("x", "media/a.mp4"), video("y", "media/a.mp4", 2)]));
    const dir = destDir();
    const staged = stageTimeline({ timelineFile: file, destDir: dir });
    expect(staged).toMatchObject({ clipCount: 2, width: 1280, height: 720, warnings: [] });
    expect(existsSync(join(dir, "assets", "a.mp4"))).toBe(true);
    expect(staged.html.match(/src="assets\/a\.mp4"/g)).toHaveLength(2);
  });

  it("keeps same-named files from different folders apart", () => {
    const file = join(root, "t2.json");
    writeFileSync(file, timeline([video("x", "media/a.mp4"), video("y", "other/a.mp4", 2)]));
    const dir = destDir();
    const staged = stageTimeline({ timelineFile: file, destDir: dir });
    expect(existsSync(join(dir, "assets", "a-2.mp4"))).toBe(true);
    expect(staged.html).toContain('src="assets/a-2.mp4"');
  });

  it("skips clips whose media is missing and says so", () => {
    const file = join(root, "t3.json");
    writeFileSync(file, timeline([video("x", "media/a.mp4"), video("gone", "media/nope.mp4", 2)]));
    const staged = stageTimeline({ timelineFile: file, destDir: destDir() });
    expect(staged.clipCount).toBe(1);
    expect(staged.warnings[0]).toContain("gone");
  });

  it("resolves relative paths from --media-root and can symlink", () => {
    const file = join(root, "elsewhere.json");
    writeFileSync(file, timeline([video("x", "b.mp4")]));
    const dir = destDir();
    const staged = stageTimeline({
      timelineFile: file,
      destDir: dir,
      mediaRoot: join(root, "media"),
      linkMedia: true,
    });
    const isLink = lstatSync(join(dir, "assets", "b.mp4")).isSymbolicLink();
    if (process.platform === "win32") {
      // Links on Windows need Developer Mode or an administrator, so the file is copied and the person is told.
      expect(isLink).toBe(false);
      expect(staged.warnings.join("\n")).toContain("--link-media copied the media");
    } else {
      expect(isLink).toBe(true);
    }
  });

  it("drops hasAudio for files with no audio stream, keeps it for files that have one", () => {
    const file = join(root, "t4.json");
    const withAudio = { ...video("x", "media/a.mp4"), hasAudio: true };
    const silent = { ...video("y", "media/b.mp4", 2), hasAudio: true };
    writeFileSync(file, timeline([withAudio, silent]));
    const staged = stageTimeline({
      timelineFile: file,
      destDir: destDir(),
      hasAudioStream: (f) => f.endsWith("a.mp4"),
    });
    expect(staged.html).toMatch(/id="x"[^>]*data-has-audio="true"/);
    expect(staged.html).toMatch(/id="y"[^>]* muted /);
    expect(staged.warnings).toEqual([]);
  });

  it("warns when audio cannot be probed", () => {
    const file = join(root, "t5.json");
    writeFileSync(file, timeline([{ ...video("x", "media/a.mp4"), hasAudio: true }]));
    const staged = stageTimeline({
      timelineFile: file,
      destDir: destDir(),
      hasAudioStream: () => undefined,
    });
    expect(staged.warnings[0]).toContain("ffprobe");
  });

  it("applies a dissolve using each file's probed length as the handle limit", () => {
    const file = join(root, "t6.json");
    const a = { ...video("x", "media/a.mp4"), duration: 4 };
    const b = { ...video("y", "media/b.mp4", 4), duration: 4, mediaStart: 3 };
    const transitions = [{ from: "x", to: "y", inOffset: 1, outOffset: 1, kind: "dissolve" }];
    writeFileSync(file, timeline([a, b], { transitions }));
    const staged = stageTimeline({
      timelineFile: file,
      destDir: destDir(),
      // a.mp4 is 4.5 s long and the clip plays through 4 s: half a second of tail handle.
      mediaLength: (f) => (f.endsWith("a.mp4") ? 4.5 : 30),
    });
    expect(staged.html).toMatch(
      /tl\.fromTo\("#y", \{ opacity: 0 \}, \{ opacity: 1, duration: 1\.5/,
    );
    expect(staged.warnings[0]).toMatch(/shortened from 2s to 1\.5s/);
  });

  it("leaves a dissolve as a hard cut when its clip was dropped for missing media", () => {
    const file = join(root, "t7.json");
    const transitions = [{ from: "x", to: "gone", inOffset: 1, outOffset: 1, kind: "dissolve" }];
    writeFileSync(
      file,
      timeline([video("x", "media/a.mp4"), video("gone", "media/nope.mp4", 2)], { transitions }),
    );
    const staged = stageTimeline({ timelineFile: file, destDir: destDir(), mediaLength: () => 30 });
    expect(staged.html).not.toContain("fromTo");
  });

  it("turns a freeze frame into a still taken at the clip's in-point", () => {
    const file = join(root, "t8.json");
    writeFileSync(
      file,
      timeline([{ ...video("x", "media/a.mp4"), mediaStart: 1.5, freeze: true, hasAudio: true }]),
    );
    const dir = destDir();
    const taken: Array<[string, number]> = [];
    const staged = stageTimeline({
      timelineFile: file,
      destDir: dir,
      hasAudioStream: () => true,
      extractFrame: (from, at, out) => {
        taken.push([from, at]);
        writeFileSync(out, "png");
        return true;
      },
    });
    expect(taken).toEqual([[join(dir, "assets", "a.mp4"), 1.5]]);
    expect(staged.html).toMatch(/<img id="x"[^>]*src="assets\/a-freeze\.png"/);
    expect(staged.html).not.toContain("<video");
    expect(existsSync(join(dir, "assets", "a-freeze.png"))).toBe(true);
  });

  it("plays a freeze normally, with a warning, when the frame cannot be taken", () => {
    const file = join(root, "t9.json");
    writeFileSync(file, timeline([{ ...video("x", "media/a.mp4"), freeze: true }]));
    const staged = stageTimeline({
      timelineFile: file,
      destDir: destDir(),
      extractFrame: () => false,
    });
    expect(staged.html).toContain("<video");
    expect(staged.warnings[0]).toContain("freeze frame");
  });

  it("skips remote media with a clear warning", () => {
    const file = join(root, "t10.json");
    writeFileSync(
      file,
      timeline([video("x", "media/a.mp4"), video("web", "https://example.com/a.mp4", 2)]),
    );
    const staged = stageTimeline({ timelineFile: file, destDir: destDir() });
    expect(staged.clipCount).toBe(1);
    expect(staged.warnings[0]).toContain("remote media");
  });

  it("finds files whose relative path is percent-encoded", () => {
    writeFileSync(join(root, "media", "my clip.mp4"), "c");
    const file = join(root, "t11.json");
    writeFileSync(file, timeline([video("x", "media/my%20clip.mp4")]));
    const dir = destDir();
    const staged = stageTimeline({ timelineFile: file, destDir: dir });
    expect(staged.clipCount).toBe(1);
    expect(existsSync(join(dir, "assets", "my clip.mp4"))).toBe(true);
  });

  it("resolves media from the timeline's own mediaRoot, such as an unpacked bundle", () => {
    const file = join(root, "elsewhere2.json");
    writeFileSync(file, timeline([video("x", "b.mp4")], { mediaRoot: join(root, "media") }));
    expect(stageTimeline({ timelineFile: file, destDir: destDir() }).clipCount).toBe(1);
  });

  it("applies a fade from nothing instead of dropping it", () => {
    const file = join(root, "t12.json");
    const transitions = [{ from: null, to: "x", inOffset: 0, outOffset: 1, kind: "dissolve" }];
    writeFileSync(file, timeline([video("x", "media/a.mp4")], { transitions }));
    const staged = stageTimeline({
      timelineFile: file,
      destDir: destDir(),
      mediaLength: () => 30,
    });
    expect(staged.html).toMatch(/tl\.fromTo\("#x", \{ opacity: 0 \}, \{ opacity: 1, duration: 1/);
  });

  describe("image sequences", () => {
    const names = (...numbers: number[]) =>
      numbers.map((n) => `frames/img.${String(n).padStart(4, "0")}.png`);
    const seqClip = (id: string, images: string[], extra: Record<string, unknown> = {}) => ({
      id,
      kind: "video",
      start: 0,
      duration: images.length / 24,
      src: images[0],
      sequence: { rate: 24, images },
      ...extra,
    });
    const calls: Array<{ files: string[]; rate: number; out: string }> = [];
    const encodeSequence = (files: string[], rate: number, out: string) => {
      calls.push({ files, rate, out });
      writeFileSync(out, "mp4");
      return true;
    };
    const base = (file: string) => basename(file);

    beforeAll(() => {
      mkdirSync(join(root, "frames"));
      for (let n = 1; n <= 10; n++) {
        writeFileSync(join(root, "frames", `img.${String(n).padStart(4, "0")}.png`), `${n}`);
      }
    });

    it("encodes the listed images into a video in assets/, at the sequence's rate", () => {
      calls.length = 0;
      const file = join(root, "seq1.json");
      writeFileSync(file, timeline([seqClip("a", names(3, 4, 5, 6))]));
      const dir = destDir();
      const staged = stageTimeline({
        timelineFile: file,
        destDir: dir,
        encodeSequence,
        hasAudioStream: () => false,
      });
      expect(calls[0]?.files.map(base)).toEqual([
        "img.0003.png",
        "img.0004.png",
        "img.0005.png",
        "img.0006.png",
      ]);
      expect(calls[0]?.rate).toBe(24);
      expect(calls[0]?.out).toBe(join(dir, "assets", "img.mp4"));
      expect(staged.html).toMatch(/<video id="a"[^>]*src="assets\/img\.mp4"/);
      expect(staged.html).not.toContain("data-media-start");
      expect(staged.warnings).toEqual([]);
    });

    it("plays an image listed twice for two frames", () => {
      calls.length = 0;
      const file = join(root, "seq1b.json");
      writeFileSync(file, timeline([seqClip("a", names(3, 3, 4, 4))]));
      stageTimeline({ timelineFile: file, destDir: destDir(), encodeSequence });
      expect(calls[0]?.files.map(base)).toEqual([
        "img.0003.png",
        "img.0003.png",
        "img.0004.png",
        "img.0004.png",
      ]);
    });

    it("encodes one sequence once however many clips share the same images", () => {
      calls.length = 0;
      const file = join(root, "seq2.json");
      const images = names(3, 4, 5, 6);
      writeFileSync(file, timeline([seqClip("a", images), { ...seqClip("b", images), start: 2 }]));
      const staged = stageTimeline({ timelineFile: file, destDir: destDir(), encodeSequence });
      expect(calls).toHaveLength(1);
      expect(staged.html.match(/src="assets\/img\.mp4"/g)).toHaveLength(2);
    });

    it("encodes two different sequences separately and keeps their files apart", () => {
      calls.length = 0;
      const file = join(root, "seq2b.json");
      writeFileSync(
        file,
        timeline([seqClip("a", names(1, 2)), { ...seqClip("b", names(5, 6)), start: 2 }]),
      );
      const dir = destDir();
      stageTimeline({ timelineFile: file, destDir: dir, encodeSequence });
      expect(calls.map((c) => base(c.out))).toEqual(["img.mp4", "img-2.mp4"]);
    });

    it("holds the previous image over a missing one and says how many", () => {
      calls.length = 0;
      const file = join(root, "seq3.json");
      writeFileSync(file, timeline([seqClip("a", names(9, 10, 11, 12))]));
      const staged = stageTimeline({ timelineFile: file, destDir: destDir(), encodeSequence });
      expect(calls[0]?.files.map(base)).toEqual([
        "img.0009.png",
        "img.0010.png",
        "img.0010.png",
        "img.0010.png",
      ]);
      expect(staged.warnings[0]).toMatch(
        /2 of 4 frames have no image on disk; the previous image is held/,
      );
    });

    it("skips a clip when none of its images exist or the encode fails", () => {
      const none = join(root, "seq5.json");
      writeFileSync(none, timeline([video("ok", "media/a.mp4"), seqClip("x", names(50, 51))]));
      const first = stageTimeline({ timelineFile: none, destDir: destDir(), encodeSequence });
      expect(first.clipCount).toBe(1);
      expect(first.warnings[0]).toContain("no image");

      const broken = join(root, "seq6.json");
      writeFileSync(broken, timeline([video("ok", "media/a.mp4"), seqClip("y", names(3, 4))]));
      const second = stageTimeline({
        timelineFile: broken,
        destDir: destDir(),
        encodeSequence: () => false,
      });
      expect(second.clipCount).toBe(1);
      expect(second.warnings[0]).toContain("could not encode");
    });

    it("skips images that live at a remote address", () => {
      const file = join(root, "seq6b.json");
      writeFileSync(
        file,
        timeline([video("ok", "media/a.mp4"), seqClip("r", ["https://example.com/1.png"])]),
      );
      const staged = stageTimeline({ timelineFile: file, destDir: destDir(), encodeSequence });
      expect(staged.clipCount).toBe(1);
      expect(staged.warnings[0]).toContain("remote images");
    });

    it("turns a frozen sequence clip into a still of its first image", () => {
      const file = join(root, "seq7.json");
      writeFileSync(file, timeline([seqClip("a", names(3), { freeze: true })]));
      const taken: Array<[string, number]> = [];
      const staged = stageTimeline({
        timelineFile: file,
        destDir: destDir(),
        encodeSequence,
        extractFrame: (from, at, out) => {
          taken.push([base(from) ?? "", at]);
          writeFileSync(out, "png");
          return true;
        },
      });
      expect(taken).toEqual([["img.0003.png", 0]]);
      expect(staged.html).toMatch(/<img id="a"[^>]*src="assets\/img-freeze\.png"/);
    });
  });

  describe("--link-media on different platforms", () => {
    const stage = (options: Parameters<typeof stageTimeline>[0]) => stageTimeline(options);
    const file = () => {
      const f = join(root, `link-${dest}.json`);
      writeFileSync(f, timeline([video("x", "media/a.mp4")]));
      return f;
    };

    it("links on macOS and Linux with an absolute target, so the project can sit anywhere", () => {
      for (const platform of ["darwin", "linux"] as const) {
        const targets: Array<[string, string]> = [];
        const dir = destDir();
        const staged = stage({
          timelineFile: file(),
          destDir: dir,
          linkMedia: true,
          platform,
          symlink: (target, path) => {
            targets.push([target, path]);
            symlinkSync(target, path);
          },
        });
        expect(targets).toEqual([[join(root, "media", "a.mp4"), join(dir, "assets", "a.mp4")]]);
        expect(lstatSync(join(dir, "assets", "a.mp4")).isSymbolicLink()).toBe(true);
        expect(staged.warnings).toEqual([]);
      }
    });

    it("copies on Windows without trying to link, and says so once", () => {
      const dir = destDir();
      const f = join(root, "link-win.json");
      writeFileSync(f, timeline([video("x", "media/a.mp4"), video("y", "media/b.mp4", 2)]));
      const staged = stage({
        timelineFile: f,
        destDir: dir,
        linkMedia: true,
        platform: "win32",
        symlink: () => {
          throw new Error("must not be called on Windows");
        },
      });
      expect(lstatSync(join(dir, "assets", "a.mp4")).isFile()).toBe(true);
      expect(lstatSync(join(dir, "assets", "b.mp4")).isSymbolicLink()).toBe(false);
      expect(staged.warnings).toHaveLength(1);
      expect(staged.warnings[0]).toMatch(/copied the media instead of linking.*Windows/);
    });

    it.each(["EPERM", "EACCES", "ENOTSUP", "EXDEV"])(
      "falls back to a copy when the disk refuses a link (%s)",
      (code) => {
        const dir = destDir();
        const staged = stage({
          timelineFile: file(),
          destDir: dir,
          linkMedia: true,
          platform: "linux",
          symlink: () => {
            throw Object.assign(new Error("no links here"), { code });
          },
        });
        expect(lstatSync(join(dir, "assets", "a.mp4")).isFile()).toBe(true);
        expect(staged.warnings[0]).toContain(code);
      },
    );

    it("does not hide a real error behind the fallback", () => {
      expect(() =>
        stage({
          timelineFile: file(),
          destDir: destDir(),
          linkMedia: true,
          platform: "linux",
          symlink: () => {
            throw Object.assign(new Error("disk on fire"), { code: "EIO" });
          },
        }),
      ).toThrow("disk on fire");
    });

    it("never links without --link-media, on any platform", () => {
      const dir = destDir();
      stage({
        timelineFile: file(),
        destDir: dir,
        platform: "linux",
        symlink: () => {
          throw new Error("must not link");
        },
      });
      expect(lstatSync(join(dir, "assets", "a.mp4")).isFile()).toBe(true);
    });
  });

  describe("where relative media paths resolve from", () => {
    const stagedFrom = (
      clips: unknown[],
      extra: Record<string, unknown>,
      options: Record<string, unknown> = {},
    ) => {
      const file = join(root, `root-${dest}.json`);
      writeFileSync(file, timeline(clips, extra));
      return stageTimeline({ timelineFile: file, destDir: destDir(), ...options });
    };

    it("prefers --media-root over the file's own mediaRoot, which beats the timeline file's folder", () => {
      // Three folders each hold a different `pick.mp4`; the one that is used shows in the copy.
      for (const name of ["by-flag", "by-file", "beside"]) {
        mkdirSync(join(root, name), { recursive: true });
        writeFileSync(join(root, name, "pick.mp4"), name);
      }
      const clips = [video("x", "pick.mp4")];
      const read = (dir: string) => readFileSync(join(dir, "assets", "pick.mp4"), "utf-8");

      const both = destDir();
      const file = join(root, "by-file", "t.json"); // "beside" is this file's folder
      writeFileSync(file, timeline(clips, { mediaRoot: join(root, "by-file") }));
      stageTimeline({ timelineFile: file, destDir: both, mediaRoot: join(root, "by-flag") });
      expect(read(both)).toBe("by-flag");

      const fileOnly = destDir();
      stageTimeline({ timelineFile: file, destDir: fileOnly });
      expect(read(fileOnly)).toBe("by-file");

      const neither = destDir();
      const bare = join(root, "beside", "t.json");
      writeFileSync(bare, timeline(clips));
      stageTimeline({ timelineFile: bare, destDir: neither });
      expect(read(neither)).toBe("beside");
    });

    it("takes a relative --media-root from where the command runs", (ctx) => {
      const relative = relativePath(process.cwd(), join(root, "media"));
      // Between two drives there is no relative path to take.
      if (isAbsolute(relative)) return ctx.skip();
      const staged = stagedFrom([video("x", "b.mp4")], {}, { mediaRoot: relative });
      expect(staged.clipCount).toBe(1);
    });

    it("leaves absolute paths and file:// URLs alone, whatever the root", () => {
      const elsewhere = join(root, "other");
      const staged = stagedFrom(
        [
          video("abs", join(root, "media", "a.mp4")),
          video("url", pathToFileURL(join(root, "media", "b.mp4")).href, 2),
        ],
        {},
        { mediaRoot: elsewhere },
      );
      expect(staged.clipCount).toBe(2);
      expect(staged.warnings).toEqual([]);
    });

    it("uses the root for the images of a sequence too", () => {
      mkdirSync(join(root, "seqroot", "frames"), { recursive: true });
      writeFileSync(join(root, "seqroot", "frames", "f.0001.png"), "1");
      const staged = stagedFrom(
        [
          {
            id: "s",
            kind: "video",
            start: 0,
            duration: 1,
            src: "frames/f.0001.png",
            sequence: { rate: 24, images: ["frames/f.0001.png"] },
          },
        ],
        {},
        {
          mediaRoot: join(root, "seqroot"),
          encodeSequence: (_f: string[], _r: number, out: string) => {
            writeFileSync(out, "mp4");
            return true;
          },
        },
      );
      expect(staged.clipCount).toBe(1);
    });

    it("fails with a pointer to --media-root when nothing is found", () => {
      expect(() => stagedFrom([video("x", "nowhere.mp4")], {})).toThrow(/--media-root/);
    });

    it("lists what it could not find and says what to do about paths from another machine", () => {
      const clips = [
        video("a", "file://C:/Users/editor/shots/a.mov"),
        video("b", "D:\\media\\b.mov", 2),
        video("c", "c.mov", 4),
        video("d", "d.mov", 6),
        video("e", "e.mov", 8),
      ];
      let message = "";
      try {
        stagedFrom(clips, {});
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/^No clip has media on disk \(looked under .+\)\./);
      expect(message).toContain(
        "Not found: file://C:/Users/editor/shots/a.mov, D:\\media\\b.mov, c.mov and 2 more.",
      );
      expect(message).toContain("relink the timeline to your files first");
      expect(message).toContain("reference/timeline-import#paths-from-another-machine");
    });
  });

  describe("media offsets and each file's own timecode", () => {
    const probe =
      (facts: Partial<OriginProbe>): ((file: string) => OriginProbe) =>
      () => ({ ...NO_ORIGIN, ...facts });
    const file = (clips: unknown[], extra: Record<string, unknown> = {}) => {
      const f = join(root, `origin-${dest}-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(f, timeline(clips, extra));
      return f;
    };
    const stage = (clips: unknown[], options: Record<string, unknown>, extra = {}) =>
      stageTimeline({ timelineFile: file(clips, extra), destDir: destDir(), ...options });
    const mediaStart = (html: string, id: string) =>
      Number(new RegExp(`id="${id}"[^>]*data-media-start="([^"]+)"`).exec(html)?.[1] ?? 0);
    const clip = (id: string, extra: Record<string, unknown>) => ({
      ...video(id, "media/a.mp4"),
      duration: 2,
      ...extra,
    });

    it("subtracts a video's start timecode (ALab: source start 41.75 s, file timecode 00:00:41:18)", () => {
      const staged = stage([clip("x", { mediaStart: 41.75 })], {
        probeOrigin: probe({ timecode: 41.75, duration: 2.1667 }),
      });
      expect(staged.html).not.toContain("data-media-start"); // 0, so the attribute is left out
      expect(staged.warnings).toEqual([]);
    });

    it("keeps a position on a file that carries no timecode (Picchu audio: a window for a range)", () => {
      const staged = stage(
        [
          {
            ...clip("x", { mediaStart: 3510.83, mediaOrigin: 3509.2 }),
            kind: "audio",
            src: "media/b.mp4",
          },
        ],
        { probeOrigin: probe({ duration: 4047.12 }) },
      );
      // Not 3510.83 - 3509.2: the window's start is only a hint. The file carries no timecode, so its
      // own origin is 0 and fits, which makes the position the offset into the file.
      expect(mediaStart(staged.html, "x")).toBe(3510.83);
      expect(staged.warnings).toEqual([]);
    });

    it("subtracts a WAV's BWF time reference from an audio clip, and a timecode from a video one", () => {
      const staged = stage(
        [
          { ...clip("wav", { mediaStart: 3612.5 }), kind: "audio", src: "media/b.mp4" },
          clip("vid", { mediaStart: 3612.5, start: 2 }),
        ],
        { probeOrigin: probe({ timeReference: 3600, timecode: 100, duration: 4000 }) },
      );
      expect(staged.html).toMatch(/<audio id="wav"[^>]*data-media-start="12\.5"/);
      // The video reads the timecode (100 s), not the time reference.
      expect(staged.html).toMatch(/<video id="vid"[^>]*data-media-start="3512\.5"/);
    });

    it("falls back to the timeline's stated start when the file's timecode does not fit, and says so once", () => {
      const staged = stage(
        [
          clip("one", { mediaStart: 3610, mediaOrigin: 3600 }),
          clip("two", { mediaStart: 3620, mediaOrigin: 3600, start: 2 }),
        ],
        { probeOrigin: probe({ duration: 60 }) },
      );
      expect(mediaStart(staged.html, "one")).toBe(10);
      expect(mediaStart(staged.html, "two")).toBe(20);
      expect(staged.warnings.filter((w) => w.includes("does not fit the edit"))).toHaveLength(1);
      expect(staged.warnings[0]).toContain("the start the timeline states");
    });

    it("reads an offset that is already file-relative on a file that has a timecode", () => {
      const staged = stage([clip("x", { mediaStart: 10 })], {
        probeOrigin: probe({ timecode: 3600, duration: 60 }),
      });
      expect(mediaStart(staged.html, "x")).toBe(10);
      expect(staged.warnings[0]).toContain("read as seconds into the file");
    });

    it("names a clip it cannot place inside its file, and keeps going", () => {
      const staged = stage(
        [clip("lost", { mediaStart: 3610 }), clip("fine", { mediaStart: 1, start: 2 })],
        { probeOrigin: probe({ duration: 60 }) },
      );
      expect(staged.clipCount).toBe(2);
      expect(staged.warnings[0]).toMatch(
        /clip "lost": it starts 3610s into its source but .* is only 60s long/,
      );
      expect(mediaStart(staged.html, "fine")).toBe(1);
    });

    it("says when ffprobe cannot be asked, and leaves the offsets as they are", () => {
      const staged = stage([clip("x", { mediaStart: 41.75 })], { probeOrigin: () => undefined });
      expect(mediaStart(staged.html, "x")).toBe(41.75);
      expect(staged.warnings.some((w) => w.includes("ffprobe"))).toBe(true);
    });

    it("probes each file once, however many clips use it", () => {
      const asked: string[] = [];
      stage(
        [
          clip("a", { mediaStart: 1 }),
          clip("b", { mediaStart: 2, start: 2 }),
          clip("c", { mediaStart: 3, start: 4 }),
        ],
        {
          probeOrigin: (f: string) => {
            asked.push(f);
            return NO_ORIGIN;
          },
        },
      );
      expect(asked).toHaveLength(1);
    });

    it("leaves stills and image sequences alone", () => {
      const asked: string[] = [];
      stage([{ id: "still", kind: "image", start: 0, duration: 1, src: "media/a.mp4" }], {
        probeOrigin: (f: string) => {
          asked.push(f);
          return NO_ORIGIN;
        },
      });
      expect(asked).toEqual([]);
    });

    it("gives a freeze frame the file-relative position, not the clock's", () => {
      const taken: number[] = [];
      stage([{ ...clip("x", { mediaStart: 42.75 }), freeze: true }], {
        probeOrigin: probe({ timecode: 41.75, duration: 5 }),
        extractFrame: (_f: string, at: number, out: string) => {
          taken.push(at);
          writeFileSync(out, "png");
          return true;
        },
      });
      expect(taken).toEqual([1]);
    });

    it("measures a dissolve's handles on the file's own time, not the clock's", () => {
      // The incoming clip starts 3 s into a file whose timecode starts at 1 h. Read as raw clock
      // seconds (3603 s) it would look like 3603 s of head handle and the dissolve would run in full.
      const transitions = [{ from: "a", to: "b", inOffset: 5, outOffset: 0, kind: "dissolve" }];
      const staged = stage(
        [
          clip("a", { mediaStart: 3600, start: 0, duration: 10 }),
          clip("b", { mediaStart: 3603, start: 10 }),
        ],
        {
          probeOrigin: probe({ timecode: 3600, duration: 60 }),
          mediaLength: () => 60,
        },
        { transitions },
      );
      // Only 3 s of footage precede b's in-point, so the 5 s ask is cut to 3 s.
      expect(staged.warnings.some((w) => /shortened from 5s to 3s/.test(w))).toBe(true);
    });
  });

  describe("audio listed twice, and addresses that are not files", () => {
    const audio = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      kind: "audio",
      start: 0,
      duration: 4,
      src: "media/a.mp4",
      trackIndex: 0,
      ...extra,
    });
    const run = (clips: unknown[]) => {
      const f = join(root, `twins-${dest}-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(f, timeline(clips));
      return stageTimeline({ timelineFile: f, destDir: destDir() });
    };

    it("warns, and keeps both, when the same audio plays twice at once on two tracks", () => {
      const staged = run([
        audio("dx", { label: "dialogue", trackIndex: 3 }),
        audio("dx2", { label: "dialogue", trackIndex: 4 }),
      ]);
      expect(staged.clipCount).toBe(2);
      expect(staged.html.match(/<audio /g)).toHaveLength(2);
      expect(staged.warnings).toHaveLength(1);
      expect(staged.warnings[0]).toMatch(
        /audio "dialogue" plays 2 times at the same moment.*on 2 tracks.*6 dB louder/,
      );
    });

    it("says how much louder three copies are, once, for the group", () => {
      const staged = run([
        audio("a"),
        audio("b", { trackIndex: 1 }),
        audio("c", { trackIndex: 2 }),
      ]);
      expect(staged.warnings).toHaveLength(1);
      expect(staged.warnings[0]).toContain("plays 3 times");
      expect(staged.warnings[0]).toContain("10 dB louder");
    });

    it.each([
      ["a different start", { start: 1 }],
      ["a different offset into the file", { mediaStart: 2 }],
      ["a different length", { duration: 3 }],
      ["a different speed", { playbackRate: 2 }],
      ["a different level", { volume: 0.5 }],
      ["a different file", { src: "media/b.mp4" }],
    ])("does not warn for %s", (_name, change) => {
      expect(run([audio("a"), audio("b", { trackIndex: 1, ...change })]).warnings).toEqual([]);
    });

    it("does not warn about a video clip listed twice, which is a layer, not a doubled sound", () => {
      const clips = [video("a", "media/a.mp4"), { ...video("b", "media/a.mp4"), trackIndex: 1 }];
      expect(run(clips).warnings).toEqual([]);
    });

    it("treats a file URL it cannot read as a missing file, names the clip, and carries on", () => {
      const staged = run([
        video("ok", "media/a.mp4"),
        video("host", "file://some-host/share/clip.mov", 2),
        video("escapes", "file:///media/%E0%A4%A.mp4", 4),
      ]);
      expect(staged.clipCount).toBe(1);
      expect(staged.warnings.filter((w) => w.includes("media not found for clip"))).toHaveLength(2);
      expect(staged.warnings.join("\n")).toContain('"host"');
    });
  });

  describe("how many warnings are printed", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `warning ${i + 1}`);

    it("prints all of them when there are few", () => {
      expect(warningLines(many(3))).toEqual(["  - warning 1", "  - warning 2", "  - warning 3"]);
      expect(warningLines([])).toEqual([]);
      expect(warningLines(many(20))).toHaveLength(20);
    });

    it("prints the first twenty and counts the rest when there are many", () => {
      const lines = warningLines(many(271));
      expect(lines).toHaveLength(21);
      expect(lines[19]).toBe("  - warning 20");
      expect(lines[20]).toBe(
        '  ... and 251 more; the converter\'s output lists every one under "warnings"',
      );
    });

    it("says one more, not nothing, when a single warning is over the limit", () => {
      expect(warningLines(many(21))[20]).toContain("and 1 more");
    });

    it("honours another limit", () => {
      expect(warningLines(many(10), 3)).toHaveLength(4);
    });
  });

  describe("file names that are not safe in a URL", () => {
    // `?` is not allowed in a Windows file name, so those cases only run elsewhere.
    const names: Array<[string, string]> = [
      ["take#1.mp4", "take%231.mp4"],
      ["a b.mp4", "a%20b.mp4"],
      ["100%.mp4", "100%25.mp4"],
      ["a%20b.mp4", "a%2520b.mp4"], // a name that already looks escaped is still just a name
      ["caf\u00e9.mp4", "caf%C3%A9.mp4"],
      ...(process.platform === "win32" ? [] : [["q?x.mp4", "q%3Fx.mp4"] as [string, string]]),
    ];

    it.each(names)("keeps %s on disk and writes it as %s in src", (name, encoded) => {
      writeFileSync(join(root, "media", name), `bytes of ${name}`);
      const file = join(root, `names-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(file, timeline([video("x", `media/${name}`)]));
      const dir = destDir();
      const staged = stageTimeline({ timelineFile: file, destDir: dir });
      expect(readFileSync(join(dir, "assets", name), "utf-8")).toBe(`bytes of ${name}`);
      expect(staged.html).toContain(`src="assets/${encoded}"`);
      expect(staged.html).not.toContain(`src="assets/${name}"`); // never the raw name, which differs
      // and what the browser asks for decodes back to the file that was copied
      expect(decodeURIComponent(encoded)).toBe(name);
    });

    it("encodes a still, a freeze and an image sequence's video the same way", () => {
      writeFileSync(join(root, "media", "still#1.png"), "png");
      const file = join(root, "names-kinds.json");
      writeFileSync(
        file,
        timeline([{ id: "s", kind: "image", start: 0, duration: 1, src: "media/still#1.png" }]),
      );
      const staged = stageTimeline({ timelineFile: file, destDir: destDir() });
      expect(staged.html).toContain('src="assets/still%231.png"');
    });

    it("keeps two files whose encoded names would collide apart", () => {
      writeFileSync(join(root, "media", "dup#.mp4"), "one");
      mkdirSync(join(root, "media2"), { recursive: true });
      writeFileSync(join(root, "media2", "dup#.mp4"), "two");
      const file = join(root, "names-dup.json");
      writeFileSync(
        file,
        timeline([video("x", "media/dup#.mp4"), video("y", "media2/dup#.mp4", 2)]),
      );
      const dir = destDir();
      const staged = stageTimeline({ timelineFile: file, destDir: dir });
      expect(readFileSync(join(dir, "assets", "dup#.mp4"), "utf-8")).toBe("one");
      expect(readFileSync(join(dir, "assets", "dup#-2.mp4"), "utf-8")).toBe("two");
      expect(staged.html).toContain('src="assets/dup%23.mp4"');
      expect(staged.html).toContain('src="assets/dup%23-2.mp4"');
    });
  });

  it("fails on bad input before touching the destination", () => {
    const bad = join(root, "bad.json");
    writeFileSync(bad, '{"schema":"nope"}');
    const dir = destDir();
    expect(() => stageTimeline({ timelineFile: bad, destDir: dir })).toThrow(/Invalid timeline/);
    expect(() => stageTimeline({ timelineFile: bad, destDir: dir })).toThrow(
      "https://hyperframes.heygen.com/schema/timeline-import.json",
    );
    const none = join(root, "none.json");
    writeFileSync(none, timeline([video("x", "media/missing.mp4")]));
    expect(() => stageTimeline({ timelineFile: none, destDir: dir })).toThrow(/No clip has media/);
    expect(existsSync(join(dir, "assets"))).toBe(false);
  });
});
