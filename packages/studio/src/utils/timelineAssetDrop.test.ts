// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildTimelineFileDropPlacements,
  buildTimelineAssetInsertHtml,
  fitTimelineAssetGeometry,
  getTimelineAssetKind,
  insertTimelineAssetIntoSource,
  resolveTimelineAssetCompositionSize,
  resolveRootLength,
  resolveTimelineAssetSrc,
  setCompositionDurationToContent,
  writeRootLength,
} from "./timelineAssetDrop";

describe("resolveRootLength", () => {
  const ends = (clips: number, animation = 0) => ({ clips, animation });

  it("moves a derived length to the new content end, both ways", () => {
    expect(resolveRootLength(5, ends(5), ends(4))).toBe(4);
    expect(resolveRootLength(5, ends(5), ends(7))).toBe(7);
    expect(resolveRootLength(5, ends(5), ends(4, 6))).toBe(6);
    expect(resolveRootLength(6, ends(4, 6), ends(3, 6))).toBe(6);
  });

  it("compares at the writer's hundredths", () => {
    expect(resolveRootLength(5, ends(5.004), ends(4))).toBe(4);
    expect(resolveRootLength(5, ends(5.01), ends(4))).toBeNull();
  });

  it("treats a root without a readable length as derived", () => {
    expect(resolveRootLength(null, ends(5), ends(4))).toBe(4);
    expect(resolveRootLength(Number.NaN, ends(5), ends(4))).toBe(4);
  });

  it("leaves a hand-set length, even against a later animation", () => {
    expect(resolveRootLength(8, ends(5, 5), ends(4, 5))).toBeNull();
    expect(resolveRootLength(3, ends(3, 6), ends(3, 6))).toBeNull();
  });

  it("grows a hand-set length to a clip newly placed past it, never to an animation", () => {
    expect(resolveRootLength(8, ends(5), ends(9, 12))).toBe(9);
  });

  it("does not grow a hand-set length for a clip that already ran past it", () => {
    expect(resolveRootLength(8, ends(9), ends(9))).toBeNull();
    expect(resolveRootLength(8, ends(9), ends(8.5))).toBeNull();
    expect(resolveRootLength(8, ends(9), ends(8.004))).toBeNull();
  });

  it("never cuts a derived length on an animation end that became unreadable", () => {
    expect(resolveRootLength(5, ends(3, 5), ends(3, 0))).toBeNull();
  });
});

describe("writeRootLength", () => {
  const root = `<div data-composition-id="c" data-duration="5">x</div>`;

  it("writes the length", () => {
    expect(writeRootLength(root, 3.456)).toBe(
      `<div data-composition-id="c" data-duration="3.46">x</div>`,
    );
  });

  it("writes nothing to leave the length, for an empty timeline, or a root without a length", () => {
    expect(writeRootLength(root, null)).toBe(root);
    expect(writeRootLength(root, 0)).toBe(root);
    const bare = `<div data-composition-id="c">x</div>`;
    expect(writeRootLength(bare, 3)).toBe(bare);
  });
});

describe("setCompositionDurationToContent", () => {
  const src = (dur: number) =>
    `<div id="root" data-composition-id="c" data-duration="${dur}">x</div>`;

  it("shrinks the root duration to the content end", () => {
    expect(setCompositionDurationToContent(src(20), 8)).toContain('data-duration="8"');
  });

  it("grows the root duration to the content end", () => {
    expect(setCompositionDurationToContent(src(5), 12)).toContain('data-duration="12"');
  });

  it("is a no-op when content end is 0 (empty timeline keeps its declared length)", () => {
    expect(setCompositionDurationToContent(src(12), 0)).toBe(src(12));
  });

  it("is a no-op when already equal", () => {
    expect(setCompositionDurationToContent(src(9), 9)).toBe(src(9));
  });

  // Reviewer round-2 finding #3: attribute-order and single-quote variants that
  // the old order-dependent, double-quotes-only regex silently ignored.
  it("patches when data-duration precedes data-composition-id", () => {
    const source = `<div data-duration="20" data-composition-id="c">x</div>`;
    expect(setCompositionDurationToContent(source, 8)).toBe(
      `<div data-duration="8" data-composition-id="c">x</div>`,
    );
  });

  it("patches single-quoted attributes and keeps the quote style", () => {
    const source = `<div data-composition-id='c' data-duration='20'>x</div>`;
    expect(setCompositionDurationToContent(source, 8)).toBe(
      `<div data-composition-id='c' data-duration='8'>x</div>`,
    );
  });
});

