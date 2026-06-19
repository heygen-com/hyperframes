import { afterEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { tryGsapDragIntercept } from "./gsapRuntimeBridge";

/**
 * Regression: `selectedGsapAnimations` (and the fetch fallback) is an async
 * server-parse that LAGS a delete-all. A drag in that window would resolve a
 * phantom position tween from the stale cache and re-commit it — resurrecting the
 * just-deleted animation. tryGsapDragIntercept must trust the LIVE runtime: when
 * the runtime has no keyframed/tweened position motion, the element is STATIC
 * (single-source model), so the drag commits a position-hold `tl.set("#el",{x,y})`
 * rather than re-committing the phantom tween. The stale `to` parse is ignored.
 */

// A preview iframe whose runtime timeline holds `children`, resolves the element,
// and exposes a gsap stub — so the drag can reach the commit path (the guard, not
// a missing gsap, must be what stops it).
function fakeIframe(elId: string, children: unknown[]): HTMLIFrameElement {
  const timeline = { getChildren: () => children, duration: () => 14.6 };
  const el = { id: elId };
  return {
    contentWindow: {
      __timelines: { "index.html": timeline },
      gsap: { getProperty: () => 0 },
    },
    contentDocument: { querySelector: (sel: string) => (sel === `#${elId}` ? el : null) },
  } as unknown as HTMLIFrameElement;
}

// A selection whose element answers the reads commitGsapPositionFromDrag makes —
// so without the guard the drag would reach commitMutation (resurrecting the tween).
const fakeElement = {
  id: "puck-b",
  style: { getPropertyValue: () => "" },
  getAttribute: () => null,
  getBoundingClientRect: () => ({ top: 100, left: 100, width: 50, height: 50 }),
} as unknown as HTMLElement;

const selection = {
  id: "puck-b",
  selector: "#puck-b",
  element: fakeElement,
} as unknown as DomEditSelection;

// A stale parse-cache entry: a position tween the server still reports post-delete.
const stalePositionAnim = {
  id: "#puck-b-to-1000-position",
  targetSelector: "#puck-b",
  propertyGroup: "position",
  method: "to",
  properties: { x: -180, y: -60 },
  position: 1,
  resolvedStart: 1,
  duration: 2,
} as unknown as GsapAnimation;

afterEach(() => vi.restoreAllMocks());

describe("tryGsapDragIntercept — stale-parse guard (no resurrection after delete-all)", () => {
  it("commits a static set (not the stale tween) when the runtime has no live position motion", async () => {
    const commitMutation = vi.fn();
    // Runtime empty (tween deleted) — readRuntimeKeyframes returns null, so the
    // element is treated as STATIC. The stale `to` parse must NOT be re-committed.
    const iframe = fakeIframe("puck-b", []);

    const handled = await tryGsapDragIntercept(
      selection,
      { x: -50, y: 30 },
      [stalePositionAnim],
      iframe,
      commitMutation,
    );

    expect(handled).toBe(true);
    // No existing `set` for the selector → one `add` mutation with `method:"set"`.
    expect(commitMutation).toHaveBeenCalledTimes(1);
    const [, mutation] = commitMutation.mock.calls[0];
    expect(mutation).toMatchObject({
      type: "add",
      method: "set",
      targetSelector: "#puck-b",
      position: 0,
    });
    // Drag delta (-50, 30) off a zero base → the committed set holds that position.
    expect(mutation.properties).toEqual({ x: -50, y: 30 });
    // It must NOT resurrect the stale tween via a tween/keyframe mutation.
    expect(mutation.type).not.toBe("update-property");
    expect(mutation.type).not.toBe("add-keyframe");
  });

  it("does not trip the stale-parse guard when the runtime still has the tween", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const liveTween = {
      targets: () => [{ id: "puck-b" }],
      vars: { x: -120, y: 40, duration: 1 },
      duration: () => 1,
      startTime: () => 1,
    };
    // No fake gsap → it returns false later (at the gsapPos read), but the point
    // is the stale-parse guard must NOT be the reason.
    const iframe = fakeIframe("puck-b", [liveTween]);

    await tryGsapDragIntercept(selection, { x: -50, y: 30 }, [stalePositionAnim], iframe, vi.fn());

    const staleLogged = logSpy.mock.calls.some((c) => String(c[1] ?? "").includes("stale parse"));
    expect(staleLogged).toBe(false);
  });
});
