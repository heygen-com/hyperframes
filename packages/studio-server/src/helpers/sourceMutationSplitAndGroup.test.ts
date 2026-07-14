import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import {
  splitElementInHtml,
  unwrapElementsFromHtml,
  wrapElementsInHtml,
} from "./sourceMutation.js";

describe("splitElementInHtml — hfId clone isolation", () => {
  it("does not copy data-hf-id to the cloned second half", () => {
    const source = `<html><body><div data-composition-id="root"><div id="clip1" class="clip" data-start="0" data-duration="10" data-hf-id="hf-abc123"></div></div></body></html>`;
    const { html, matched } = splitElementInHtml(source, { id: "clip1" }, 5, "clip2");

    expect(matched).toBe(true);
    const { document } = parseHTML(html);
    const occurrences = (html.match(/data-hf-id="hf-abc123"/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(document.getElementById("clip2")?.getAttribute("data-hf-id")).toMatch(/^hf-/);
    expect(document.getElementById("clip2")?.getAttribute("data-hf-id")).not.toBe("hf-abc123");
  });
});

describe("splitElementInHtml", () => {
  const source = `<!DOCTYPE html><html><head><style>#box { position: absolute; top: 100px; background: red; }</style></head><body><div data-composition-id="root"><div id="box" class="clip" data-start="1" data-duration="6">Hello</div></div></body></html>`;

  it("splits element at the given time", () => {
    const result = splitElementInHtml(source, { id: "box" }, 3, "box-split");
    expect(result.matched).toBe(true);
    expect(result.html).toContain('data-duration="2"');
    expect(result.html).toContain('id="box-split"');
    expect(result.html).toContain('data-start="3"');
    expect(result.html).toContain('data-duration="4"');
  });

  it("duplicates CSS rules for the new element ID", () => {
    const result = splitElementInHtml(source, { id: "box" }, 3, "box-split");
    expect(result.html).toContain("#box-split");
    expect(result.html).toContain("background: red");
    const cssMatches = result.html.match(/#box-split\s*\{/g);
    expect(cssMatches?.length).toBeGreaterThanOrEqual(1);
  });

  it("deduplicates IDs when the requested newId already exists", () => {
    const withExisting = source.replace(
      "</div></div>",
      '</div><div id="box-split" data-start="5" data-duration="1">Existing</div></div>',
    );
    const result = splitElementInHtml(withExisting, { id: "box" }, 3, "box-split");
    expect(result.matched).toBe(true);
    expect(result.html).toContain('id="box-split-2"');
  });

  it("keeps clip class on the cloned element", () => {
    const result = splitElementInHtml(source, { id: "box" }, 3, "box-split");
    expect(result.html).toMatch(/id="box-split"[^>]*class="clip"/);
  });

  it("returns matched false for out-of-range split time", () => {
    expect(splitElementInHtml(source, { id: "box" }, 0.5, "box-split").matched).toBe(false);
    expect(splitElementInHtml(source, { id: "box" }, 7.5, "box-split").matched).toBe(false);
  });

  it("splits a GSAP element with no authored timing using fallback timing", () => {
    const gsapSource = `<html><body><div data-composition-id="root"><h1 id="title" class="title">Hi</h1></div></body></html>`;
    const result = splitElementInHtml(gsapSource, { id: "title" }, 2, "title-split", {
      start: 0,
      duration: 6,
    });
    expect(result.matched).toBe(true);
    const original = result.html.match(/<h1[^>]*\bid="title"[^>]*>/);
    const clone = result.html.match(/<h1[^>]*\bid="title-split"[^>]*>/);
    expect(original?.[0]).toContain('data-start="0"');
    expect(original?.[0]).toContain('data-duration="2"');
    expect(clone?.[0]).toContain('data-start="2"');
    expect(clone?.[0]).toContain('data-duration="4"');
  });

  it("still rejects a no-timing element when no fallback timing is given", () => {
    const gsapSource = `<html><body><div data-composition-id="root"><h1 id="title">Hi</h1></div></body></html>`;
    expect(splitElementInHtml(gsapSource, { id: "title" }, 2, "title-split").matched).toBe(false);
  });

  it("adjusts media playback-start for the second half", () => {
    const mediaSource = source.replace(
      'id="box" class="clip" data-start="1" data-duration="6"',
      'id="box" class="clip" data-start="1" data-duration="6" data-playback-start="0"',
    );
    const result = splitElementInHtml(mediaSource, { id: "box" }, 3, "box-split");
    expect(result.html).toMatch(/id="box-split"[^>]*data-playback-start="2"/);
  });
});

describe("wrapElementsInHtml / unwrapElementsFromHtml", () => {
  const FIXTURE = `<!doctype html><html><body><div data-composition-id="main">
<div id="title" class="clip" style="position: absolute; left: 260px; top: 100px">Title</div>
<div id="logo" class="clip" style="position: absolute; left: 300px; top: 200px; transform: translate(10px, 5px)">Logo</div>
<div id="badge" class="clip" style="position: absolute; left: 400px; top: 50px; --hf-studio-offset: 12px">Badge</div>
<div id="outside" class="clip" style="position: absolute; left: 10px; top: 10px">Outside</div>
</div></body></html>`;

  const BBOX = { left: 260, top: 50, width: 300, height: 300 };
  const REBASES = [
    { target: { id: "title" }, left: 0, top: 50 },
    { target: { id: "logo" }, left: 40, top: 150 },
    { target: { id: "badge" }, left: 140, top: 0 },
  ];
  const TARGETS = [{ id: "title" }, { id: "logo" }, { id: "badge" }];

  function leftTop(el: Element): { left: number; top: number } {
    const style = el.getAttribute("style") ?? "";
    const left = parseFloat(/(?:^|;)\s*left\s*:\s*([\d.]+)px/.exec(style)?.[1] ?? "NaN");
    const top = parseFloat(/(?:^|;)\s*top\s*:\s*([\d.]+)px/.exec(style)?.[1] ?? "NaN");
    return { left, top };
  }

  function requireElement(document: Document, selector: string): Element {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Expected ${selector} to match`);
    return element;
  }

  it("wraps members in a data-hf-group div, preserving order and rebasing left/top", () => {
    const { html, matched, groupId } = wrapElementsInHtml(
      FIXTURE,
      TARGETS,
      "Group 1",
      BBOX,
      REBASES,
    );
    expect(matched).toBe(true);
    expect(groupId).toBe("Group 1");

    const { document } = parseHTML(html);
    const group = requireElement(document, '[data-hf-group="Group 1"]');

    expect(leftTop(group)).toEqual({ left: 260, top: 50 });
    expect(Array.from(group.children).map((c) => c.id)).toEqual(["title", "logo", "badge"]);
    expect(requireElement(document, "#outside").parentElement).toBe(
      requireElement(document, '[data-composition-id="main"]'),
    );
    expect(leftTop(requireElement(document, "#title"))).toEqual({ left: 0, top: 50 });
    expect(leftTop(requireElement(document, "#logo"))).toEqual({ left: 40, top: 150 });
    expect(requireElement(document, "#logo").getAttribute("style")).toContain(
      "transform: translate(10px, 5px)",
    );
    expect(leftTop(requireElement(document, "#badge"))).toEqual({ left: 140, top: 0 });
    expect(requireElement(document, "#badge").getAttribute("style")).toContain(
      "--hf-studio-offset: 12px",
    );
  });

  it("round-trips: unwrap restores original structure and coordinates", () => {
    const wrapped = wrapElementsInHtml(FIXTURE, TARGETS, "Group 1", BBOX, REBASES).html;
    const { html, unwrapped } = unwrapElementsFromHtml(wrapped, {
      selector: '[data-hf-group="Group 1"]',
    });
    expect(unwrapped).toBe(true);

    const { document } = parseHTML(html);
    expect(document.querySelector("[data-hf-group]")).toBeNull();

    const main = requireElement(document, '[data-composition-id="main"]');
    expect(Array.from(main.children).map((c) => c.id)).toEqual([
      "title",
      "logo",
      "badge",
      "outside",
    ]);
    expect(leftTop(requireElement(document, "#title"))).toEqual({ left: 260, top: 100 });
    expect(leftTop(requireElement(document, "#logo"))).toEqual({ left: 300, top: 200 });
    expect(requireElement(document, "#logo").getAttribute("style")).toContain(
      "transform: translate(10px, 5px)",
    );
    expect(leftTop(requireElement(document, "#badge"))).toEqual({ left: 400, top: 50 });
    expect(requireElement(document, "#badge").getAttribute("style")).toContain(
      "--hf-studio-offset: 12px",
    );
  });

  it("rejects members that do not share a single parent", () => {
    const split = `<!doctype html><html><body><div data-composition-id="main"><div id="a" style="position:absolute;left:0;top:0"></div><section><div id="b" style="position:absolute;left:0;top:0"></div></section></div></body></html>`;
    const result = wrapElementsInHtml(split, [{ id: "a" }, { id: "b" }], "Group 1", BBOX, [
      { target: { id: "a" }, left: 0, top: 0 },
      { target: { id: "b" }, left: 0, top: 0 },
    ]);
    expect(result.matched).toBe(false);
    expect(result.error).toMatch(/single parent/);
    expect(result.html).toBe(split);
  });

  it("lifts the group to the topmost member's slot so an interleaved non-member falls below it", () => {
    const fixture = `<!doctype html><html><body><div data-composition-id="main"><div id="low" style="position:absolute;left:0;top:0;z-index:2"></div><div id="middle" style="position:absolute;left:0;top:0;z-index:3"></div><div id="high" style="position:absolute;left:0;top:0;z-index:4"></div></div></body></html>`;
    const { html, matched } = wrapElementsInHtml(
      fixture,
      [{ id: "low" }, { id: "high" }],
      "Group 1",
      { left: 0, top: 0, width: 10, height: 10 },
      [
        { target: { id: "low" }, left: 0, top: 0 },
        { target: { id: "high" }, left: 0, top: 0 },
      ],
    );
    expect(matched).toBe(true);
    const { document } = parseHTML(html);
    const parent = requireElement(document, '[data-composition-id="main"]');
    const group = requireElement(document, '[data-hf-group="Group 1"]');
    expect(Array.from(group.children).map((c) => c.id)).toEqual(["low", "high"]);
    const topChildren = Array.from(parent.children).map(
      (c) => c.getAttribute("data-hf-group") ?? c.id,
    );
    expect(topChildren).toEqual(["middle", "Group 1"]);
    expect(group.getAttribute("style")).toMatch(/z-index:\s*4/);
  });

  it("refuses to unwrap an element without data-hf-group (no silent corruption)", () => {
    const html = `<!doctype html><html><body><div data-composition-id="main"><div id="plain" style="position:absolute;left:0;top:0"><span id="kid"></span></div></div></body></html>`;
    const result = unwrapElementsFromHtml(html, { id: "plain" });
    expect(result.unwrapped).toBe(false);
    expect(result.html).toBe(html);
  });
});
