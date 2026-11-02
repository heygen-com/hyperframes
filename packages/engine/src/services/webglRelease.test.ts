import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "puppeteer-core";
import { releaseEndedWebglContexts } from "./webglRelease.js";

type Node = {
  hasAttribute: (n: string) => boolean;
  parentElement: Node | null;
  span?: { start: number; end: number };
};

function clip(
  span: { start: number; end: number } | undefined,
  hidden: boolean,
  parent: Node | null = null,
): Node {
  return {
    hasAttribute: (n) => hidden && n === "data-hf-clip-hidden",
    parentElement: parent,
    span,
  };
}

function canvasIn(host: Node | null, lost: string[], name: string) {
  const ctx = { getExtension: () => ({ loseContext: () => lost.push(name) }) };
  return { canvas: clip(undefined, false, host), ctx };
}

// The page runtime answers with the window it resolved, however the clip's data-start was written.
function pageWith(records: unknown[], answers = true): Page {
  return {
    evaluate: async (fn: (t: number) => unknown, t: number) => {
      const previous = globalThis.window;
      const clipWindow = (el: Node) => el.span ?? null;
      Object.assign(globalThis, {
        window: { __hf_gl_contexts: records, __hf: answers ? { clipWindow } : {} },
      });
      try {
        return await fn(t);
      } finally {
        Object.assign(globalThis, { window: previous });
      }
    },
  } as unknown as Page;
}

afterEach(() => {
  Object.assign(globalThis, { window: undefined });
});

describe("releaseEndedWebglContexts", () => {
  it("releases a scene's context once the runtime's window for its hidden slot has ended", async () => {
    const lost: string[] = [];
    const glassSlot = clip({ start: 0, end: 3 }, true);
    const glassScene = clip({ start: 0, end: 12.16 }, true, glassSlot);
    const turnSlot = clip({ start: 15, end: 18 }, true);
    const page = pageWith([
      canvasIn(glassScene, lost, "glass"),
      canvasIn(turnSlot, lost, "turntable"),
    ]);

    expect(await releaseEndedWebglContexts(page, 2.9)).toBe(0);
    expect(await releaseEndedWebglContexts(page, 3)).toBe(1);
    expect(lost).toEqual(["glass"]);
    expect(await releaseEndedWebglContexts(page, 15)).toBe(0);
  });

  it("keeps the context of a scene whose start is a reference, until its resolved end has passed", async () => {
    const lost: string[] = [];
    // data-start="intro": the attribute reads as no number, the runtime resolves it to the end of the intro.
    const afterIntro = clip({ start: 15, end: 18 }, true);
    const page = pageWith([canvasIn(afterIntro, lost, "3d")]);

    expect(await releaseEndedWebglContexts(page, 5)).toBe(0);
    expect(await releaseEndedWebglContexts(page, 16)).toBe(0);
    expect(await releaseEndedWebglContexts(page, 18)).toBe(1);
    expect(lost).toEqual(["3d"]);
  });

  it("releases nothing when the runtime does not report windows, or the canvas is in no hidden clip", async () => {
    const lost: string[] = [];
    const ended = clip({ start: 0, end: 3 }, true);
    const visible = clip({ start: 0, end: 3 }, false);

    expect(await releaseEndedWebglContexts(pageWith([canvasIn(ended, lost, "a")], false), 99)).toBe(
      0,
    );
    expect(
      await releaseEndedWebglContexts(
        pageWith([canvasIn(visible, lost, "b"), canvasIn(null, lost, "c")]),
        99,
      ),
    ).toBe(0);
    expect(lost).toEqual([]);
  });
});
