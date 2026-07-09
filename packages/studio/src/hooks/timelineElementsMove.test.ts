// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import { furthestClipEndFromSource } from "../player/lib/timelineElementHelpers";
import { persistTimelineElementsMove, type TimelineElementMoveEdit } from "./timelineElementsMove";

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

vi.mock("../utils/studioFileHistory", () => ({
  saveProjectFilesWithHistory: vi.fn(async (input: { files: Record<string, string> }) => {
    h.savedFiles.push(input.files);
  }),
}));

vi.mock("./timelineEditingHelpers", async (importActual) => {
  const actual = await importActual<typeof import("./timelineEditingHelpers")>();
  return {
    ...actual,
    readFileContent: vi.fn(async () => h.source),
    patchIframeDomTiming: vi.fn(),
    shiftGsapPositionsBatch: vi.fn(async () => {}),
  };
});

function move(
  element: TimelineElement,
  start: number,
  track = element.track,
): TimelineElementMoveEdit {
  return { element, updates: { start, track } };
}

describe("persistTimelineElementsMove — writes source-derived duration", () => {
  beforeEach(() => {
    h.savedFiles.length = 0;
  });

  it("grows the root duration to the moved audio's real 8s end (not the stale 15.18)", async () => {
    // Stale bed: root says 15.18; audio (8s) currently ends there at start 7.18.
    h.source = bed(15.18, 7.18);
    const music = el({ id: "hf-music", hfId: "hf-music", start: 7.18, duration: 8, track: 2 });

    await persistTimelineElementsMove([move(music, 11.53)], {
      projectId: "p",
      activeCompPath: "index.html",
      previewIframe: null,
      writeProjectFile: async () => {},
      recordEdit: async () => {},
      reloadPreview: () => {},
      domEditSaveTimestampRef: { current: 0 },
    });

    expect(h.savedFiles).toHaveLength(1);
    const saved = h.savedFiles[0]["index.html"];
    expect(saved).toContain('data-start="11.53"'); // audio moved
    expect(saved).toContain('data-duration="19.53"'); // grown to the raw 8s end
    expect(saved).not.toContain('data-duration="15.18"'); // stale root gone
  });
});
