import { afterEach, describe, expect, it, vi } from "vitest";
import { applySafeFrameView, readSafeFramesFromDocument } from "./safe-frame.js";

const VERTICAL = {
  id: "vertical",
  ratio: "9:16" as const,
  x: (1920 - 608) / 2 / 1920,
  y: 0,
  width: 608 / 1920,
  height: 1,
};

describe("applySafeFrameView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clips the iframe to the named safe frame", () => {
    const player = document.createElement("div");
    Object.defineProperty(player, "offsetWidth", { value: 608 });
    Object.defineProperty(player, "offsetHeight", { value: 1080 });
    const iframe = document.createElement("iframe");
    const applied = applySafeFrameView({
      playerElement: player,
      iframe,
      compositionWidth: 1920,
      compositionHeight: 1080,
      frames: [VERTICAL],
      frameId: "vertical",
    });
    expect(applied).toBe(true);
    expect(iframe.style.clipPath).toContain("inset(");
    expect(iframe.style.clipPath).toMatch(/656px/);
  });

  it("leaves the full frame and warns on an unknown id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const player = document.createElement("div");
    Object.defineProperty(player, "offsetWidth", { value: 1920 });
    Object.defineProperty(player, "offsetHeight", { value: 1080 });
    const iframe = document.createElement("iframe");
    const applied = applySafeFrameView({
      playerElement: player,
      iframe,
      compositionWidth: 1920,
      compositionHeight: 1080,
      frames: [VERTICAL],
      frameId: "story",
    });
    expect(applied).toBe(false);
    expect(iframe.style.clipPath).toBe("");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unknown safe-frame "story"/));
  });
});

describe("readSafeFramesFromDocument", () => {
  it("parses data-safe-frames from the composition root", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "launch");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    root.setAttribute("data-safe-frames", JSON.stringify([VERTICAL]));
    document.body.append(root);
    expect(readSafeFramesFromDocument(document).map((frame) => frame.id)).toEqual(["vertical"]);
    root.remove();
  });
});
