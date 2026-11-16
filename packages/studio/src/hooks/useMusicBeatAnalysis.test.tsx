// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player/store/playerStore";
import { FileManagerProvider } from "../contexts/FileManagerContext";
import { mountReactHarness } from "./domSelectionTestHarness";

const analyze = vi.hoisted(() => vi.fn());
vi.mock("@hyperframes/core/beats", async (actual) => ({
  ...(await actual<typeof import("@hyperframes/core/beats")>()),
  analyzeMusicFromUrl: analyze,
}));

const { useMusicBeatAnalysis } = await import("./useMusicBeatAnalysis");
const { serializeBeats } = await import("@hyperframes/core/beats");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const clip = (overrides: Partial<TimelineElement>) =>
  ({
    id: "talk",
    domId: "talk",
    key: "talk",
    tag: "audio",
    src: "assets/talk.m4a",
    start: 0,
    duration: 180,
    track: 3,
    ...overrides,
  }) as TimelineElement;

let savedBeats = "";
const files = {
  readOptionalProjectFile: async () => savedBeats,
  writeProjectFile: async () => {},
} as unknown as React.ComponentProps<typeof FileManagerProvider>["value"];

function Probe() {
  useMusicBeatAnalysis();
  return null;
}

/** Studio's timeline opened on `elements`: which files beat analysis decoded. The hook caches an analysis per file,
 * so each case names its own. */
async function opened(elements: TimelineElement[]) {
  usePlayerStore.setState({ elements });
  const root = mountReactHarness(
    <FileManagerProvider value={files}>
      <Probe />
    </FileManagerProvider>,
  );
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
  act(() => root.unmount());
  return analyze.mock.calls.map(([src]) => src);
}

beforeEach(() => {
  savedBeats = "";
  analyze.mockReset();
  analyze.mockResolvedValue({ beatTimes: [1, 2], beatStrengths: [1, 1], bpm: 120 });
});
afterEach(() => usePlayerStore.setState({ elements: [] }));

// fails without the fix: a 62-minute recording with no role was picked as the music and decoded whole (1.4 GB on
// a Mac, which ran a person's page out of memory while their talk was still being transcribed).
describe("beat analysis decodes only a source no longer than a song", () => {
  it("leaves a 62-minute unlabelled recording alone", async () => {
    expect(
      await opened([clip({ src: "assets/talk.m4a", duration: 3720, sourceDuration: 3720 })]),
    ).toEqual([]);
  });

  it("leaves a 3-minute clip of a 62-minute file alone, since the decode reads the whole file", async () => {
    expect(
      await opened([clip({ src: "assets/cut.m4a", duration: 180, sourceDuration: 3720 })]),
    ).toEqual([]);
  });

  it("leaves a 62-minute track marked as music alone, even with saved beats", async () => {
    savedBeats = serializeBeats([1, 2], [1, 1], "assets/mix.m4a");
    const music = clip({
      src: "assets/mix.m4a",
      timelineRole: "music",
      duration: 3720,
      sourceDuration: 3720,
    });
    expect(await opened([music])).toEqual([]);
  });

  it("still finds the beats of a 3-minute song", async () => {
    expect(await opened([clip({ src: "assets/song.mp3", sourceDuration: 180 })])).toEqual([
      "assets/song.mp3",
    ]);
  });
});
