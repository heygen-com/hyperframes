import { describe, expect, it } from "vitest";
import * as parsersBounds from "@hyperframes/parsers/media-duration";
import { MEDIA_DURATION_FIXTURES } from "@hyperframes/parsers/media-duration-fixtures";
import {
  resolveMediaElementDurationSeconds,
  resolveNaturalMediaTimelineDuration,
  resolveNaturalMediaTimelineDurationFromValues,
  resolveTimedImageDurationSeconds,
} from "./playbackRate";
import * as coreBounds from "../playbackRateBounds";

function elementWith(attributes: Record<string, string>): Pick<Element, "getAttribute"> {
  return {
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  };
}

describe("resolveNaturalMediaTimelineDuration", () => {
  it.each([
    ["2x", 5],
    ["0x2", 10],
  ])("matches native playback-rate parsing for %s", (rate, expected) => {
    expect(
      resolveNaturalMediaTimelineDuration(elementWith({ "data-playback-rate": rate }), 10),
    ).toBe(expected);
  });

  it.each([10, 11])("returns a known zero span at or past source EOF (start=%s)", (start) => {
    expect(
      resolveNaturalMediaTimelineDuration(elementWith({ "data-media-start": String(start) }), 10),
    ).toBe(0);
  });

  it("returns null only when source duration is unknown", () => {
    expect(resolveNaturalMediaTimelineDuration(elementWith({}), Number.NaN)).toBeNull();
  });
});

describe("rate lane duration", () => {
  it("resolves natural media duration through the lane", () => {
    const lane = {
      target: "rate",
      points: [
        { t: 0, v: 1 },
        { t: 2, v: 3 },
      ],
    };
    expect(resolveNaturalMediaTimelineDurationFromValues(4, 0, lane)).toBeCloseTo(
      2 + (4 - 3.641) / 3,
      2,
    );
    expect(resolveNaturalMediaTimelineDurationFromValues(10, 0, lane)).toBeCloseTo(
      2 + (10 - 3.641) / 3,
      2,
    );
  });

  it("keeps a rate lane's arithmetic when the shared resolver reports a media length", () => {
    const el = {
      ...elementWith({
        "data-automation": JSON.stringify({
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
        }),
      }),
      duration: 10,
    };
    expect(resolveMediaElementDurationSeconds(el)).toBeCloseTo(2 + (10 - 3.641) / 3, 2);
  });
});

describe("resolveMediaElementDurationSeconds over the shared media-duration fixtures", () => {
  // The runtime reader only sees video and audio; an image has no source to probe.
  for (const fixture of MEDIA_DURATION_FIXTURES.filter((f) => f.tag !== "img")) {
    it(fixture.name, () => {
      const el = {
        ...elementWith(fixture.attrs),
        duration: fixture.sourceDurationSeconds ?? Number.NaN,
      };
      expect(resolveMediaElementDurationSeconds(el)).toBe(fixture.expected.seconds);
    });
  }
});

describe("resolveTimedImageDurationSeconds over the shared media-duration fixtures", () => {
  const imgWith = (attrs: Readonly<Record<string, string>>) => {
    const img = document.createElement("img");
    for (const [name, value] of Object.entries(attrs)) img.setAttribute(name, value);
    return img;
  };

  for (const fixture of MEDIA_DURATION_FIXTURES.filter((f) => f.tag === "img")) {
    it(fixture.name, () => {
      expect(resolveTimedImageDurationSeconds(imgWith(fixture.attrs))).toBe(
        fixture.expected.seconds,
      );
    });
  }

  it("leaves a bare image, with no timing attribute, as a static layer", () => {
    expect(resolveTimedImageDurationSeconds(imgWith({}))).toBeNull();
  });

  it("does not time anything that is not an image", () => {
    expect(resolveTimedImageDurationSeconds(document.createElement("div"))).toBeNull();
  });
});

describe("the playback rate bound", () => {
  it("has one owner: core's bounds are the parsers bounds", () => {
    expect([coreBounds.MIN_PLAYBACK_RATE, coreBounds.MAX_PLAYBACK_RATE]).toEqual([
      parsersBounds.MIN_PLAYBACK_RATE,
      parsersBounds.MAX_PLAYBACK_RATE,
    ]);
  });
});
