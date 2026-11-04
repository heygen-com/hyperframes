import { describe, expect, it } from "vitest";
import fixture from "./fixtures/storyboard-manifest-v1.json";
import { assignMissingFrameIds, setFrameFieldById } from "./frameIdentity.js";
import { parseStoryboard } from "./parseStoryboard.js";
import { createReviewBoardManifest } from "./reviewManifest.js";

const a = "11111111111141118111111111111111";
const b = "22222222222242228222222222222222";
const first = `## Frame 1 — First\n- frame_id: ${a}\n- duration: 2s\n\nFirst narrative.\n`;
const second = `## Frame 2 — Second\n- frame_id: ${b}\n\nSecond narrative.\n`;

describe("persisted storyboard identity", () => {
  it("does not assign or edit frame-shaped headings inside frontmatter", () => {
    const metadata = "---\n## Frame 99\nmessage: Plan\n---\n";
    const upgraded = assignMissingFrameIds(metadata + "## Frame 1\nNarrative.", () => a);
    expect(upgraded.startsWith(metadata)).toBe(true);
    expect(parseStoryboard(upgraded).frames[0]?.frameId).toBe(a);
    const edited = setFrameFieldById(upgraded, a, "scene", "Updated");
    expect(edited.startsWith(metadata)).toBe(true);
    expect(parseStoryboard(edited).frames[0]?.scene).toBe("Updated");
  });
  it("produces the exact normalized fixture accepted by the backend", () => {
    const source = `## Frame 1 — First
- frame_id: ${a}
- status: built
- act: Opening
- motion: Slow push in
- duration: 2s

Show the product.

## Frame 2 — Second
- frame_id: 33333333333343338333333333333333

Still to sketch.`;
    const result = createReviewBoardManifest(parseStoryboard(source), {
      title: "Launch 🎬",
      stills: new Map([
        [
          a,
          {
            asset_id: b,
            sha256: "a".repeat(64),
            mime_type: "image/png",
            width: 1920,
            height: 1080,
          },
        ],
      ]),
    });
    expect(result).toEqual(fixture);
  });

  it("refuses out-of-bounds timing, text and dimensions", () => {
    expect(() =>
      createReviewBoardManifest(parseStoryboard(first.replace("2s", "0s")), { title: "Plan" }),
    ).toThrow("duration");
    expect(() =>
      createReviewBoardManifest(parseStoryboard(first), { title: "x".repeat(257) }),
    ).toThrow("text");
    expect(() =>
      createReviewBoardManifest(parseStoryboard(first), {
        title: "Plan",
        stills: new Map([
          [
            a,
            {
              asset_id: b,
              sha256: "a".repeat(64),
              mime_type: "image/png",
              width: 16384,
              height: 16384,
            },
          ],
        ]),
      }),
    ).toThrow("dimensions");
  });
  it("assigns legacy IDs once without changing existing identities on repeated preparation", () => {
    const legacy = `${first}\n## Frame 2 — Legacy\n- status: built\nKeep this text.\n`;
    const upgraded = assignMissingFrameIds(legacy, () => b);
    expect(upgraded).toContain(first);
    expect(upgraded).toContain("Keep this text.");
    expect(parseStoryboard(upgraded).frames.map((f) => f.frameId)).toEqual([a, b]);
    expect(
      assignMissingFrameIds(upgraded, () => {
        throw new Error("must not generate again");
      }),
    ).toBe(upgraded);
  });

  it("edits the same identity after reorder and relabel instead of the old ordinal", () => {
    const reordered = second.replace("Frame 2 — Second", "Frame 8 — Renamed") + first;
    const edited = setFrameFieldById(reordered, a, "voiceover", "New line");
    expect(parseStoryboard(edited).frames.map((f) => [f.frameId, f.voiceover])).toEqual([
      [b, undefined],
      [a, "New line"],
    ]);
    expect(() => setFrameFieldById(second, a, "scene", "Lost")).toThrow("not found");
    expect(() => setFrameFieldById(first, a, "frame_id", b)).toThrow("identity");
  });

  it.each(["", "NOT-AN-ID", a + "\n- frame_id: " + b])(
    "refuses malformed or repeated ID metadata rather than silently reassigning it: %s",
    (value) => {
      const source = `## Frame 1\n- frame_id: ${value}\n`;
      expect(() => assignMissingFrameIds(source, () => a)).toThrow();
    },
  );

  it("rejects copied identities and a colliding ID generator", () => {
    expect(() => assignMissingFrameIds(first + first, () => b)).toThrow();
    expect(() => assignMissingFrameIds(first + "\n## Frame 2", () => a)).toThrow();
  });

  it("keeps immutable review input independent of source reorder and missing stills", () => {
    const manifest = createReviewBoardManifest(parseStoryboard(first + second), { title: "Plan" });
    expect(manifest.frames.map((f) => [f.frame_id, f.still, f.planned_duration_ms])).toEqual([
      [a, null, 2000],
      [b, null, null],
    ]);
    const reordered = createReviewBoardManifest(parseStoryboard(second + first), { title: "Plan" });
    expect(reordered.frames.map((f) => f.frame_id)).toEqual([b, a]);
    expect(manifest.frames[0]?.frame_id).toBe(a);
    expect(() =>
      createReviewBoardManifest(parseStoryboard("## Frame 1"), { title: "Legacy" }),
    ).toThrow();
  });

  it("requires valid immutable still metadata and refuses receipts for absent frames", () => {
    const receipt = {
      asset_id: b,
      sha256: "a".repeat(64),
      mime_type: "image/png" as const,
      width: 1920,
      height: 1080,
    };
    const manifest = createReviewBoardManifest(parseStoryboard(first), {
      title: "Plan",
      stills: new Map([[a, receipt]]),
    });
    receipt.width = 1;
    expect(manifest.frames[0]?.still?.width).toBe(1920);
    expect(() =>
      createReviewBoardManifest(parseStoryboard(first), {
        title: "Plan",
        stills: new Map([[b, receipt]]),
      }),
    ).toThrow("unknown frame");
    expect(() =>
      createReviewBoardManifest(parseStoryboard(first), {
        title: "Plan",
        stills: new Map([[a, { ...receipt, sha256: "path.png" }]]),
      }),
    ).toThrow();
  });
});
