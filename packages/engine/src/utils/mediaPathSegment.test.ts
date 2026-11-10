import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mediaIdPathSegment } from "./mediaPathSegment.js";

describe("mediaIdPathSegment", () => {
  it.each(["clip", "hf-video-0", "clip__hf2", "intro.bg", "my clip", "视频"])(
    "keeps a plain id (%s) unchanged",
    (id) => {
      expect(mediaIdPathSegment(id)).toBe(id);
    },
  );

  it.each(["..", ".", "../../home", "a/b", "a\\b", "/abs", "C:evil", ""])(
    "maps %j to one segment inside its root",
    (id) => {
      const segment = mediaIdPathSegment(id);
      expect(segment).not.toMatch(/[/\\:]/);
      expect(segment).not.toMatch(/^\.{1,2}$/);
      const root = resolve("/work/frames");
      expect(dirname(resolve(root, segment))).toBe(root);
      expect(mediaIdPathSegment(id)).toBe(segment);
    },
  );

  it("keeps distinct unsafe ids apart", () => {
    expect(mediaIdPathSegment("a/b")).not.toBe(mediaIdPathSegment("a\\b"));
    expect(mediaIdPathSegment("a/b")).not.toBe("a_b");
  });

  it("never gives a plain id the name generated for another id", () => {
    const generated = mediaIdPathSegment("a/b");
    expect(mediaIdPathSegment(generated)).not.toBe(generated);
    expect(mediaIdPathSegment("clip~0123456789ab")).not.toBe("clip~0123456789ab");
  });

  describe("on disk", () => {
    const root = mkdtempSync(join(tmpdir(), "hf-media-segment-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it("keeps the audio work files of a colliding pair apart", () => {
      const first = join(root, `${mediaIdPathSegment("a/b")}-trimmed.wav`);
      const second = join(root, `${mediaIdPathSegment(mediaIdPathSegment("a/b"))}-trimmed.wav`);
      writeFileSync(first, "first");
      writeFileSync(second, "second");
      expect(readFileSync(first, "utf8")).toBe("first");
    });

    it.each([
      ["a long multi-component id", ["x", "y", "z"].map((c) => c.repeat(100)).join("/")],
      ["a long multibyte id", `${"视频".repeat(30)}/${"视频".repeat(30)}`],
    ])("names a frame folder and work file for %s", (_label, id) => {
      const segment = mediaIdPathSegment(id);
      const workFile = `${segment}-extracted.wav`;
      expect(Buffer.byteLength(workFile, "utf8")).toBeLessThanOrEqual(255);
      expect(Buffer.from(segment, "utf8").toString("utf8")).toBe(segment);
      mkdirSync(join(root, segment), { recursive: true });
      writeFileSync(join(root, workFile), "");
      expect(mediaIdPathSegment(`${id}!`)).not.toBe(segment);
    });
  });
});
