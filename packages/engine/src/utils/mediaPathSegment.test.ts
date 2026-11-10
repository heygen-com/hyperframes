import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
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
});
