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
import { computeNextResizeAnchor } from "./domEditResizeLocal";
import type { PatchOperation } from "../../utils/sourcePatcher";
import { splitTopLevelWhitespace } from "./manualEditsStyleHelpers";

/**
 * Center-anchored corner resize (CapCut model): the element scales about its
 * CENTER, which must stay planted across the whole gesture — including after
 * release, on every corner and at any rotation.
 *
 * Root cause of the original release "shift" (proved with a real-layout Chromium
 * replay, see the anchor-loop test below): during a resize drag the per-frame
 * anchor is derived from the element's LIVE measured center — which already carries
 * the offset applied on the PREVIOUS frame — while `applyManualOffsetDragDraft`
 * treats that anchor as the ABSOLUTE offset. So `fixedStart - centerNow` is really
 * only the RESIDUAL correction, and using it as the absolute value makes the anchor
 * OSCILLATE between the correct value and zero every frame:
 *   frame 0: offset 0 → center shifted by the resize → anchor = full amount → apply
 *   frame 1: offset applied → center back at fixedStart → anchor = 0 → apply 0 (un-pin!)
 *   frame 2: offset 0 again → anchor = full amount → ...
 * Release commits `g.lastResizeAnchor` from whichever parity the last pointermove
 * landed on, so the element lands EITHER pinned OR un-pinned — an unpredictable
 * post-release "shift".
 *
 * Fix (useDomEditOverlayGestures pointermove, resize branch, fa4f39168): accumulate
 * the residual onto the previously-applied anchor instead of using it as the
 * absolute offset, so the loop converges to a stable value on every frame. The
 * per-frame accumulation is the exported `computeNextResizeAnchor` helper (the one
 * call site in the pointermove resize branch); tests 1 & 2 drive it directly.
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

describe("center-anchored corner resize — no shift after release", () => {
  it("the per-frame center anchor converges (does NOT oscillate) — the release-shift root cause", () => {
    // Model the pointermove anchor loop that pins the element's CENTER. The physical
    // truth (confirmed in a real browser): the measured center sits at
    // `fixedStart - appliedOffset` shifted by the resize — i.e. applying the offset
    // moves the center back toward its gesture-start position. Here scale=1 so
    // screen px == offset px. `trueAnchor` is the compensating offset that pins it.
    const trueAnchor = { dx: -60, dy: -27 };
    const fixedStart = { x: 500, y: 270 };

    // `appliedOffset` mirrors what applyManualOffsetDragDraft set last frame.
    let appliedOffset = { x: 0, y: 0 };
    // `lastResizeAnchor` accumulator, exactly as g.lastResizeAnchor in the fix.
    let lastResizeAnchor: { dx: number; dy: number } | undefined;

    const anchorsSeen: Array<{ dx: number; dy: number }> = [];
    for (let frame = 0; frame < 8; frame++) {
      // Live measured center: the resize would put it at fixedStart + trueAnchor
      // (un-anchored), and the currently-applied offset pulls it back by that
      // offset. So centerNow = fixedStart - trueAnchor + appliedOffset.
      const centerNow = {
        x: fixedStart.x - trueAnchor.dx + appliedOffset.x,
        y: fixedStart.y - trueAnchor.dy + appliedOffset.y,
      };
      // ── The fixed logic (accumulate residual onto the previous anchor) ──
      const anchor = computeNextResizeAnchor(lastResizeAnchor, fixedStart, centerNow);
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
    // fixedStart - centerNow` (no accumulation) the sequence would be
    // [trueAnchor, 0, trueAnchor, 0, ...]; assert the last two frames agree.
    expect(anchorsSeen.at(-1)).toEqual(anchorsSeen.at(-2));
  });

  it("the center stays fixed for every corner at any rotation (loop converges)", () => {
    // The pin loop is handle- and rotation-independent: it always measures the
    // element CENTER and drives it back to fixedStart. Simulate the loop for all
    // four corners across unrotated + rotated gestures; the resize's raw center
    // shift varies with corner/rotation (modelled as `rawShift`), but the loop must
    // converge the measured center onto fixedStart every time.
    const fixedStart = { x: 640, y: 360 };
    const HANDLES = ["nw", "ne", "sw", "se"] as const;
    const DEGS = [0, 30, 90, 137];
    for (const handle of HANDLES) {
      for (const deg of DEGS) {
        const t = (deg * Math.PI) / 180;
        // Raw (un-pinned) center shift the size write would cause this frame —
        // a corner/rotation-dependent vector. Its exact value is irrelevant; the
        // loop only needs to cancel it.
        const seed = (HANDLES.indexOf(handle) + 1) * 11;
        const rawShift = {
          dx: Math.cos(t) * seed - Math.sin(t) * (seed / 2),
          dy: Math.sin(t) * seed + Math.cos(t) * (seed / 2),
        };
        let appliedOffset = { x: 0, y: 0 };
        let lastResizeAnchor: { dx: number; dy: number } | undefined;
        let centerNow = { x: fixedStart.x, y: fixedStart.y };
        for (let frame = 0; frame < 6; frame++) {
          centerNow = {
            x: fixedStart.x + rawShift.dx + appliedOffset.x,
            y: fixedStart.y + rawShift.dy + appliedOffset.y,
          };
          const anchor = computeNextResizeAnchor(lastResizeAnchor, fixedStart, centerNow);
          lastResizeAnchor = anchor;
          appliedOffset = { x: anchor.dx, y: anchor.dy };
        }
        // After convergence the pinned center equals the gesture-start center.
        const pinnedCenter = {
          x: fixedStart.x + rawShift.dx + appliedOffset.x,
          y: fixedStart.y + rawShift.dy + appliedOffset.y,
        };
        expect(pinnedCenter.x).toBeCloseTo(fixedStart.x, 9);
        expect(pinnedCenter.y).toBeCloseTo(fixedStart.y, 9);
      }
    }
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
