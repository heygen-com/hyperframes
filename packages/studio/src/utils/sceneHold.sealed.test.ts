// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

const { previewRequest } = vi.hoisted(() => ({ previewRequest: vi.fn() }));
vi.mock("../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../player/lib/previewChannel")>()),
  previewFrameOpaque: () => true,
  previewRequest,
}));

import type { TimelineElement } from "../player";
import { holdScenesOf } from "./sceneHold";

const iframe = document.createElement("iframe");

it("holds a sealed preview's scenes of an element through the frame, and waits until they are mounted", async () => {
  let answer: (value: unknown) => void = () => {};
  previewRequest.mockReturnValue(new Promise((resolve) => (answer = resolve)));
  const element = {
    compositionAncestors: ["film"],
    parentCompositionId: "intro",
  } as TimelineElement;

  let mounted = false;
  const held = holdScenesOf(iframe, element)?.then(() => (mounted = true));
  await Promise.resolve();

  expect(previewRequest).toHaveBeenCalledExactlyOnceWith(iframe, "hold-scenes", {
    names: ["film", "intro"],
  });
  expect(mounted).toBe(false);
  answer({ held: true });
  await held;
  expect(mounted).toBe(true);
});

it("releases a sealed preview's held scenes when nothing is selected", () => {
  previewRequest.mockReset();
  previewRequest.mockResolvedValue({ held: true });
  void holdScenesOf(iframe, null);
  expect(previewRequest).toHaveBeenCalledExactlyOnceWith(iframe, "hold-scenes", { names: [] });
});
