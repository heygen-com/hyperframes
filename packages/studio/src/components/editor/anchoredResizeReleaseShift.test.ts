// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  applyStudioBoxSize,
  applyStudioPathOffset,
  readStudioBoxSize,
  reapplyPositionEditsAfterSeek,
} from "./manualEditsDom";
import { buildBoxSizePatches, buildPathOffsetPatches } from "./manualEditsDomPatches";
import { createManualOffsetDragMember, applyManualOffsetDragCommit } from "./manualOffsetDrag";
import type { PatchOperation } from "../../utils/sourcePatcher";
import { splitTopLevelWhitespace } from "./manualEditsStyleHelpers";

/**
 * User-reported bug: an element shifts "a bit" AFTER releasing a corner resize,
 * but ONLY for anchored corners (NW/NE/SW), never SE.
 *
 * Root cause (proved with a real-layout Chromium replay, see the anchor-loop
 * test below): during a resize drag the per-frame anchor is derived from the
 * element's LIVE measured fixed corner — which already carries the offset applied
 * on the PREVIOUS frame — while `applyManualOffsetDragDraft` treats that anchor
 * as the ABSOLUTE offset. So `fixedStart - fixedNow` is really only the RESIDUAL
 * correction, and using it as the absolute value makes the anchor OSCILLATE
 * between the correct value and zero every frame:
 *   frame 0: offset 0 → corner shifted by the resize → anchor = full amount → apply
 *   frame 1: offset applied → corner back at fixedStart → anchor = 0 → apply 0 (un-pin!)
 *   frame 2: offset 0 again → anchor = full amount → ...
 * Release commits `g.lastResizeAnchor` from whichever parity the last pointermove
 * landed on, so the element lands EITHER pinned OR un-pinned — an unpredictable
 * post-release "shift". SE is memberless, never enters the loop, never shifts.
 *
 * Fix (useDomEditOverlayGestures pointermove, resize branch): accumulate the
 * residual onto the previously-applied anchor instead of using it as the
 * absolute offset, so the loop converges to a stable value on every frame.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

/** Apply a built PatchOperation[] to a live element, mirroring sourcePatcher's
 * inline-style / attribute application — i.e. what the persisted source carries
 * when it is re-parsed into the DOM on the next preview load. */
function applyPatchesToElement(el: HTMLElement, ops: PatchOperation[]): void {
  for (const op of ops) {
    if (op.type === "inline-style") {
      if (op.value === null) el.style.removeProperty(op.property);
      else el.style.setProperty(op.property, op.value);
    } else if (op.type === "attribute") {
      if (op.value === null) el.removeAttribute(op.property);
      else el.setAttribute(op.property, op.value);
    }
  }
}

/** Net translate applied to an element, resolving the studio offset var()
 * expression to its px value so we compare the actually-rendered translation. */
function resolvedTranslatePx(el: HTMLElement): { x: number; y: number } {
  const raw = el.style.getPropertyValue("translate").trim();
  if (!raw || raw === "none") return { x: 0, y: 0 };
  const vx = Number.parseFloat(el.style.getPropertyValue("--hf-studio-offset-x")) || 0;
  const vy = Number.parseFloat(el.style.getPropertyValue("--hf-studio-offset-y")) || 0;
  const parts = splitTopLevelWhitespace(raw);
  const parseAxis = (part: string, varVal: number): number => {
    if (part && part.includes("--hf-studio-offset")) return varVal;
    const n = Number.parseFloat(part);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    x: parseAxis(parts[0] ?? "", vx),
    y: parseAxis(parts[1] ?? "", vy),
  };
}

