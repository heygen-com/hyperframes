// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { buildMissingCompositionElements } from "./timelineIframeHelpers";
import type { IframeWindow } from "./playbackTypes";
import type { TimelineElement } from "../store/playerStore";

function makeDoc(html: string): Document {
  const d = document.implementation.createHTMLDocument();
  d.body.innerHTML = html;
  return d;
}

describe("buildMissingCompositionElements — hfId (R7)", () => {
  it("harvests hfId from data-hf-id on composition host elements", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div
          data-composition-id="scene-a"
          data-composition-src="scenes/a.html"
          data-hf-id="hf-scene1"
          data-start="0"
          data-duration="5"
        ></div>
      </div>
    `);

    const { missing } = buildMissingCompositionElements(doc, window as IframeWindow, [], 10);
    const entry = missing[0];

    expect(entry).toBeDefined();
    expect(entry?.hfId).toBe("hf-scene1");
  });

  it("leaves hfId undefined when element has no data-hf-id", () => {
    const doc = makeDoc(`
      <div data-composition-id="root">
        <div
          data-composition-id="scene-b"
          data-composition-src="scenes/b.html"
          data-start="0"
          data-duration="5"
        ></div>
      </div>
    `);

    const { missing } = buildMissingCompositionElements(doc, window as IframeWindow, [], 10);
    const entry = missing[0];

    expect(entry).toBeDefined();
    expect(entry?.hfId).toBeUndefined();
  });
});

/**
 * A project the way the generator writes one: every clip identified by
 * `data-hf-id`, a minority also carrying an author `id`. `stableClipId` — what
 * the manifest puts in `TimelineElement.id` — prefers `id` and falls back to
 * `data-hf-id`, so a lookup that only asks `getElementById` misses most clips.
 */
function makeProject(clipCount: number): { doc: Document; els: TimelineElement[] } {
  const markup: string[] = [];
  const els: TimelineElement[] = [];
  for (let index = 0; index < clipCount; index += 1) {
    const hfId = `hf-${index}`;
    const authorId = index % 5 === 0 ? `clip-${index}` : "";
    // Every third clip is a composition host, so parity has something to patch.
    const isHost = index % 3 === 0;
    markup.push(
      `<div ${authorId ? `id="${authorId}"` : ""} data-hf-id="${hfId}"` +
        (isHost
          ? ` data-composition-id="comp-${index}" data-composition-src="scenes/${index}.html"`
          : "") +
        ` data-start="${index}" data-duration="1"></div>`,
    );
    els.push({
      id: authorId || hfId,
      hfId,
      tag: "div",
      start: index,
      duration: 1,
      track: 0,
      ...(authorId ? { domId: authorId } : {}),
    });
  }
  return { doc: makeDoc(`<div data-composition-id="root">${markup.join("")}</div>`), els };
}

describe("buildMissingCompositionElements — identity parity", () => {
  it("patches compositionSrc onto hf-id-identified clips, which getElementById never saw", () => {
    const { doc, els } = makeProject(9);

    const { updatedEls, patched } = buildMissingCompositionElements(
      doc,
      window as IframeWindow,
      els,
      100,
    );

    expect(patched).toBe(true);
    // Clips 0, 3, 6 are hosts; only clip 0 carries an author id, so 3 and 6 are
    // exactly the ones the old getElementById-only lookup could not resolve.
    expect(updatedEls.map((el) => el.compositionSrc ?? null)).toEqual([
      "scenes/0.html",
      null,
      null,
      "scenes/3.html",
      null,
      null,
      "scenes/6.html",
      null,
      null,
    ]);
  });

  it("changes nothing about identity — only compositionSrc differs from the input", () => {
    const { doc, els } = makeProject(30);

    const { updatedEls } = buildMissingCompositionElements(doc, window as IframeWindow, els, 100);

    expect(updatedEls).toHaveLength(els.length);
    for (const [index, updated] of updatedEls.entries()) {
      const { compositionSrc: _dropped, ...rest } = updated;
      expect(rest).toEqual(els[index]);
    }
  });

  it("resolves every clip through a fixed number of whole-document queries", () => {
    const countQueries = (clipCount: number): number => {
      const { doc, els } = makeProject(clipCount);
      const spies = [
        vi.spyOn(doc, "querySelector"),
        vi.spyOn(doc, "querySelectorAll"),
        vi.spyOn(doc, "getElementById"),
      ];
      buildMissingCompositionElements(doc, window as IframeWindow, els, 100);
      const calls = spies.reduce((total, spy) => total + spy.mock.calls.length, 0);
      for (const spy of spies) spy.mockRestore();
      return calls;
    };

    // Twentyfold the clips, same query count: the cost is the document walk, not
    // a query per clip. Before the fix this grew by one querySelector per clip.
    expect(countQueries(200)).toBe(countQueries(10));
  });
});
