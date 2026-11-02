import { afterEach, describe, expect, it } from "vitest";
import type { Page } from "puppeteer-core";
import { releaseEndedWebglContexts } from "./webglRelease.js";

type Node = {
  getAttribute: (n: string) => string | null;
  hasAttribute: (n: string) => boolean;
  parentElement: Node | null;
};

function clip(attrs: Record<string, string>, parent: Node | null = null): Node {
  return {
    getAttribute: (n) => attrs[n] ?? null,
    hasAttribute: (n) => n in attrs,
    parentElement: parent,
  };
}

function canvasIn(host: Node | null, lost: string[], name: string) {
  const ctx = { getExtension: () => ({ loseContext: () => lost.push(name) }) };
  return { canvas: clip({}, host), ctx };
}

function pageWith(records: unknown[]): Page {
  return {
    evaluate: async (fn: (t: number) => unknown, t: number) => {
      const previous = globalThis.window;
      Object.assign(globalThis, { window: { __hf_gl_contexts: records } });
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

const root = clip({ "data-start": "0", "data-duration": "30" });

describe("releaseEndedWebglContexts", () => {
  it("releases a scene's context when the runtime has hidden its slot after the slot's end", async () => {
    const lost: string[] = [];
    const glassSlot = clip(
      { "data-start": "0", "data-hf-authored-duration": "3", "data-hf-clip-hidden": "" },
      root,
    );
    const glassScene = clip(
      { "data-start": "0", "data-hf-authored-duration": "12.16", "data-hf-clip-hidden": "" },
      glassSlot,
    );
    const turnSlot = clip(
      { "data-start": "15", "data-hf-authored-duration": "3", "data-hf-clip-hidden": "" },
      root,
    );
    const page = pageWith([
      canvasIn(glassScene, lost, "glass"),
      canvasIn(turnSlot, lost, "turntable"),
    ]);

    expect(await releaseEndedWebglContexts(page, 2.9)).toBe(0);
    expect(await releaseEndedWebglContexts(page, 3)).toBe(1);
    expect(lost).toEqual(["glass"]);
    expect(await releaseEndedWebglContexts(page, 15)).toBe(0);
  });

  it("keeps the context of a slot that is hidden before it starts or visible while it runs", async () => {
    const lost: string[] = [];
    const notYet = clip(
      { "data-start": "15", "data-duration": "3", "data-hf-clip-hidden": "" },
      root,
    );
    const running = clip({ "data-start": "0", "data-duration": "3" }, root);
    const page = pageWith([canvasIn(notYet, lost, "later"), canvasIn(running, lost, "now")]);

    expect(await releaseEndedWebglContexts(page, 5)).toBe(0);
    expect(lost).toEqual([]);
  });

  it("leaves a canvas outside any clip alone", async () => {
    const lost: string[] = [];

    expect(await releaseEndedWebglContexts(pageWith([canvasIn(null, lost, "x")]), 99)).toBe(0);
    expect(lost).toEqual([]);
  });
});
