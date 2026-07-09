import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import {
  persistTimelineElementsMove,
  resolveMovedContentEnd,
  type TimelineElementMoveEdit,
} from "./timelineElementsMove";

function el(over: Partial<TimelineElement> & Pick<TimelineElement, "id">): TimelineElement {
  return { tag: "div", start: 0, duration: 1, track: 0, ...over };
}

function move(
  element: TimelineElement,
  start: number,
  track = element.track,
): TimelineElementMoveEdit {
  return { element, updates: { start, track } };
}

describe("resolveMovedContentEnd", () => {
  it("uses the moved clip's NEW start — the audio-past-end case from HANDOFF-3 §6.1", () => {
    // Reproduces the user's bed: image + 2 videos + an 8s audio clip dragged so it
    // now starts at 11.53 and ends at 19.53, while the stale file says 15.18.
    const img = el({ id: "hf-img", start: 4.88, duration: 4, track: 1 });
    const v1 = el({ id: "hf-v1", start: 1, duration: 3, track: 0 });
    const v2 = el({ id: "hf-v2", start: 1.47, duration: 3, track: 1 });
    const music = el({ id: "hf-music", start: 7.18, duration: 8, track: 2 });
    const elements = [img, v1, v2, music];

    // The music clip is dragged (lane-change/insert → batched path) to start 11.53.
    const end = resolveMovedContentEnd(elements, [move(music, 11.53)], "index.html", "index.html");

    expect(end).toBeCloseTo(19.53, 5); // NOT the pre-move 15.18
  });

  it("shrinks: when the furthest clip moves left the content end drops", () => {
    const a = el({ id: "a", start: 0, duration: 3, track: 0 });
    const b = el({ id: "b", start: 12, duration: 4, track: 1 }); // ends 16
    const end = resolveMovedContentEnd([a, b], [move(b, 2)], "index.html", "index.html");
    expect(end).toBeCloseTo(6, 5); // b now ends at 6, a ends at 3
  });

  it("only counts clips in the target file", () => {
    const here = el({ id: "here", start: 0, duration: 5, track: 0, sourceFile: "index.html" });
    const other = el({
      id: "other",
      start: 0,
      duration: 99,
      track: 0,
      sourceFile: "scenes/a.html",
    });
    const end = resolveMovedContentEnd([here, other], [move(here, 4)], "index.html", "index.html");
    expect(end).toBeCloseTo(9, 5); // ignores the 99-long clip in scenes/a.html
  });

  it("prefers key over id when matching a moved clip", () => {
    const clip = el({ id: "dup", key: "k1", start: 0, duration: 2, track: 0 });
    const end = resolveMovedContentEnd([clip], [move(clip, 10)], "index.html", "index.html");
    expect(end).toBeCloseTo(12, 5);
  });

  it("returns 0 for an empty file (no-op duration, keeps declared length)", () => {
    expect(resolveMovedContentEnd([], [], "index.html", "index.html")).toBe(0);
  });
});

// ── Persist-level test (the G2 boundary) ────────────────────────────────────
// HANDOFF-3 §8 G2: the prior overlap bug passed unit tests but diverged live
// because the defect lived at the persist↔source boundary. This exercises the
// REAL persist function with mocked I/O and asserts the SAVED SOURCE STRING —
// proving the batched path actually writes the synced root data-duration, not
// just that the pure helper computes it.
const h = vi.hoisted(() => ({
  storeElements: [] as TimelineElement[],
  savedFiles: [] as Record<string, string>[],
  source: "",
}));

vi.mock("../player", () => ({
  usePlayerStore: { getState: () => ({ elements: h.storeElements }) },
}));

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

const bed = (rootDuration: number, musicStart: number) =>
  `<!DOCTYPE html>
<html><body>
  <div data-hf-id="hf-root" id="root" data-composition-id="qa-clean" data-start="0" data-duration="${rootDuration}">
    <video data-hf-id="hf-v1" id="bg-video" class="clip" data-start="1" data-duration="3" data-track-index="0"></video>
    <audio data-hf-id="hf-music" id="bg-music" class="clip" data-start="${musicStart}" data-duration="8" data-track-index="2"></audio>
  </div>
</body></html>`;

describe("persistTimelineElementsMove — writes synced root duration", () => {
  beforeEach(() => {
    h.savedFiles.length = 0;
  });

  it("syncs the file's data-duration to the moved audio's end (the user's exact bug)", async () => {
    // File & store are in the STALE state: root says 15.18, audio ends 15.18.
    h.source = bed(15.18, 7.18);
    const music = el({ id: "hf-music", hfId: "hf-music", start: 7.18, duration: 8, track: 2 });
    const v1 = el({ id: "hf-v1", hfId: "hf-v1", start: 1, duration: 3, track: 0 });
    // Store reflects the move already applied (optimistic update) — audio now 11.53.
    h.storeElements = [v1, { ...music, start: 11.53 }];

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
    expect(saved).toContain('data-duration="19.53"'); // root grown to content end
    expect(saved).not.toContain('data-duration="15.18"'); // stale value gone
  });
});
