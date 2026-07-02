// packages/core/src/slideshow/parseSlideshow.test.ts
import { describe, it, expect } from "vitest";
import { parseSlideshowManifest, resolveSlideshow } from "./parseSlideshow";

const ISLAND = `<!doctype html><html><body>
<script type="application/hyperframes-slideshow+json">
{ "slides": [
    { "sceneId": "a", "fragments": [2.0, 1.0], "hotspots": [{ "id": "h1", "label": "Why?", "target": "deep" }] },
    { "sceneId": "b" }
  ],
  "slideSequences": [ { "id": "deep", "label": "Deep dive", "slides": [ { "sceneId": "c" } ] } ]
}
</script>
</body></html>`;

const SCENES = [
  { id: "a", start: 0, duration: 5 },
  { id: "b", start: 5, duration: 5 },
  { id: "c", start: 10, duration: 3 },
];

describe("parseSlideshowManifest", () => {
  it("returns null when no island present", () => {
    expect(parseSlideshowManifest("<html></html>")).toBeNull();
  });

  it("parses the island JSON", () => {
    const m = parseSlideshowManifest(ISLAND);
    expect(m?.slides.length).toBe(2);
    expect(m?.slideSequences?.[0].id).toBe("deep");
  });

  it("throws when slideSequences is present but not an array", () => {
    const html = `<script type="application/hyperframes-slideshow+json">
      { "slides": [{ "sceneId": "a" }], "slideSequences": {} }
    </script>`;
    expect(() => parseSlideshowManifest(html)).toThrow();
  });

  it("rejects a non-object manifest (e.g. a JSON array)", () => {
    const html = `<script type="application/hyperframes-slideshow+json">[42, null]</script>`;
    expect(() => parseSlideshowManifest(html)).toThrow();
  });

  it("throws when a slide entry is malformed (sceneId not a string)", () => {
    const html = `<script type="application/hyperframes-slideshow+json">
      { "slides": [{ "sceneId": 42 }] }
    </script>`;
    expect(() => parseSlideshowManifest(html)).toThrow();
  });
});

