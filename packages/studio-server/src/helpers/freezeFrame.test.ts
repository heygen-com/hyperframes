import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import {
  applyFreezeFrameToHtml,
  freezeExtractArgs,
  freezeFrameMediaTime,
  freezeStillFileName,
  readFreezeSource,
} from "./freezeFrame.js";

const rampLane = JSON.stringify({
  version: 1,
  lanes: [
    {
      target: "rate",
      points: [
        { t: 0, v: 1 },
        { t: 2, v: 3 },
      ],
    },
  ],
});

describe("freezeFrameMediaTime", () => {
  it("is the in-point plus clip time at normal speed", () => {
    expect(
      freezeFrameMediaTime({
        clipStart: 1,
        playhead: 3.2,
        mediaStart: 5,
        playbackRate: 1,
        automation: null,
      }),
    ).toBeCloseTo(7.2, 6);
  });

  it("scales by a constant playback rate", () => {
    expect(
      freezeFrameMediaTime({
        clipStart: 0,
        playhead: 2,
        mediaStart: 1,
        playbackRate: 2,
        automation: null,
      }),
    ).toBeCloseTo(5, 6);
  });

  it("integrates a rate lane, which overrides the constant", () => {
    // 1x to 3x over 2s consumes 2 * (3 - 1) / ln 3 source seconds.
    expect(
      freezeFrameMediaTime({
        clipStart: 0,
        playhead: 2,
        mediaStart: 0.5,
        playbackRate: 4,
        automation: rampLane,
      }),
    ).toBeCloseTo(0.5 + 3.641, 2);
  });
});

describe("freezeExtractArgs", () => {
  it("seeks before the input and writes one frame, never over an existing file", () => {
    expect(freezeExtractArgs("/p/a.mp4", 7.2004, "/p/assets/freeze/a-3200.png")).toEqual([
      "-n",
      "-ss",
      "7.2",
      "-i",
      "/p/a.mp4",
      "-frames:v",
      "1",
      "/p/assets/freeze/a-3200.png",
    ]);
  });
});

const project = `<div data-composition-id="main" data-start="0" data-duration="10">
<video id="talk" class="clip" src="talk.mp4" data-start="1" data-duration="6" data-media-start="2" data-track-index="0" data-link="L" style="left:10px;clip-path:inset(5px)"></video>
<img id="later" class="clip" src="x.png" data-start="8" data-duration="1" data-track-index="0">
<div id="other" class="clip" data-start="5" data-duration="2" data-track-index="2"></div>
<audio id="talk-audio" class="clip" src="talk.mp4" data-start="1" data-duration="6" data-media-start="2" data-track-index="1" data-link="L"></audio>
</div>`;

const at = (html: string, id: string) =>
  parseHTML(`<html><body>${html}</body></html>`).document.getElementById(id);
const timing = (html: string, id: string) => {
  const el = at(html, id);
  return [el?.getAttribute("data-start"), el?.getAttribute("data-duration")];
};

describe("readFreezeSource", () => {
  it("reads the frame under the playhead from the source attributes", () => {
    expect(readFreezeSource(project, { id: "talk" }, 3.2)).toEqual({
      id: "talk",
      src: "talk.mp4",
      mediaTime: 4.2,
    });
  });

  it("reads the in-point as playback does: data-playback-start before data-media-start", () => {
    const both = project.replace(
      'data-media-start="2"',
      'data-media-start="2" data-playback-start="5"',
    );
    expect(readFreezeSource(both, { id: "talk" }, 3.2)?.mediaTime).toBe(7.2);
  });

  it("refuses a playhead outside the clip or a non-video", () => {
    expect(readFreezeSource(project, { id: "talk" }, 0.5)).toBeNull();
    expect(readFreezeSource(project, { id: "later" }, 8.5)).toBeNull();
  });
});

describe("applyFreezeFrameToHtml", () => {
  const result = applyFreezeFrameToHtml(project, {
    target: { id: "talk" },
    playhead: 3.2,
    imageSrc: "assets/freeze/talk-3200.png",
  });
  const html = result?.html ?? "";

  it("splits the video and inserts a 2 s still with the video's box styles", () => {
    expect(result?.freezeId).toBe("talk-freeze");
    expect(timing(html, "talk")).toEqual(["1", "2.2"]);
    const still = at(html, "talk-freeze");
    expect(still?.tagName).toBe("IMG");
    expect(timing(html, "talk-freeze")).toEqual(["3.2", "2"]);
    expect(still?.getAttribute("style")).toBe("left:10px;clip-path:inset(5px)");
    expect(still?.getAttribute("data-track-index")).toBe("0");
    expect(still?.getAttribute("data-timeline-label")).toBe("Freeze");
    expect(still?.hasAttribute("data-link")).toBe(false);
  });

  it("moves the right half and the rest of the track right by the hold", () => {
    expect(timing(html, "talk-split")).toEqual(["5.2", "3.8"]);
    expect(at(html, "talk-split")?.getAttribute("data-media-start")).toBe("4.2");
    expect(timing(html, "later")).toEqual(["10", "1"]);
    expect(timing(html, "other")).toEqual(["5", "2"]);
  });

  it("splits the linked audio, leaving a silent gap, and links the right halves together", () => {
    expect(timing(html, "talk-audio")).toEqual(["1", "2.2"]);
    expect(timing(html, "talk-audio-split")).toEqual(["5.2", "3.8"]);
    expect(at(html, "talk-split")?.getAttribute("data-link")).toBe("L-2");
    expect(at(html, "talk-audio-split")?.getAttribute("data-link")).toBe("L-2");
    expect(at(html, "talk-audio")?.getAttribute("data-link")).toBe("L");
  });

  it("grows the root to fit the pushed clips", () => {
    expect(
      parseHTML(`<html><body>${html}</body></html>`)
        .document.querySelector("[data-composition-id]")
        ?.getAttribute("data-duration"),
    ).toBe("11");
  });

  it("returns null when the playhead is not inside the video", () => {
    expect(
      applyFreezeFrameToHtml(project, { target: { id: "talk" }, playhead: 9, imageSrc: "x.png" }),
    ).toBeNull();
  });
});

describe("freezeStillFileName", () => {
  it("reduces a clip id to one safe filename component", () => {
    expect(freezeStillFileName("talk", 2.5, "t0")).toMatch(/^talk-[0-9a-f]{10}-2500-t0\.png$/);
    expect(freezeStillFileName("../../etc/x", 1, "t0")).toMatch(
      /^______etc_x-[0-9a-f]{10}-1000-t0\.png$/,
    );
    expect(freezeStillFileName("a\\b:c", 1, "t0")).toMatch(/^a_b_c-[0-9a-f]{10}-1000-t0\.png$/);
    expect(freezeStillFileName("", 1, "t0")).toMatch(/^clip-[0-9a-f]{10}-1000-t0\.png$/);
  });

  it("keeps ids that sanitise or truncate alike apart", () => {
    expect(freezeStillFileName("a.b", 2.5, "t0")).not.toBe(freezeStillFileName("a_b", 2.5, "t0"));
    const prefix = "v".repeat(80);
    expect(freezeStillFileName(`${prefix}1`, 2.5, "t0")).not.toBe(
      freezeStillFileName(`${prefix}2`, 2.5, "t0"),
    );
  });

  it("names every extraction of one clip at one time differently", () => {
    expect(freezeStillFileName("talk", 2.5)).not.toBe(freezeStillFileName("talk", 2.5));
  });
});
