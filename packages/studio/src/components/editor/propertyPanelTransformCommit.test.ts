// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditingTypes";
import { GsapEditBlockedError } from "../../hooks/gsapEditOutcome";
import { createTransformCommitHandlers } from "./propertyPanelTransformCommit";

describe("createTransformCommitHandlers", () => {
  it.each([
    [
      "position",
      (handlers: ReturnType<typeof createTransformCommitHandlers>) =>
        handlers.commitManualOffset("x", "20px"),
    ],
    [
      "size",
      (handlers: ReturnType<typeof createTransformCommitHandlers>) =>
        handlers.commitManualSize("width", "200px"),
    ],
    [
      "rotation",
      (handlers: ReturnType<typeof createTransformCommitHandlers>) =>
        handlers.commitManualRotation("45"),
    ],
  ])("propagates blocked %s edits so the field can roll back", async (_name, commit) => {
    const blocked = new GsapEditBlockedError("unroll-required");
    const onCommitAnimatedProperty = vi.fn().mockRejectedValue(blocked);
    const onSetManualOffset = vi.fn();
    const onSetManualSize = vi.fn();
    const onSetManualRotation = vi.fn();
    const element = {
      id: "box",
      selector: "#box",
      element: document.createElement("div"),
      boundingBox: { width: 100, height: 100 },
    } as unknown as DomEditSelection;
    const handlers = createTransformCommitHandlers({
      element,
      styles: {},
      hasGsapAnimation: true,
      gsapAnimId: "#box-to-position",
      gsapKeyframes: null,
      currentPct: 0,
      onCommitAnimatedProperty,
      onAddKeyframe: undefined,
      onSetManualOffset,
      onSetManualSize,
      onSetManualRotation,
      showToast: vi.fn(),
    });

    await expect(commit(handlers)).rejects.toBe(blocked);
    expect(onSetManualOffset).not.toHaveBeenCalled();
    expect(onSetManualSize).not.toHaveBeenCalled();
    expect(onSetManualRotation).not.toHaveBeenCalled();
  });
});
