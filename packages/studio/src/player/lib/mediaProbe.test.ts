// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyCachedSourceDurations, probeMissingSourceDurations } from "./mediaProbe";
import { metadataResolver } from "./mediaResolver";

/**
 * These cover ONE property: a media file is read from the network at most once
 * by the Studio document, no matter how many clips reference it and no matter
 * that the preview iframe is downloading it too.
 *
 * `mediabunny` is stubbed so every probe is observable (the URL it was handed)
 * and fails fast — the real one retries a dead URL with backoff.
 */
const probed = vi.hoisted(() => [] as string[]);

vi.mock("mediabunny", () => {
  class UrlSource {
    constructor(public url: string) {
      probed.push(url);
    }
  }
  class Input {
    constructor(_options: unknown) {}
    getDurationFromMetadata(): Promise<number> {
      return Promise.reject(new Error("probe stubbed"));
    }
    dispose(): void {}
  }
  return { UrlSource, Input, ALL_FORMATS: [] };
});

type Element = {
  id: string;
  tag: string;
  src?: string;
  sourceDuration?: number;
  sourceDurationPending?: boolean;
};

const clip = (id: string, src: string, extra: Partial<Element> = {}): Element => ({
  id,
  tag: "video",
  src,
  ...extra,
});

/** Distinct files the probe actually asked the network for. */
const probedFiles = () => [...new Set(probed.map((url) => url.split("/").pop()))].sort();

beforeEach(() => {
  probed.length = 0;
  metadataResolver.reset();
});

afterEach(() => {
  metadataResolver.reset();
});

describe("probeMissingSourceDurations", () => {
  it("probes a source nothing else is fetching", async () => {
    await probeMissingSourceDurations([clip("a", "/assets/a.mp4")], () => {});

    expect(probedFiles()).toEqual(["a.mp4"]);
  });

  it("skips a source the preview is already fetching", async () => {
    await probeMissingSourceDurations(
      [clip("a", "/assets/a.mp4", { sourceDurationPending: true })],
      () => {},
    );

    expect(probedFiles()).toEqual([]);
  });

  it("skips every clip of a source when ANY clip of it is pending", async () => {
    // The neighbourhood loader promotes one clip out of seven; its siblings
    // carry no pending mark, and probing one of them downloads the same file.
    await probeMissingSourceDurations(
      [
        clip("a1", "/assets/a.mp4", { sourceDurationPending: true }),
        clip("a2", "/assets/a.mp4"),
        clip("a3", "./assets/a.mp4"),
        clip("b1", "/assets/b.mp4"),
      ],
      () => {},
    );

    expect(probedFiles()).toEqual(["b.mp4"]);
  });
});

describe("applyCachedSourceDurations", () => {
  it("seeds every clip of a source from the one clip that knows its duration", () => {
    const seeded = applyCachedSourceDurations([
      clip("a1", "/assets/a.mp4", { sourceDuration: 12 }),
      clip("a2", "/assets/a.mp4"),
      clip("a3", "./assets/a.mp4"),
      clip("b1", "/assets/b.mp4"),
    ]);

    expect(seeded.map((el) => el.sourceDuration)).toEqual([12, 12, 12, undefined]);
  });

  it("leaves the seeded siblings out of the probe", async () => {
    const seeded = applyCachedSourceDurations([
      clip("a1", "/assets/a.mp4", { sourceDuration: 12 }),
      clip("a2", "/assets/a.mp4"),
    ]);
    await probeMissingSourceDurations(seeded, () => {});

    expect(probedFiles()).toEqual([]);
  });

  it("does not overwrite a clip that already carries its own duration", () => {
    const seeded = applyCachedSourceDurations([
      clip("a1", "/assets/a.mp4", { sourceDuration: 12 }),
      clip("a2", "/assets/a.mp4", { sourceDuration: 30 }),
    ]);

    expect(seeded.map((el) => el.sourceDuration)).toEqual([12, 30]);
  });
});