describe("getTimelineAssetKind", () => {
  it("detects image, video, and audio assets", () => {
    expect(getTimelineAssetKind("assets/photo.png")).toBe("image");
    expect(getTimelineAssetKind("assets/clip.mp4")).toBe("video");
    expect(getTimelineAssetKind("assets/clip.mov")).toBe("video");
    expect(getTimelineAssetKind("assets/music.mp3")).toBe("audio");
    expect(getTimelineAssetKind("assets/music.wav")).toBe("audio");
  });

  it("classifies svg as image", () => {
    expect(getTimelineAssetKind("assets/logo.svg")).toBe("image");
    expect(getTimelineAssetKind("assets/ICON.SVG")).toBe("image");
  });

  it("classifies avif and webp as image", () => {
    expect(getTimelineAssetKind("assets/photo.avif")).toBe("image");
    expect(getTimelineAssetKind("assets/photo.webp")).toBe("image");
  });

  it("returns null for unknown extensions", () => {
    expect(getTimelineAssetKind("assets/data.json")).toBeNull();
    expect(getTimelineAssetKind("assets/font.woff2")).toBeNull();
  });
});

describe("buildTimelineAssetInsertHtml", () => {
  it("builds an image clip with explicit timing and track", () => {
    const html = buildTimelineAssetInsertHtml({
      id: "photo_asset",
      hfId: "hf-abc123",
      assetPath: "assets/photo.png",
      kind: "image",
      start: 1.25,
      duration: 3,
      track: 2,
      zIndex: 4,
      geometry: { left: 0, top: 0, width: 1280, height: 720 },
    });

    expect(html).toContain('img id="photo_asset"');
    expect(html).toContain("left: 0px");
    expect(html).toContain("width: 1280px");
    expect(html).not.toContain("inset:");
  });

  it("builds an audio clip without visual layout styles", () => {
    const html = buildTimelineAssetInsertHtml({
      id: "music_asset",
      hfId: "hf-xyz789",
      assetPath: "assets/music.wav",
      kind: "audio",
      start: 0.5,
      duration: 5,
      track: 0,
      zIndex: 1,
    });
    expect(html).toContain("<audio");
    expect(html).not.toContain("object-fit");
  });
});

describe("resolveTimelineAssetCompositionSize", () => {
  it("uses the target composition dimensions for visual media", () => {
    expect(
      resolveTimelineAssetCompositionSize(
        `<div data-composition-id="main" data-width="330" data-height="228"></div>`,
      ),
    ).toEqual({
      width: 330,
      height: 228,
    });
  });
});

describe("resolveTimelineAssetSrc", () => {
  it("keeps project-root asset paths for index.html", () => {
    expect(resolveTimelineAssetSrc("index.html", "assets/photo.png")).toBe("assets/photo.png");
  });

  it("rewrites asset paths relative to sub-compositions", () => {
    expect(resolveTimelineAssetSrc("compositions/scene-a.html", "assets/photo.png")).toBe(
      "../assets/photo.png",
    );
  });
});

describe("buildTimelineFileDropPlacements", () => {
  it("returns no placements for an empty drop set", () => {
    expect(buildTimelineFileDropPlacements({ start: 1.5, track: 2 }, [])).toEqual([]);
  });

  it("spaces multiple files by duration and keeps every one on the dropped track", () => {
    // A clip placed onto an occupied track stays there (overlap is allowed); it is
    // NOT bumped to a new track — that produced surprise empty tracks for users.
    expect(buildTimelineFileDropPlacements({ start: 1.5, track: 2 }, [1.2, 1.6, 1.1])).toEqual([
      { start: 1.5, track: 2 },
      { start: 2.7, track: 2 },
      { start: 4.3, track: 2 },
    ]);
  });

  it("uses fallback spacing when a duration is unavailable", () => {
    expect(buildTimelineFileDropPlacements({ start: 1.5, track: 2 }, [1.2, 0, 1.1])).toEqual([
      { start: 1.5, track: 2 },
      { start: 2.7, track: 2 },
      { start: 7.7, track: 2 },
    ]);
  });
});

