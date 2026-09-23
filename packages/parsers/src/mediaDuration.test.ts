import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_TIMELINE_DURATION_SECONDS,
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  PENDING_MEDIA_DURATION_READERS,
  readAuthoredDurationSeconds,
  readMediaOffsetSeconds,
  readPlaybackRate,
  resolveMediaDuration,
  resolveNaturalDurationSeconds,
} from "./mediaDuration.js";
import { MEDIA_DURATION_FIXTURES, type MediaDurationFixture } from "./mediaDurationFixtures.js";

// The parsers reader of the shared fixture table: attributes in, resolved length out.
const resolveFixture = (f: MediaDurationFixture) => {
  const getAttr = (name: string) => f.attrs[name];
  const start = Number(f.attrs["data-start"] ?? 0);
  return resolveMediaDuration({
    tag: f.tag,
    authoredDurationSeconds: readAuthoredDurationSeconds(getAttr, start),
    sourceDurationSeconds: f.sourceDurationSeconds,
    mediaStartSeconds: readMediaOffsetSeconds(getAttr),
    playbackRate: readPlaybackRate(getAttr),
  });
};

describe("resolveMediaDuration contract", () => {
  for (const fixture of MEDIA_DURATION_FIXTURES) {
    it(fixture.name, () => {
      expect(resolveFixture(fixture)).toEqual(fixture.expected);
    });
  }

  it("uses the one exported image default", () => {
    expect(DEFAULT_IMAGE_TIMELINE_DURATION_SECONDS).toBe(3);
  });

  it("lists at least one pending reader, so the list can only shrink from here", () => {
    expect(PENDING_MEDIA_DURATION_READERS.length).toBeGreaterThan(0);
  });
});

describe("readAuthoredDurationSeconds", () => {
  const attrs = (values: Record<string, string>) => (name: string) => values[name];

  it("prefers data-duration over data-end", () => {
    expect(readAuthoredDurationSeconds(attrs({ "data-duration": "3", "data-end": "9" }), 1)).toBe(
      3,
    );
  });

  it("falls back to data-end minus the element's start", () => {
    expect(readAuthoredDurationSeconds(attrs({ "data-end": "9" }), 4)).toBe(5);
  });

  it("returns null when nothing is authored", () => {
    expect(readAuthoredDurationSeconds(attrs({}), 0)).toBeNull();
  });
});

describe("readMediaOffsetSeconds", () => {
  const attrs = (values: Record<string, string>) => (name: string) => values[name];

  it("prefers data-playback-start over the older data-media-start", () => {
    expect(
      readMediaOffsetSeconds(attrs({ "data-playback-start": "2", "data-media-start": "9" })),
    ).toBe(2);
  });

  it("falls back to data-media-start", () => {
    expect(readMediaOffsetSeconds(attrs({ "data-media-start": "3" }))).toBe(3);
  });

  it("skips a negative data-playback-start and uses data-media-start", () => {
    expect(
      readMediaOffsetSeconds(attrs({ "data-playback-start": "-1", "data-media-start": "3" })),
    ).toBe(3);
  });

  it("defaults to 0 for a negative or absent offset", () => {
    expect(readMediaOffsetSeconds(attrs({ "data-media-start": "-1" }))).toBe(0);
    expect(readMediaOffsetSeconds(attrs({}))).toBe(0);
  });
});

describe("readPlaybackRate", () => {
  const attrs = (values: Record<string, string>) => (name: string) => values[name];

  it("clamps an authored rate to the shared bounds", () => {
    expect(readPlaybackRate(attrs({ "data-playback-rate": "50" }))).toBe(MAX_PLAYBACK_RATE);
    expect(readPlaybackRate(attrs({ "data-playback-rate": "0.001" }))).toBe(MIN_PLAYBACK_RATE);
    expect([MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE]).toEqual([0.1, 10]);
  });

  it("falls back to the given default (a media element's own rate) when none is authored", () => {
    expect(readPlaybackRate(attrs({}), 2)).toBe(2);
  });

  it("reads a native-style rate like 2x as 2", () => {
    expect(readPlaybackRate(attrs({ "data-playback-rate": "2x" }))).toBe(2);
  });

  it("defaults to 1 for a missing or non-positive rate", () => {
    expect(readPlaybackRate(attrs({}))).toBe(1);
    expect(readPlaybackRate(attrs({ "data-playback-rate": "0" }))).toBe(1);
  });
});

describe("resolveNaturalDurationSeconds", () => {
  it("subtracts the offset and divides by the rate", () => {
    expect(resolveNaturalDurationSeconds(20, 5, 2)).toBe(7.5);
  });

  it("never goes negative when the offset exceeds the source", () => {
    expect(resolveNaturalDurationSeconds(5, 10, 1)).toBe(0);
  });

  it("returns null for a non-finite source", () => {
    expect(resolveNaturalDurationSeconds(Number.NaN, 0, 1)).toBeNull();
    expect(resolveNaturalDurationSeconds(Number.POSITIVE_INFINITY, 0, 1)).toBeNull();
  });
});