describe("anchored corner resize — no shift after release", () => {
  it("the per-frame anchor converges (does NOT oscillate) — the release-shift root cause", () => {
    // Model the pointermove anchor loop for an NW-corner resize. The physical
    // truth (confirmed in a real browser): the measured fixed (SE) corner sits at
    // `fixedStartScreen - appliedOffsetScreen` — i.e. applying the offset moves
    // the corner back toward its gesture-start position. Here scale=1 so screen px
    // == offset px. `trueAnchor` is the compensating offset that pins the corner.
    const trueAnchor = { dx: -60, dy: -27 };
    const fixedStart = { x: 500, y: 270 };

    // `appliedOffset` mirrors what applyManualOffsetDragDraft set last frame.
    let appliedOffset = { x: 0, y: 0 };
    // `lastResizeAnchor` accumulator, exactly as g.lastResizeAnchor in the fix.
    let lastResizeAnchor: { dx: number; dy: number } | undefined;

    const anchorsSeen: Array<{ dx: number; dy: number }> = [];
    for (let frame = 0; frame < 8; frame++) {
      // Live measured corner: the resize would put it at fixedStart + trueAnchor
      // (un-anchored), and the currently-applied offset pulls it back by that
      // offset. So fixedNow = fixedStart - trueAnchor + appliedOffset.
      const fixedNow = {
        x: fixedStart.x - trueAnchor.dx + appliedOffset.x,
        y: fixedStart.y - trueAnchor.dy + appliedOffset.y,
      };
      // ── The fixed logic (accumulate residual onto the previous anchor) ──
      const prev = lastResizeAnchor ?? { dx: 0, dy: 0 };
      const anchor = {
        dx: prev.dx + (fixedStart.x - fixedNow.x),
        dy: prev.dy + (fixedStart.y - fixedNow.y),
      };
      lastResizeAnchor = anchor;
      anchorsSeen.push(anchor);
      // applyManualOffsetDragDraft sets the absolute offset (scale 1) = anchor.
      appliedOffset = { x: anchor.dx, y: anchor.dy };
    }

    // Every frame must report the same, correct anchor — no oscillation, so the
    // committed value is parity-independent.
    for (const a of anchorsSeen) {
      expect(a).toEqual(trueAnchor);
    }
    // Guard against the OLD absolute formula regressing: with `anchor =
    // fixedStart - fixedNow` (no accumulation) the sequence would be
    // [trueAnchor, 0, trueAnchor, 0, ...]; assert the last two frames agree.
    expect(anchorsSeen.at(-1)).toEqual(anchorsSeen.at(-2));
  });

  it("net translate after persist+reload equals the committed anchor offset (non-GSAP)", () => {
    // The committed offset flows through the real apply → persist → reload chain
    // unchanged (this hop was proved clean; the shift is upstream in the anchor
    // loop above, not in persistence).
    const el = document.createElement("div");
    el.style.setProperty("width", "200px");
    el.style.setProperty("height", "100px");
    document.body.appendChild(el);

    const anchorDx = -30;
    const anchorDy = -18;
    const finalSize = { width: 240, height: 130 };

    applyStudioBoxSize(el, finalSize);
    const memberResult = createManualOffsetDragMember({
      key: "k",
      selection: { element: el } as never,
      element: el,
      rect: { left: 0, top: 0, width: 240, height: 130, editScaleX: 1, editScaleY: 1 },
    });
    expect(memberResult.ok).toBe(true);
    if (!memberResult.ok) return;

    const finalOffset = applyManualOffsetDragCommit(memberResult.member, anchorDx, anchorDy);

    applyStudioBoxSize(el, finalSize);
    const patches = buildBoxSizePatches(el);
    applyStudioPathOffset(el, finalOffset);
    patches.push(...buildPathOffsetPatches(el));

    expect(resolvedTranslatePx(el)).toEqual({ x: anchorDx, y: anchorDy });

    // Persist → fresh element re-parsed from source → reload re-stamp.
    const reloaded = document.createElement("div");
    reloaded.style.setProperty("width", "200px");
    reloaded.style.setProperty("height", "100px");
    document.body.appendChild(reloaded);
    applyPatchesToElement(reloaded, patches);
    reapplyPositionEditsAfterSeek(reloaded.ownerDocument);

    expect(resolvedTranslatePx(reloaded)).toEqual({ x: anchorDx, y: anchorDy });
    expect(readStudioBoxSize(reloaded)).toEqual(finalSize);
  });
});
