import { describe, expect, it } from "vitest";
import {
  buildTimelineFileDropPlacements,
  buildTimelineAssetInsertHtml,
  getTimelineAssetKind,
  insertTimelineAssetIntoSource,
  resolveTimelineAssetInitialGeometry,
  resolveTimelineAssetSrc,
} from "./timelineAssetDrop";

describe("getTimelineAssetKind", () => {
  it("detects image, video, and audio assets", () => {
    expect(getTimelineAssetKind("assets/photo.png")).toBe("image");
    expect(getTimelineAssetKind("assets/clip.mp4")).toBe("video");
    expect(getTimelineAssetKind("assets/music.wav")).toBe("audio");
  });
});

describe("buildTimelineAssetInsertHtml", () => {
  it("builds an image clip with explicit timing and track", () => {
    const html = buildTimelineAssetInsertHtml({
      id: "photo_asset",
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

describe("resolveTimelineAssetInitialGeometry", () => {
  it("uses the target composition dimensions for visual media", () => {
    expect(
      resolveTimelineAssetInitialGeometry(
        `<div data-composition-id="main" data-width="330" data-height="228"></div>`,
      ),
    ).toEqual({
      left: 0,
      top: 0,
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
  it("uses the dropped start and stacks multiple files onto successive tracks", () => {
    expect(buildTimelineFileDropPlacements({ start: 1.5, track: 2 }, 3)).toEqual([
      { start: 1.5, track: 2 },
      { start: 1.5, track: 3 },
      { start: 1.5, track: 4 },
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
