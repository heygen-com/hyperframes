// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  studioAddAnimation,
  studioAddKeyframe,
  studioDeleteAnimation,
  studioUpdateAnimation,
  type AnimationToolDeps,
  type StudioAddAnimationResult,
  type StudioAddKeyframeResult,
  type StudioUpdateAnimationResult,
} from "./animationTools";
import { expectFailure, expectOk, previewElement, selectionFor } from "../webmcpTestUtils";

function animationDeps(overrides: Partial<AnimationToolDeps> = {}): AnimationToolDeps {
  const element = previewElement('<h1 id="headline">Ship it</h1>', "headline");
  return {
    getCurrentSelection: () => selectionFor(element),
    getWriteBlockedReason: () => null,
    readPlayhead: () => ({ currentTime: 2.4, duration: 10, isPlaying: false }),
    addAnimation: () => undefined,
    updateAnimation: async () => true,
    addKeyframe: async () => undefined,
    deleteAnimation: () => undefined,
    ...overrides,
  };
}

describe("studioAddAnimation", () => {
  it("reports where the playhead actually was, not a position the caller chose", async () => {
    // The handler reads the playhead itself and ignores any position argument,
    // so echoing one back would report a number that had no effect.
    const addAnimation = vi.fn();

    const result = await studioAddAnimation(
      animationDeps({
        addAnimation,
        readPlayhead: () => ({ currentTime: 7.25, duration: 10, isPlaying: false }),
      }),
      { method: "from" },
    );

    const ok = expectOk<StudioAddAnimationResult>(result);
    expect(ok.insertedAtSeconds).toBe(7.25);
    expect(ok.method).toBe("from");
    expect(addAnimation).toHaveBeenCalledWith("from");
  });

  it("marks the result as dispatched rather than claiming it landed", async () => {
    // `handleGsapAddAnimation` is fire-and-forget and returns nothing, so there
    // is no honest success signal to report.
    const result = await studioAddAnimation(animationDeps(), { method: "to" });

    expect(expectOk<StudioAddAnimationResult>(result).dispatched).toBe(true);
  });

  it("rejects an unknown method without dispatching", async () => {
    const addAnimation = vi.fn();

    const result = expectFailure(
      await studioAddAnimation(animationDeps({ addAnimation }), { method: "wiggle" }),
    );

    expect(result.kind).toBe("invalid");
    expect(addAnimation).not.toHaveBeenCalled();
  });

  it("refuses while a write is blocked, and when nothing is selected", async () => {
    const addAnimation = vi.fn();

    const paused = expectFailure(
      await studioAddAnimation(
        animationDeps({ getWriteBlockedReason: () => "Auto-save is paused", addAnimation }),
        { method: "to" },
      ),
    );
    const unselected = expectFailure(
      await studioAddAnimation(animationDeps({ getCurrentSelection: () => null, addAnimation }), {
        method: "to",
      }),
    );

    expect(paused.kind).toBe("blocked");
    expect(unselected.kind).toBe("invalid");
    expect(addAnimation).not.toHaveBeenCalled();
  });
});

