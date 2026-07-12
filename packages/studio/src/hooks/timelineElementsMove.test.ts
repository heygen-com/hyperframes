// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TimelineElement } from "../player";
import { furthestClipEndFromSource } from "../player/lib/timelineElementHelpers";
import { persistTimelineElementsMove, type TimelineElementMoveEdit } from "./timelineElementsMove";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { shiftGsapPositionsBatch } from "./timelineEditingHelpers";

function el(over: Partial<TimelineElement> & Pick<TimelineElement, "id">): TimelineElement {
  return { tag: "div", start: 0, duration: 1, track: 0, ...over };
}

// A bed mirroring the user's qa-clean: an 8s audio clip whose real end sits past a
// STALE root data-duration. `furthestClipEndFromSource` must read the raw 8, not
// the stale root or a truncated value.
const bed = (rootDuration: number, musicStart: number) =>
  `<!DOCTYPE html><html><body>
    <div data-hf-id="hf-root" id="root" data-composition-id="qa-clean" data-start="0" data-duration="${rootDuration}" data-no-timeline="">
      <video data-hf-id="hf-v1" id="bg-video" class="clip" data-start="1" data-duration="3" data-track-index="0"></video>
      <audio data-hf-id="hf-music" id="bg-music" class="clip" data-start="${musicStart}" data-duration="8" data-track-index="2"></audio>
    </div>
  </body></html>`;

describe("furthestClipEndFromSource", () => {
  it("reads the RAW data-duration, past a stale root duration", () => {
    // audio 11.53 + 8 = 19.53, even though the root claims only 15.18
    expect(furthestClipEndFromSource(bed(15.18, 11.53))).toBeCloseTo(19.53, 5);
  });

  it("excludes the composition root itself", () => {
    // root data-duration is huge; furthest CLIP end is the audio at 8.88
    const src = `<html><body><div data-composition-id="c" data-start="0" data-duration="99" data-no-timeline="">
      <audio data-hf-id="a" data-start="4.88" data-duration="4" data-track-index="0"></audio>
    </div></body></html>`;
    expect(furthestClipEndFromSource(src)).toBeCloseTo(8.88, 5);
  });

  it("returns 0 when there are no clips", () => {
    expect(
      furthestClipEndFromSource(
        `<html><body><div data-composition-id="c" data-start="0" data-duration="10" data-no-timeline=""></div></body></html>`,
      ),
    ).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(furthestClipEndFromSource("")).toBe(0);
  });
});

// ── Persist-level test (the G2 + §6.1 feedback-loop boundary) ────────────────
// Proves the batched move writes the root duration computed from the SAVED SOURCE
// (raw data-duration), not the stale root value and not a runtime-truncated store
// duration. Without the source-based calc this shrinks/stalls the composition.
const h = vi.hoisted(() => ({ source: "", savedFiles: [] as Record<string, string>[] }));

// Stateful player-store stub: records setDuration calls and exposes a settable
// `duration`/`currentTime` so the duration-rollback path (ITEM 11) is observable
// without touching the real store.
const storeState = vi.hoisted(() => {
  const s = {
    duration: 0,
    currentTime: 0,
    setDurationCalls: [] as number[],
    setDuration: (value: number) => {
      s.duration = value;
      s.setDurationCalls.push(value);
    },
  };
  return s;
});

vi.mock("../player", () => ({
  usePlayerStore: { getState: () => storeState },
}));

vi.mock("../utils/studioFileHistory", () => ({
  saveProjectFilesWithHistory: vi.fn(async (input: { files: Record<string, string> }) => {
    h.savedFiles.push(input.files);
  }),
}));

const readFileContentMock = vi.hoisted(() =>
  vi.fn(async (_projectId: string, _path: string): Promise<string> => ""),
);

vi.mock("./timelineEditingHelpers", async (importActual) => {
  const actual = await importActual<typeof import("./timelineEditingHelpers")>();
  return {
    ...actual,
    readFileContent: readFileContentMock,
    patchIframeDomTiming: vi.fn(),
    shiftGsapPositionsBatch: vi.fn(async () => ({ scriptText: null })),
  };
});

function move(
  element: TimelineElement,
  start: number,
  track = element.track,
): TimelineElementMoveEdit {
  return { element, updates: { start, track } };
}

type PersistOpts = Parameters<typeof persistTimelineElementsMove>[1];

// The persist options are identical across tests except for `reloadPreview`
// (some tests spy on it). Build the shared defaults, allow per-test overrides.
function persistOpts(over: Partial<PersistOpts> = {}): PersistOpts {
  return {
    projectId: "p",
    activeCompPath: "index.html",
    previewIframe: null,
    writeProjectFile: async () => {},
    recordEdit: async () => {},
    reloadPreview: () => {},
    domEditSaveTimestampRef: { current: 0 },
    ...over,
  };
}

// A move spanning the root comp + a sub-comp: distinct source per path.
const twoFileSource: Record<string, string> = {
  "index.html": bed(15.18, 7.18),
  "scenes/intro.html": bed(15.18, 2),
};
function mockTwoFileSource(): void {
  readFileContentMock.mockImplementation(async (_pid: string, path: string) => twoFileSource[path]);
}

