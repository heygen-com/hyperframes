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
});
