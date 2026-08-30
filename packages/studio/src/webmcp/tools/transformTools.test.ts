// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  studioTransform,
  type ElementBox,
  type StudioTransformResult,
  type TransformToolDeps,
} from "./transformTools";
import { expectFailure, expectOk, previewElement, selectionFor } from "../webmcpTestUtils";

/**
 * A stand-in for the rendered box. happy-dom and jsdom report all-zero rects,
 * so the box is injected rather than measured; these tests are about what the
 * tool concludes from a box, not about layout.
 */
function boxStore(initial: ElementBox) {
  const box = { ...initial };
  return {
    read: () => ({ ...box }),
    set: (next: Partial<ElementBox>) => Object.assign(box, next),
  };
}

function transformDeps(overrides: Partial<TransformToolDeps> = {}): TransformToolDeps {
  const element = previewElement('<h1 id="headline">Ship it</h1>', "headline");
  return {
    getCurrentSelection: () => selectionFor(element),
    getWriteBlockedReason: () => null,
    readBox: () => ({ x: 0, y: 0, width: 100, height: 50 }),
    moveTo: async () => undefined,
    resizeTo: async () => undefined,
    rotateTo: async () => undefined,
    ...overrides,
  };
}

describe("studioTransform", () => {
  it("reports the box read back, not the box requested", async () => {
    const store = boxStore({ x: 0, y: 0, width: 100, height: 50 });
    // The handler lands somewhere other than asked, which is what a clamp or a
    // layout constraint does.
    const resizeTo = vi.fn(async () => store.set({ width: 300, height: 120 }));

    const result = await studioTransform(transformDeps({ readBox: store.read, resizeTo }), {
      width: 999,
      height: 999,
    });

    const ok = expectOk<StudioTransformResult>(result);
    expect(ok.box.width).toBe(300);
    expect(ok.box.height).toBe(120);
    expect(ok.applied).toContain("resize");
  });

  it("reports a silent no-op as unchanged instead of success", async () => {
    // handleGsapAwarePathOffsetCommit is `if (gsapCommitMutation) {...}` with no
    // else branch. Without GSAP it resolves having written nothing, and echoing
    // the request back would be a lie the agent builds on.
    const store = boxStore({ x: 10, y: 10, width: 100, height: 50 });
    const moveTo = vi.fn(async () => undefined);

    const result = expectFailure(
      await studioTransform(transformDeps({ readBox: store.read, moveTo }), { x: 500, y: 400 }),
    );

    expect(moveTo).toHaveBeenCalled();
    expect(result.kind).toBe("blocked");
    expect(result.reason).toMatch(/did not move/);
    expect(result.hint).toMatch(/GSAP/);
  });

  it("separates what landed from what did not, in one call", async () => {
    const store = boxStore({ x: 0, y: 0, width: 100, height: 50 });
    const resizeTo = vi.fn(async () => store.set({ width: 200, height: 80 }));
    const moveTo = vi.fn(async () => undefined);

    const result = await studioTransform(transformDeps({ readBox: store.read, resizeTo, moveTo }), {
      x: 40,
      y: 40,
      width: 200,
      height: 80,
    });

    const ok = expectOk<StudioTransformResult>(result);
    expect(ok.applied).toEqual(["resize"]);
    expect(ok.unchanged.move).toMatch(/did not move/);
  });

  it("re-reads between operations so a later one sees the earlier result", async () => {
    const store = boxStore({ x: 0, y: 0, width: 100, height: 50 });
    const resizeTo = vi.fn(async () => store.set({ width: 200, height: 80 }));
    const moveTo = vi.fn(async () => store.set({ x: 40, y: 40 }));

    const result = await studioTransform(transformDeps({ readBox: store.read, resizeTo, moveTo }), {
      x: 40,
      y: 40,
      width: 200,
      height: 80,
    });

    // Move is judged against the box AFTER the resize. Comparing against the
    // original would credit the resize's change to the move.
    const ok = expectOk<StudioTransformResult>(result);
    expect(ok.applied).toEqual(["resize", "move"]);
    expect(ok.unchanged).toEqual({});
  });

  it("reports rotation as dispatched rather than verified", async () => {
    // `rotate` is an individual transform property and does not appear in the
    // computed transform, so there is no honest box-derived signal for it.
    const rotateTo = vi.fn(async () => undefined);

    const result = await studioTransform(transformDeps({ rotateTo }), { rotate: 15 });

    const ok = expectOk<StudioTransformResult>(result);
    expect(rotateTo).toHaveBeenCalledWith(expect.anything(), { angle: 15 });
    expect(ok.applied).toEqual(["rotate"]);
  });

  it("refuses to write while a conflict is waiting for the user", async () => {
    const moveTo = vi.fn();

    const result = expectFailure(
      await studioTransform(
        transformDeps({ getWriteBlockedReason: () => "Auto-save is paused", moveTo }),
        { x: 10, y: 10 },
      ),
    );

    expect(result.kind).toBe("blocked");
    expect(moveTo).not.toHaveBeenCalled();
  });

  it("requires x and y together, and width and height together", async () => {
    const moveTo = vi.fn();
    const resizeTo = vi.fn();
    const deps = transformDeps({ moveTo, resizeTo });

    expect(expectFailure(await studioTransform(deps, { x: 10 })).reason).toMatch(/together/);
    expect(expectFailure(await studioTransform(deps, { width: 10 })).reason).toMatch(/together/);
    expect(moveTo).not.toHaveBeenCalled();
    expect(resizeTo).not.toHaveBeenCalled();
  });

  it("rejects a negative size and an empty request", async () => {
    const deps = transformDeps();

    expect(expectFailure(await studioTransform(deps, { width: -1, height: 10 })).kind).toBe(
      "invalid",
    );
    expect(expectFailure(await studioTransform(deps, {})).reason).toMatch(/at least one/);
  });

  it("rejects non-finite numbers rather than passing them to a handler", async () => {
    const moveTo = vi.fn();

    const result = expectFailure(
      await studioTransform(transformDeps({ moveTo }), { x: Number.NaN, y: 10 }),
    );

    expect(result.kind).toBe("invalid");
    expect(moveTo).not.toHaveBeenCalled();
  });

  it("fails when nothing is selected", async () => {
    const moveTo = vi.fn();

    const result = expectFailure(
      await studioTransform(transformDeps({ getCurrentSelection: () => null, moveTo }), {
        x: 1,
        y: 1,
      }),
    );

    expect(result.kind).toBe("invalid");
    expect(result.hint).toMatch(/studio_select/);
    expect(moveTo).not.toHaveBeenCalled();
  });
});
