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
 * Center-anchored corner resize (CapCut model): the element scales about its
 * CENTER, which must stay planted across the whole gesture — including after
 * release, on every corner and at any rotation.
 *
 * This file lands here with ONLY the persist round-trip test, which exercises the
 * real apply → persist → reload symbols that already exist at this point in the
 * stack. The two center-anchor CONVERGENCE tests (the release-shift root cause)
 * drive the exported `computeNextResizeAnchor` accumulator, which is extracted from
 * the resize pointermove branch of `useDomEditOverlayGestures.ts`. That gesture code
 * lands later in the stack (with the canvas glue swap), so those two tests are added
 * to this file at that point — importing the real production helper rather than a
 * test-local copy, so they can never pass against a stand-in that drifts from the
 * shipped math.
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
  it("net translate after persist+reload equals the committed anchor offset (non-GSAP)", () => {
    // The committed offset flows through the real apply → persist → reload chain
    // unchanged (this hop was proved clean; the shift is upstream in the anchor
    // loop, tested with the gesture code, not in persistence).
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
