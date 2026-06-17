import { describe, expect, it } from "vitest";
import {
  MAX_VIDEO_BYTES,
  VIDEO_CONTENT_TYPE_RE,
  findFilenameCollision,
  pickManifestEntry,
  safeFilename,
  type ManifestEntry,
} from "./video.js";

const ENTRY = (index: number, partial: Partial<ManifestEntry> = {}): ManifestEntry => ({
  index,
  url: `https://cdn.example.com/video-${index}.mp4`,
  filename: `video-${index}.mp4`,
  width: 1920,
  height: 1080,
  heading: "",
  caption: "",
  ariaLabel: "",
  preview: `assets/videos/previews/video-${index}-preview.png`,
  ...partial,
});

describe("safeFilename", () => {
  it("decodes percent-encoded chars", () => {
    expect(safeFilename("Frame-2147227325%20(1).mp4")).toBe("Frame-2147227325_1_.mp4");
  });

  it("strips characters outside [A-Za-z0-9._-]", () => {
    expect(safeFilename("video with spaces & symbols!.mp4")).toBe("video_with_spaces_symbols_.mp4");
  });

  it("preserves the extension and version markers", () => {
    expect(safeFilename("hero.mp4")).toBe("hero.mp4");
    expect(safeFilename("hero-v2.webm")).toBe("hero-v2.webm");
  });

  it("falls back when decodeURIComponent throws on a malformed sequence", () => {
    // `%E0%A4%A` is a truncated UTF-8 multibyte sequence and throws URIError.
    // We should keep the raw input rather than crashing.
    expect(safeFilename("Bad%E0%A4%A.mp4")).toBe("Bad_E0_A4_A.mp4");
  });

  it("collapses runs of disallowed characters into a single underscore", () => {
    expect(safeFilename("a   b___c")).toBe("a_b___c");
  });
});

describe("VIDEO_CONTENT_TYPE_RE", () => {
  it("matches common video content-types", () => {
    expect(VIDEO_CONTENT_TYPE_RE.test("video/mp4")).toBe(true);
    expect(VIDEO_CONTENT_TYPE_RE.test("video/webm")).toBe(true);
    expect(VIDEO_CONTENT_TYPE_RE.test("video/quicktime")).toBe(true);
  });

  it("matches application/* containers that CDNs commonly use", () => {
    expect(VIDEO_CONTENT_TYPE_RE.test("application/mp4")).toBe(true);
    expect(VIDEO_CONTENT_TYPE_RE.test("application/octet-stream")).toBe(true);
    expect(VIDEO_CONTENT_TYPE_RE.test("application/x-mpegURL")).toBe(true);
  });

  it("rejects HTML / JSON error pages that pretend to be videos", () => {
    expect(VIDEO_CONTENT_TYPE_RE.test("text/html")).toBe(false);
    expect(VIDEO_CONTENT_TYPE_RE.test("application/json")).toBe(false);
    expect(VIDEO_CONTENT_TYPE_RE.test("image/png")).toBe(false);
  });
});

describe("MAX_VIDEO_BYTES", () => {
  it("is 250 MB", () => {
    expect(MAX_VIDEO_BYTES).toBe(250 * 1024 * 1024);
  });
});

describe("pickManifestEntry", () => {
  it("returns no-selector when neither --index nor --url is given", () => {
    const r = pickManifestEntry([ENTRY(0)], {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("no-selector");
  });

  it("looks up by the entry's `index` field, NOT array offset (manifest gaps)", () => {
    const manifest = [ENTRY(0), ENTRY(2), ENTRY(3)]; // index 1 missing
    const r = pickManifestEntry(manifest, { index: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.url).toBe("https://cdn.example.com/video-3.mp4");
  });

  it("rejects a request for an index that's not in the manifest", () => {
    const manifest = [ENTRY(0), ENTRY(2)]; // index 1 missing
    const r = pickManifestEntry(manifest, { index: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("no-match-index");
      expect(r.message).toContain("index=1");
      expect(r.message).toContain("available: 0, 2");
    }
  });

  it("rejects a negative or non-integer index up front", () => {
    expect(pickManifestEntry([ENTRY(0)], { index: -1 }).ok).toBe(false);
    expect(pickManifestEntry([ENTRY(0)], { index: 1.5 }).ok).toBe(false);
    expect(pickManifestEntry([ENTRY(0)], { index: "abc" }).ok).toBe(false);
  });

  it("accepts numeric-string indices (citty parses positional args as strings)", () => {
    const r = pickManifestEntry([ENTRY(0), ENTRY(1)], { index: "1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.index).toBe(1);
  });

  it("looks up by exact URL match", () => {
    const manifest = [ENTRY(0), ENTRY(1)];
    const r = pickManifestEntry(manifest, { url: "https://cdn.example.com/video-1.mp4" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.index).toBe(1);
  });

  it("rejects a URL that doesn't appear in the manifest", () => {
    const manifest = [ENTRY(0)];
    const r = pickManifestEntry(manifest, { url: "https://other.com/missing.mp4" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("no-match-url");
      expect(r.message).toContain("missing.mp4");
    }
  });

  it("when both --index and --url are passed, --index wins (CLI's declared priority)", () => {
    const manifest = [ENTRY(0), ENTRY(1)];
    const r = pickManifestEntry(manifest, {
      index: 1,
      url: "https://cdn.example.com/video-0.mp4",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.index).toBe(1);
  });
});

describe("findFilenameCollision", () => {
  it("returns [] when no other manifest entry produces the same safeFilename", () => {
    const manifest = [ENTRY(0), ENTRY(1), ENTRY(2)];
    expect(findFilenameCollision(manifest, manifest[1]!)).toEqual([]);
  });

  it("flags collisions when two URL forms collapse to the same safeFilename", () => {
    // "hero%20clip.mp4" and "hero clip.mp4" both → "hero_clip.mp4"
    const manifest = [
      ENTRY(0, { url: "https://cdn.example.com/hero%20clip.mp4", filename: "hero%20clip.mp4" }),
      ENTRY(1, { url: "https://cdn.example.com/hero clip.mp4", filename: "hero clip.mp4" }),
    ];
    const collisions = findFilenameCollision(manifest, manifest[0]!);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.index).toBe(1);
  });

  it("does not return the selected entry itself as a collision", () => {
    const manifest = [ENTRY(0), ENTRY(1)];
    const collisions = findFilenameCollision(manifest, manifest[0]!);
    expect(collisions.every((c) => c.index !== 0)).toBe(true);
  });
});
