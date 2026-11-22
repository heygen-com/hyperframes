// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { pasteTimelineClips } from "./useClipboard";

const checked = vi.hoisted(() => [] as string[]);
vi.mock("@hyperframes/core/html-attr-safety", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/core/html-attr-safety")>();
  return {
    ...actual,
    markupOutsideAllowlist: (root: Element) => {
      checked.push(root.outerHTML);
      return actual.markupOutsideAllowlist(root);
    },
  };
});

const ROOT = '<div data-composition-id="main" data-start="0" data-duration="10"></div>';

describe("pasteTimelineClips code check", () => {
  it("checks the clip markup after its root tag takes the new start and track", () => {
    const copied = {
      html: '<audio id="sfx" src="a.mp3" data-start="7.8" data-duration="1" data-track-index="9"></audio>',
      start: 7.8,
      duration: 1,
      track: 9,
    };
    pasteTimelineClips(ROOT, [copied], 40, [
      { id: "x", tag: "p", start: 40, duration: 1, track: 9 },
    ]);
    expect(checked.some((markup) => /data-start="40"[^>]*data-track-index="10"/.test(markup))).toBe(
      true,
    );
  });
});