describe("studioUpdateAnimation", () => {
  it("confirms the write, because this handler actually reports back", async () => {
    const updateAnimation = vi.fn(async () => true);

    const result = await studioUpdateAnimation(animationDeps({ updateAnimation }), {
      animationId: "anim-1",
      ease: "power2.out",
      duration: 1.5,
    });

    const ok = expectOk<StudioUpdateAnimationResult>(result);
    expect(ok.updated).toEqual({ duration: 1.5, ease: "power2.out" });
    expect(updateAnimation).toHaveBeenCalledWith("anim-1", {
      duration: 1.5,
      ease: "power2.out",
    });
  });

  it("reports a false return as a real failure", async () => {
    const result = expectFailure(
      await studioUpdateAnimation(animationDeps({ updateAnimation: async () => false }), {
        animationId: "anim-gone",
        ease: "none",
      }),
    );

    expect(result.kind).toBe("failed");
    expect(result.hint).toMatch(/stale/);
  });

  it("rules out the no-selection case BEFORE dispatch, so a false is unambiguous", async () => {
    // The handler answers `false` for both "nothing selected" and "the write
    // failed". Eliminating one beforehand is what makes the other legible.
    const updateAnimation = vi.fn(async () => false);

    const result = expectFailure(
      await studioUpdateAnimation(
        animationDeps({ getCurrentSelection: () => null, updateAnimation }),
        { animationId: "anim-1", ease: "none" },
      ),
    );

    expect(result.kind).toBe("invalid");
    expect(result.reason).toMatch(/nothing is selected/);
    expect(updateAnimation).not.toHaveBeenCalled();
  });

  it("requires at least one field, and rejects a negative duration", async () => {
    const deps = animationDeps();

    expect(expectFailure(await studioUpdateAnimation(deps, { animationId: "a" })).reason).toMatch(
      /at least one/,
    );
    expect(
      expectFailure(await studioUpdateAnimation(deps, { animationId: "a", duration: -1 })).reason,
    ).toMatch(/negative/);
  });

  it("rejects a blank animation id", async () => {
    const updateAnimation = vi.fn();

    const result = expectFailure(
      await studioUpdateAnimation(animationDeps({ updateAnimation }), {
        animationId: "   ",
        ease: "none",
      }),
    );

    expect(result.kind).toBe("invalid");
    expect(updateAnimation).not.toHaveBeenCalled();
  });
});

describe("studioAddKeyframe", () => {
  it("passes every property through in one commit", async () => {
    const addKeyframe = vi.fn(async () => undefined);

    const result = await studioAddKeyframe(animationDeps({ addKeyframe }), {
      animationId: "anim-1",
      percent: 50,
      properties: { y: -50, opacity: 0 },
    });

    const ok = expectOk<StudioAddKeyframeResult>(result);
    expect(ok.properties).toEqual({ y: -50, opacity: 0 });
    // One call, so one undo entry, rather than one per property.
    expect(addKeyframe).toHaveBeenCalledTimes(1);
    expect(addKeyframe).toHaveBeenCalledWith("anim-1", 50, { y: -50, opacity: 0 });
  });

  it("validates percent itself, because the platform does not", async () => {
    // Nothing checks the input object against inputSchema, so the tool receives
    // whatever the agent sent.
    const addKeyframe = vi.fn();
    const deps = animationDeps({ addKeyframe });

    for (const percent of [-1, 101, Number.NaN, "50"]) {
      const result = expectFailure(
        await studioAddKeyframe(deps, { animationId: "a", percent, properties: { y: 1 } }),
      );
      expect(result.kind).toBe("invalid");
    }
    expect(addKeyframe).not.toHaveBeenCalled();
  });

  it("rejects properties that carry no usable value", async () => {
    const addKeyframe = vi.fn();
    const deps = animationDeps({ addKeyframe });

    for (const properties of [{}, { y: null }, [], "y:1"]) {
      const result = expectFailure(
        await studioAddKeyframe(deps, { animationId: "a", percent: 50, properties }),
      );
      expect(result.kind).toBe("invalid");
    }
    expect(addKeyframe).not.toHaveBeenCalled();
  });

  it("accepts 0 and 100 as the ends of the tween", async () => {
    for (const percent of [0, 100]) {
      const result = await studioAddKeyframe(animationDeps(), {
        animationId: "a",
        percent,
        properties: { y: 1 },
      });
      expect(expectOk<StudioAddKeyframeResult>(result).percent).toBe(percent);
    }
  });
});

describe("studioDeleteAnimation", () => {
  it("dispatches the delete and says so", async () => {
    const deleteAnimation = vi.fn();

    const result = await studioDeleteAnimation(animationDeps({ deleteAnimation }), {
      animationId: "anim-1",
    });

    expect(result.ok).toBe(true);
    expect(deleteAnimation).toHaveBeenCalledWith("anim-1");
  });

  it("refuses while a write is blocked", async () => {
    const deleteAnimation = vi.fn();

    const result = expectFailure(
      await studioDeleteAnimation(
        animationDeps({ getWriteBlockedReason: () => "Auto-save is paused", deleteAnimation }),
        { animationId: "anim-1" },
      ),
    );

    expect(result.kind).toBe("blocked");
    expect(deleteAnimation).not.toHaveBeenCalled();
  });
});
