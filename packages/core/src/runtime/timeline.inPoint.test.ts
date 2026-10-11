import { afterEach, describe, expect, it } from "vitest";
import { collectRuntimeTimelinePayload } from "./timeline";

describe("Studio's clip list under a host with an in-point", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists only the part each clip plays, as `hyperframes timeline` does", () => {
    // Local 0-4 and 1-3 fall before the in-point; local 8-12 plays at 3-7.
    document.body.innerHTML =
      `<div data-composition-id="main" data-duration="10">` +
      `<div id="half" data-composition-id="half" data-composition-file="scene.html" data-start="0" data-duration="7" data-playback-start="5">` +
      `<video id="v1" data-start="0" data-duration="4"></video>` +
      `<div id="t" data-start="1" data-duration="2"></div>` +
      `<video id="v3" data-start="8" data-duration="4"></video></div></div>`;

    const { clips } = collectRuntimeTimelinePayload({ canonicalFps: 30 });

    expect(clips.map((c) => [c.id, c.start, c.duration])).toEqual([
      ["half", 0, 7],
      ["v3", 3, 4],
    ]);
  });

  it("keeps a nested host it cuts away so what that host holds stays nested in Studio", () => {
    // `lower` plays at local 1-3 of `half`, before the in-point; `bed` outlives it into 5-7.
    document.body.innerHTML =
      `<div data-composition-id="main" data-duration="20">` +
      `<div id="half" data-composition-id="half" data-start="5" data-duration="5" data-playback-start="5">` +
      `<div id="lower" data-composition-id="lower" data-composition-file="lower.html" data-start="1" data-duration="2">` +
      `<audio id="bed" data-start="0" data-duration="6"></audio></div></div></div>`;

    const { clips } = collectRuntimeTimelinePayload({ canonicalFps: 30 });

    expect(clips.map((c) => [c.id, c.start, c.duration])).toEqual([
      ["half", 5, 5],
      ["lower", 5, 0],
      ["bed", 5, 2],
    ]);
    // Studio's top-level rule: no parent, or a parent missing from the list.
    const ids = new Set(clips.map((c) => c.compositionId));
    const topLevel = clips.filter((c) => !c.parentCompositionId || !ids.has(c.parentCompositionId));
    expect(topLevel.map((c) => c.id)).toEqual(["half"]);
  });
});
