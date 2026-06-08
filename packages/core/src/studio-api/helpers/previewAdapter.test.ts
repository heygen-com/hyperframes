/**
 * T10 — PreviewAdapter contract (spec for R7).
 *
 * `createPreviewAdapter` does not exist yet. These stubs define the expected
 * interface so R7 has a concrete target. Convert from it.todo to real
 * assertions in the R7 PR.
 *
 * Hit-testing (elementAtPoint) in both linkedom and jsdom returns null for
 * all geometry calls — the real tests must inject a position-resolver stub
 * or mock elementFromPoint. The contract tested is filtering logic (root
 * exclusion, data-hf-id ancestor walk, opacity-at-playhead), not geometry.
 */
import { describe, it } from "vitest";

describe("T10 — PreviewAdapter contract (spec for R7)", () => {
  describe("elementAtPoint", () => {
    it.todo("returns null for the stage root (data-hf-root)");

    it.todo("returns the nearest ancestor with data-hf-id");

    it.todo("returns null when the hit element has no data-hf-id ancestor");

    it.todo("skips elements whose computed opacity is 0 at the given playhead time");
  });

  describe("applyDraft / revertDraft", () => {
    it.todo("applyDraft writes --hf-studio-* CSS props and sets the gesture marker");

    it.todo("applyDraft accepts a move payload (dx/dy) and writes the translate draft");

    it.todo("applyDraft accepts a resize payload (w/h) and writes the size draft");

    it.todo("revertDraft removes draft props and clears the gesture marker");

    it.todo("revertDraft restores original translate when an original was recorded");
  });

  describe("applyDraft edge cases (R7 implementation contract)", () => {
    it.todo(
      "second applyDraft before revert/commit overwrites first draft — does not accumulate (dx/dy)",
    );

    it.todo(
      "revertDraft is safe to call when no gesture is in progress (idempotent / no-op on empty marker)",
    );

    it.todo(
      "elementAtPoint filtering is stable when playhead changes mid-drag — opacity re-evaluated per call",
    );

    it.todo(
      "stage-root exclusion applies only to the outermost data-hf-root; nested sub-composition roots count as targets",
    );
  });

  describe("commitPreview", () => {
    it.todo("returns null when no gesture marker is present");

    it.todo("derives a moveElement patch from draft markers on commit");

    it.todo("derives a resize patch from draft markers on commit");

    it.todo("clears the gesture marker after commit");
  });

  describe("getElementTimings", () => {
    it.todo("reads authored absolute times from data-start / data-end");

    it.todo("ignores elements without data-hf-id");

    it.todo(
      "returns a defined timing entry when data-hf-id is present but data-start / data-end are missing",
    );
  });
});
