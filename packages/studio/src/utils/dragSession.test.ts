import { describe, expect, it } from "vitest";
import { beginDragSession, endDragSession, getActiveDragSession } from "./dragSession";

describe("dragSession", () => {
  it("stores and clears the active payload", () => {
    expect(getActiveDragSession()).toBeNull();
    beginDragSession({
      source: "asset",
      path: "assets/a.mp3",
      kind: "audio",
      durationSec: 12.4,
      label: "a.mp3",
    });
    expect(getActiveDragSession()?.kind).toBe("audio");
    endDragSession();
    expect(getActiveDragSession()).toBeNull();
  });

  it("a new begin replaces the previous session", () => {
    beginDragSession({
      source: "asset",
      path: "x.png",
      kind: "image",
      durationSec: null,
      label: "x",
    });
    beginDragSession({
      source: "block",
      blockName: "confetti",
      kind: "block",
      durationSec: 3,
      label: "Confetti",
    });
    expect(getActiveDragSession()?.source).toBe("block");
    endDragSession();
  });
});
