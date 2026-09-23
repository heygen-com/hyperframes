import type { MediaDurationResult, MediaTag } from "./mediaDuration.js";

/** The one fixture table every media-length reader is proven against: an authored
 *  element plus the source length a probe would report, and the `expected` result. */
export interface MediaDurationFixture {
  name: string;
  tag: MediaTag;
  attrs: Readonly<Record<string, string>>;
  sourceDurationSeconds: number | null;
  expected: MediaDurationResult;
}

export const MEDIA_DURATION_FIXTURES: readonly MediaDurationFixture[] = [
  {
    name: "authored data-duration wins over a known source length",
    tag: "video",
    attrs: { "data-start": "0", "data-duration": "4" },
    sourceDurationSeconds: 20,
    expected: { seconds: 4, source: "authored" },
  },
  {
    name: "video with only data-start resolves to the source length",
    tag: "video",
    attrs: { "data-start": "0" },
    sourceDurationSeconds: 12,
    expected: { seconds: 12, source: "media" },
  },
  {
    name: "video resolves to source minus offset over rate",
    tag: "video",
    attrs: { "data-start": "0", "data-playback-start": "5", "data-playback-rate": "2" },
    sourceDurationSeconds: 20,
    expected: { seconds: 7.5, source: "media" },
  },
  {
    name: "the older data-media-start offset still applies",
    tag: "audio",
    attrs: { "data-start": "0", "data-media-start": "4" },
    sourceDurationSeconds: 10,
    expected: { seconds: 6, source: "media" },
  },
  {
    name: "an offset past the end of the source is a known zero span",
    tag: "audio",
    attrs: { "data-start": "0", "data-media-start": "12" },
    sourceDurationSeconds: 10,
    expected: { seconds: 0, source: "media" },
  },
  {
    name: "a rate above the 10x bound is clamped",
    tag: "video",
    attrs: { "data-start": "0", "data-playback-rate": "20" },
    sourceDurationSeconds: 10,
    expected: { seconds: 1, source: "media" },
  },
  {
    name: "a native-style rate like 2x reads as 2",
    tag: "video",
    attrs: { "data-start": "0", "data-playback-rate": "2x" },
    sourceDurationSeconds: 10,
    expected: { seconds: 5, source: "media" },
  },
  {
    name: "a zero authored duration is not authored",
    tag: "video",
    attrs: { "data-start": "0", "data-duration": "0" },
    sourceDurationSeconds: 8,
    expected: { seconds: 8, source: "media" },
  },
  {
    name: "video with no probed source length is pending, not a guess",
    tag: "video",
    attrs: { "data-start": "0" },
    sourceDurationSeconds: null,
    expected: { seconds: null, source: "pending", reason: "source duration not yet probed" },
  },
  {
    name: "image with no authored duration takes the dropped-image default",
    tag: "img",
    attrs: { "data-start": "0" },
    sourceDurationSeconds: null,
    expected: { seconds: 3, source: "default" },
  },
  {
    name: "image with an authored duration is trimmed like any other media",
    tag: "img",
    attrs: { "data-start": "0", "data-duration": "1.5" },
    sourceDurationSeconds: null,
    expected: { seconds: 1.5, source: "authored" },
  },
];