describe("insertTimelineAssetIntoSource", () => {
  it("appends the new asset inside the root composition", () => {
    const source = `<!doctype html><html><body><div id="root" data-composition-id="main"></div></body></html>`;
    const html = insertTimelineAssetIntoSource(
      source,
      '<img id="photo_asset" data-start="0" data-duration="3" />',
    );

    expect(html).toContain('data-composition-id="main">');
    expect(html).toContain('<img id="photo_asset" data-start="0" data-duration="3" />');
  });

  it("inserts into a registry scene's root inside the template its <html> wraps", () => {
    const source = [
      `<html data-composition-id="card">`,
      `<body><template>`,
      `  <div data-composition-id="card" data-duration="4">`,
      `  </div>`,
      `</template></body></html>`,
    ].join("\n");
    expect(insertTimelineAssetIntoSource(source, `<img id="a" />`)).toBe(
      source.replace(`data-duration="4">`, `data-duration="4">\n    <img id="a" />`),
    );
  });

  it("does not insert into a composition written inside a comment", () => {
    const source = [
      `<!-- <div data-composition-id="old"> -->`,
      `<div data-composition-id="main"></div>`,
    ].join("\n");
    expect(insertTimelineAssetIntoSource(source, `<img id="a" />`)).toBe(
      source.replace(`"main">`, `"main">\n  <img id="a" />`),
    );
  });

  // Each is no comment to the parser, or one that ends before the root.
  for (const prefix of [`<script>var open = "<!--";</script>`, `<!-->`, `<!--->`, `<!-- a --!>`]) {
    it(`inserts into the root, not a scene inside it, after ${prefix}`, () => {
      const source = [
        prefix,
        `<div data-composition-id="main">`,
        `  <!-- clips -->`,
        `  <div data-composition-id="scene"></div>`,
        `</div>`,
      ].join("\n");
      expect(insertTimelineAssetIntoSource(source, `<img id="a" />`)).toBe(
        source.replace(`"main">`, `"main">\n  <img id="a" />`),
      );
    });
  }
});

describe("buildTimelineAssetInsertHtml — video audio", () => {
  const base = {
    id: "clip_asset",
    hfId: "hf-vid-1",
    assetPath: "assets/clip.mp4",
    kind: "video" as const,
    start: 0,
    duration: 8,
    track: 1,
    zIndex: 2,
  };

  it("inserts a video muted when nothing says it carries audio", () => {
    const html = buildTimelineAssetInsertHtml(base);
    expect(html).toContain(" muted ");
    expect(html).not.toContain("data-has-audio");
  });

  it("inserts a video with an audio stream audible: data-has-audio and no muted", () => {
    const html = buildTimelineAssetInsertHtml({ ...base, hasAudio: true });
    expect(html).toContain('data-has-audio="true"');
    expect(html).not.toContain("muted");
    expect(html).toContain("playsinline");
  });

  it("keeps a video without an audio stream muted", () => {
    const html = buildTimelineAssetInsertHtml({ ...base, hasAudio: false });
    expect(html).toContain(" muted ");
    expect(html).not.toContain("data-has-audio");
  });
});

describe("buildTimelineAssetInsertHtml markup quality", () => {
  const base = {
    id: "clip_1",
    hfId: "hf-test-1",
    assetPath: "assets/a.mp4",
    start: 1,
    duration: 4,
    track: 2,
    zIndex: 3,
  };

  it("stamps data-hf-id on all kinds", () => {
    for (const kind of ["image", "video", "audio"] as const) {
      expect(buildTimelineAssetInsertHtml({ ...base, kind })).toContain('data-hf-id="hf-test-1"');
    }
  });

  it("audio gets an explicit data-volume", () => {
    expect(buildTimelineAssetInsertHtml({ ...base, kind: "audio" })).toContain('data-volume="1"');
  });
});

describe("fitTimelineAssetGeometry", () => {
  const comp = { width: 1920, height: 1080 };

  it("centers a smaller-than-comp asset at natural size", () => {
    expect(fitTimelineAssetGeometry({ width: 640, height: 360 }, comp)).toEqual({
      left: 640,
      top: 360,
      width: 640,
      height: 360,
    });
  });

  it("scales an oversized asset down to fit, preserving aspect, centered", () => {
    // 4000x1000 → capped to 1920 wide → 1920x480, centered vertically
    expect(fitTimelineAssetGeometry({ width: 4000, height: 1000 }, comp)).toEqual({
      left: 0,
      top: 300,
      width: 1920,
      height: 480,
    });
  });

  it("falls back to full-frame when natural size is unknown", () => {
    expect(fitTimelineAssetGeometry(null, comp)).toEqual({
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    });
  });
});
