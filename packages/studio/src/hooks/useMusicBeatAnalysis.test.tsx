// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import { usePlayerStore } from "../player/store/playerStore";
import { FileManagerProvider } from "../contexts/FileManagerContext";
import { mountReactHarness } from "./domSelectionTestHarness";

const analyze = vi.hoisted(() => vi.fn());
const read = vi.hoisted(() => vi.fn(async (_url: string) => [new Float32Array(1)]));
vi.mock("@hyperframes/core/beats", async (actual) => ({
  ...(await actual<typeof import("@hyperframes/core/beats")>()),
  analyzeMusicFromSignal: analyze,
}));
vi.mock("../utils/projectPcm", () => ({
  analysisRateOf: async () => 48_000,
  readPcmChannels: read,
}));
// The timeline is at rest, so a read starts within the settle below and "nothing was read" means it.
vi.mock("../player/components/timelineMotion", async (actual) => ({
  ...(await actual<typeof import("../player/components/timelineMotion")>()),
  whenTimelineIdle: async () => {},
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

/** Studio's timeline opened on `elements`: which files beat analysis decoded, and the beat times it shows. The hook
 * caches an analysis per file, so each case names its own. */
async function opened(elements: TimelineElement[]) {
  usePlayerStore.setState({ elements, beatAnalysis: null });
  const root = mountReactHarness(
    <FileManagerProvider value={files}>
      <Probe />
    </FileManagerProvider>,
  );
  await act(async () => {
    await new Promise((settled) => setTimeout(settled, 0));
  });
  const beats = usePlayerStore.getState().beatAnalysis?.beatTimes ?? null;
  act(() => root.unmount());
  return { decoded: read.mock.calls.map(([src]) => src), beats };
}

beforeEach(() => {
  savedBeats = "";
  analyze.mockReset();
  read.mockClear();
  analyze.mockResolvedValue({ beatTimes: [1, 2], beatStrengths: [1, 1], bpm: 120 });
});
afterEach(() =>
  usePlayerStore.setState({ elements: [], beatEdits: null, beatUndo: [], beatRedo: [] }),
);

// fails without the fix: a 62-minute recording with no role was picked as the music and decoded whole (1.4 GB on
// a Mac, which ran a person's page out of memory while their talk was still being transcribed).
describe("beat analysis decodes only a file no longer than a song", () => {
  it("leaves a 62-minute unlabelled recording alone", async () => {
    const talk = clip({ src: "assets/talk.m4a", duration: 3720, sourceDuration: 3720 });
    expect((await opened([talk])).decoded).toEqual([]);
  });

  it("leaves a 3-minute clip of a 62-minute file alone, since the decode reads the whole file", async () => {
    const cut = clip({ src: "assets/cut.m4a", duration: 180, sourceDuration: 3720 });
    expect((await opened([cut])).decoded).toEqual([]);
  });

  it("leaves a recording alone while its file's length is unknown", async () => {
    expect((await opened([clip({ src: "assets/unread.m4a", duration: 180 })])).decoded).toEqual([]);
  });

  it("shows a 62-minute music track's saved beats without decoding it", async () => {
    savedBeats = serializeBeats([1, 2], [1, 1], "assets/mix.m4a");
    const mix = clip({
      src: "assets/mix.m4a",
      timelineRole: "music",
      duration: 3720,
      sourceDuration: 3720,
    });
    expect(await opened([mix])).toEqual({ decoded: [], beats: [1, 2] });
  });

  it("still finds the beats of a 3-minute song", async () => {
    const song = clip({ src: "assets/song.mp3", sourceDuration: 180 });
    expect(await opened([song])).toEqual({ decoded: ["assets/song.mp3"], beats: [1, 2] });
  });
});

// fails without the fix: the length arriving after the saved beats showed loaded the track again, which dropped the
// person's beat edit and its undo.
it("keeps a music track's beat edits and undo when its file's length arrives", async () => {
  savedBeats = serializeBeats([1, 2], [1, 1], "assets/edited.m4a");
  const music = { src: "assets/edited.m4a", timelineRole: "music" as const, duration: 180 };
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
  usePlayerStore.setState({ elements: [clip(music)], beatAnalysis: null, beatEdits: null });
  const root = mountReactHarness(
    <FileManagerProvider value={files}>
      <Probe />
    </FileManagerProvider>,
  );
  await settle();
  const edit = { src: "assets/edited.m4a", added: [{ time: 1.5, strength: 1 }], removed: [] };
  act(() => usePlayerStore.getState().commitBeatEdits(edit, "add beat"));
  act(() => usePlayerStore.setState({ elements: [clip({ ...music, sourceDuration: 180 })] }));
  await settle();
  const { beatEdits, beatUndo, beatAnalysis } = usePlayerStore.getState();
  act(() => root.unmount());
  expect({ beatEdits, undo: beatUndo.length, beats: beatAnalysis?.beatTimes }).toEqual({
    beatEdits: edit,
    undo: 1,
    beats: [1, 2],
  });
});
