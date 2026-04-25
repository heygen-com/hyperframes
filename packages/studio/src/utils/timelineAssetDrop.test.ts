import { describe, expect, it } from "vitest";
import {
  buildTimelineFileDropPlacements,
  buildTimelineAssetInsertHtml,
  getTimelineAssetKind,
  insertTimelineAssetIntoSource,
  resolveTimelineAssetSrc,
} from "./timelineAssetDrop";

describe("getTimelineAssetKind", () => {
  it("detects image, video, and audio assets", () => {
    expect(getTimelineAssetKind("assets/photo.png")).toBe("image");
    expect(getTimelineAssetKind("assets/clip.mp4")).toBe("video");
    expect(getTimelineAssetKind("assets/clip.mov")).toBe("video");
    expect(getTimelineAssetKind("assets/music.mp3")).toBe("audio");
    expect(getTimelineAssetKind("assets/music.wav")).toBe("audio");
  });
});

describe("buildTimelineAssetInsertHtml", () => {
  it("builds an image clip with explicit timing and track", () => {
    expect(
      buildTimelineAssetInsertHtml({
        id: "photo_asset",
        assetPath: "assets/photo.png",
        kind: "image",
        start: 1.25,
        duration: 3,
        track: 2,
        zIndex: 4,
      }),
    ).toContain('img id="photo_asset"');
  });

  it("builds an audio clip without visual layout styles", () => {
    const html = buildTimelineAssetInsertHtml({
      id: "music_asset",
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

  it("uses the dropped start and spaces multiple files by duration on the same track", () => {
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

  it("moves the spaced sequence to a clear track when the dropped row is occupied", () => {
    expect(
      buildTimelineFileDropPlacements(
        { start: 1.5, track: 2 },
        [1.2, 1.6, 1.1],
        [
          { start: 0, duration: 8, track: 2 },
          { start: 0, duration: 4, track: 5 },
        ],
      ),
    ).toEqual([
      { start: 1.5, track: 6 },
      { start: 2.7, track: 6 },
      { start: 4.3, track: 6 },
    ]);
  });

  it("keeps a requested track above occupied rows when that track is clear", () => {
    expect(
      buildTimelineFileDropPlacements(
        { start: 1.5, track: 8 },
        [1.2, 1.6],
        [
          { start: 0, duration: 8, track: 2 },
          { start: 0, duration: 4, track: 5 },
        ],
      ),
    ).toEqual([
      { start: 1.5, track: 8 },
      { start: 2.7, track: 8 },
    ]);
  });

  it("moves a default-track drop to a clear row when track 0 is occupied at time 0", () => {
    expect(
      buildTimelineFileDropPlacements(
        { start: 0, track: 0 },
        [1.2, 1.6],
        [{ start: 0, duration: 8, track: 0 }],
      ),
    ).toEqual([
      { start: 0, track: 1 },
      { start: 1.2, track: 1 },
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

    expect(html).toContain('<div id="root" data-composition-id="main"><img id="photo_asset"');
  });
});