describe("persistTimelineElementsMove — writes source-derived duration", () => {
  beforeEach(() => {
    h.savedFiles.length = 0;
    readFileContentMock.mockReset();
    readFileContentMock.mockImplementation(async () => h.source);
  });

  it("grows the root duration to the moved audio's real 8s end (not the stale 15.18)", async () => {
    // Stale bed: root says 15.18; audio (8s) currently ends there at start 7.18.
    h.source = bed(15.18, 7.18);
    const music = el({ id: "hf-music", hfId: "hf-music", start: 7.18, duration: 8, track: 2 });

    await persistTimelineElementsMove([move(music, 11.53)], persistOpts());

    expect(h.savedFiles).toHaveLength(1);
    const saved = h.savedFiles[0]["index.html"];
    expect(saved).toContain('data-start="11.53"'); // audio moved
    expect(saved).toContain('data-duration="19.53"'); // grown to the raw 8s end
    expect(saved).not.toContain('data-duration="15.18"'); // stale root gone
  });

  // PORT 2 — group-move rollback discipline. A move whose clips span two source
  // files (e.g. a sub-comp) must land as ONE atomic save with ONE history entry,
  // not one write-per-file. saveProjectFilesWithHistory already writes-all /
  // records-one / rolls-back-all, so passing every file in a single call gives
  // all-or-nothing on disk that matches the caller's all-or-nothing store rollback.
  it("folds clips from two source files into ONE atomic save (single history entry)", async () => {
    // Distinct source per path; a single move edit touches each file.
    mockTwoFileSource();

    const rootMusic = el({ id: "hf-music", hfId: "hf-music", start: 7.18, duration: 8, track: 2 });
    const subMusic = el({
      id: "hf-music",
      hfId: "hf-music",
      start: 2,
      duration: 8,
      track: 2,
      sourceFile: "scenes/intro.html",
    });

    await persistTimelineElementsMove([move(rootMusic, 9), move(subMusic, 4)], persistOpts());

    // ONE save call carrying BOTH files (not two per-file saves).
    expect(h.savedFiles).toHaveLength(1);
    expect(Object.keys(h.savedFiles[0]).sort()).toEqual(["index.html", "scenes/intro.html"]);
    expect(h.savedFiles[0]["index.html"]).toContain('data-start="9"');
    expect(h.savedFiles[0]["scenes/intro.html"]).toContain('data-start="4"');
  });
});

// ── ITEM 11 — duration rollback on a failed write ───────────────────────────
describe("persistTimelineElementsMove — reverts optimistic duration on write failure", () => {
  const save = saveProjectFilesWithHistory as unknown as Mock;

  beforeEach(() => {
    readFileContentMock.mockReset();
    readFileContentMock.mockImplementation(async () => h.source);
    storeState.setDurationCalls.length = 0;
  });

  it("restores the store/root duration to its previous value when the atomic save throws", async () => {
    storeState.duration = 15.18; // the length before the move
    h.source = bed(15.18, 7.18); // audio (8s) currently ends at 15.18
    save.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });
    const music = el({ id: "hf-music", hfId: "hf-music", start: 7.18, duration: 8, track: 2 });

    await expect(persistTimelineElementsMove([move(music, 11.53)], persistOpts())).rejects.toThrow(
      "disk full",
    );

    // Optimistically grew to the moved audio's 19.53 end, then rolled back to 15.18.
    expect(storeState.setDurationCalls).toEqual([19.53, 15.18]);
  });
});

// ── ITEM 10 — multi-file move must not clobber the shared preview iframe ─────
describe("persistTimelineElementsMove — preview sync scopes soft-reload to the active comp", () => {
  const shiftBatch = shiftGsapPositionsBatch as unknown as Mock;

  beforeEach(() => {
    readFileContentMock.mockReset();
    shiftBatch.mockClear();
    shiftBatch.mockResolvedValue({ scriptText: null });
  });

  it("runs the durable GSAP shift for EVERY changed group and full-reloads once when a non-active file also changed", async () => {
    mockTwoFileSource();
    const reloadPreview = vi.fn();
    const rootMusic = el({
      id: "hf-music",
      hfId: "hf-music",
      domId: "bg-music",
      start: 7.18,
      duration: 8,
      track: 2,
    });
    const subMusic = el({
      id: "hf-music",
      hfId: "hf-music",
      domId: "bg-music",
      start: 2,
      duration: 8,
      track: 2,
      sourceFile: "scenes/intro.html",
    });

    await persistTimelineElementsMove(
      [move(rootMusic, 9), move(subMusic, 4)],
      persistOpts({ reloadPreview }),
    );

    // shiftGsapPositionsBatch is a DURABLE server file rewrite, not a cosmetic
    // preview step — it must run once PER changed group (each against its own
    // targetPath), not be skipped for the non-active sub-comp. Skipping it left the
    // sub-comp's persisted tween positions desynced from its clip timings forever.
    expect(shiftBatch).toHaveBeenCalledTimes(2);
    const shiftedPaths = shiftBatch.mock.calls.map((c) => c[1]).sort();
    expect(shiftedPaths).toEqual(["index.html", "scenes/intro.html"]);
    // The shared iframe still can't soft-reload a sub-comp, so exactly ONE full
    // reload reflects every changed file.
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("soft-reloads (batched GSAP shift) when only the active comp changed", async () => {
    h.source = bed(15.18, 7.18);
    readFileContentMock.mockImplementation(async () => h.source);
    const reloadPreview = vi.fn();
    const music = el({
      id: "hf-music",
      hfId: "hf-music",
      domId: "bg-music",
      start: 7.18,
      duration: 8,
      track: 2,
    });

    await persistTimelineElementsMove([move(music, 11.53)], persistOpts({ reloadPreview }));

    // Only the active comp changed → soft path: exactly one batched GSAP shift, for it.
    expect(shiftBatch).toHaveBeenCalledTimes(1);
    expect(shiftBatch.mock.calls[0][1]).toBe("index.html");
  });
});