describe("resolveSlideshow", () => {
  it("resolves scene time ranges and sorts fragments", () => {
    const m = parseSlideshowManifest(ISLAND);
    if (!m) throw new Error("manifest expected");
    const { resolved, errors } = resolveSlideshow(m, SCENES);
    expect(errors).toEqual([]);
    expect(resolved.slides[0].start).toBe(0);
    expect(resolved.slides[0].end).toBe(5);
    expect(resolved.slides[0].fragments).toEqual([1.0, 2.0]); // sorted
    expect(resolved.sequences.deep.slides[0].start).toBe(10);
  });

  it("honors explicit startTime/endTime overrides", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [{ sceneId: "a", startTime: 1, endTime: 4 }],
    };
    const { resolved } = resolveSlideshow(m, SCENES);
    expect(resolved.slides[0].start).toBe(1);
    expect(resolved.slides[0].end).toBe(4);
  });

  it("reports an error for an unresolved sceneId", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [{ sceneId: "missing" }],
    };
    const { errors } = resolveSlideshow(m, SCENES);
    expect(errors.some((e) => e.includes("missing"))).toBe(true);
  });

  it("flags duplicate slideSequence ids instead of silently overwriting", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [{ sceneId: "a" }],
      slideSequences: [
        { id: "dup", label: "First", slides: [{ sceneId: "c" }] },
        { id: "dup", label: "Second", slides: [{ sceneId: "c" }] },
      ],
    };
    const { errors } = resolveSlideshow(m, SCENES);
    expect(errors.some((e) => e.includes("duplicate slideSequence id"))).toBe(true);
  });

  it("reports an error for a fragment outside the slide range", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [{ sceneId: "a", fragments: [99] }],
    };
    const { errors } = resolveSlideshow(m, SCENES);
    expect(errors.some((e) => e.includes("fragment"))).toBe(true);
  });

  it("reports an error for a hotspot target with no sequence", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [{ sceneId: "a", hotspots: [{ id: "h", label: "x", target: "nope" }] }],
    };
    const { errors } = resolveSlideshow(m, SCENES);
    expect(errors.some((e) => e.includes("nope"))).toBe(true);
  });

  it("reports an error for overlapping main-line slides", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [
        { sceneId: "a", startTime: 0, endTime: 6 },
        { sceneId: "b", startTime: 5, endTime: 10 },
      ],
    };
    const { errors } = resolveSlideshow(m, SCENES);
    expect(errors.some((e) => e.includes("overlap"))).toBe(true);
  });

  // Partial-override cases
  it("fills missing endTime from scene when only startTime is provided and scene exists", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [{ sceneId: "a", startTime: 2 }],
    };
    const { resolved, errors } = resolveSlideshow(m, SCENES);
    expect(errors).toEqual([]);
    expect(resolved.slides[0].start).toBe(2);
    expect(resolved.slides[0].end).toBe(5); // scene a: start=0, duration=5
  });

  it("fills missing startTime from scene when only endTime is provided and scene exists", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [{ sceneId: "a", endTime: 3 }],
    };
    const { resolved, errors } = resolveSlideshow(m, SCENES);
    expect(errors).toEqual([]);
    expect(resolved.slides[0].start).toBe(0); // scene a: start=0
    expect(resolved.slides[0].end).toBe(3);
  });

  it("reports a clear error when only startTime is provided but scene is absent", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [{ sceneId: "x", startTime: 2 }],
    };
    const { errors } = resolveSlideshow(m, SCENES);
    expect(errors.length).toBeGreaterThan(0);
    // Must mention the missing bound (endTime), not the misleading "unresolved sceneId"
    expect(errors.some((e) => e.includes("endTime"))).toBe(true);
    expect(errors.some((e) => e.includes("unresolved sceneId"))).toBe(false);
  });

  it("reports a clear error when only endTime is provided but scene is absent", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [{ sceneId: "x", endTime: 5 }],
    };
    const { errors } = resolveSlideshow(m, SCENES);
    expect(errors.length).toBeGreaterThan(0);
    // Must mention the missing bound (startTime), not the misleading "unresolved sceneId"
    expect(errors.some((e) => e.includes("startTime"))).toBe(true);
    expect(errors.some((e) => e.includes("unresolved sceneId"))).toBe(false);
  });

  it("reports an error for an inverted explicit range (endTime <= startTime)", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [{ sceneId: "a", startTime: 5, endTime: 2 }],
    };
    const { errors } = resolveSlideshow(m, SCENES);
    expect(errors.some((e) => e.includes("endTime") && e.includes("startTime"))).toBe(true);
  });

  it("de-duplicates fragments before resolving", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [{ sceneId: "a", fragments: [2, 1, 2, 1, 3] }],
    };
    const { resolved, errors } = resolveSlideshow(m, SCENES);
    expect(errors).toEqual([]);
    expect(resolved.slides[0].fragments).toEqual([1, 2, 3]);
  });

  it("reports an error for a hotspot targeting an empty sequence", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [{ sceneId: "a", hotspots: [{ id: "h", label: "x", target: "empty" }] }],
      slideSequences: [{ id: "empty", label: "Empty", slides: [] }],
    };
    const { errors } = resolveSlideshow(m, SCENES);
    expect(errors.some((e) => e.includes("empty sequence"))).toBe(true);
  });

  it("full override with no scene produces no error", () => {
    const m: import("./slideshow.types").SlideshowManifest = {
      slides: [{ sceneId: "noexist", startTime: 1, endTime: 4 }],
    };
    const { resolved, errors } = resolveSlideshow(m, SCENES);
    expect(errors).toEqual([]);
    expect(resolved.slides[0].start).toBe(1);
    expect(resolved.slides[0].end).toBe(4);
  });

  it("parses and carries through the per-slide autoplay flag", () => {
    const island = `<script type="application/hyperframes-slideshow+json">
      { "slides": [ { "sceneId": "a", "autoplay": true }, { "sceneId": "b" } ] }
    </script>`;
    const m = parseSlideshowManifest(island);
    expect(m?.slides[0].autoplay).toBe(true);
    expect(m?.slides[1].autoplay).toBeUndefined();
    const { resolved } = resolveSlideshow(m!, SCENES);
    expect(resolved.slides[0].autoplay).toBe(true);
    expect(resolved.slides[1].autoplay).toBeUndefined();
  });

  it("rejects a manifest whose slide autoplay is not a boolean", () => {
    const island = `<script type="application/hyperframes-slideshow+json">
      { "slides": [ { "sceneId": "a", "autoplay": "yes" } ] }
    </script>`;
    expect(() => parseSlideshowManifest(island)).toThrow();
  });
});
