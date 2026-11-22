import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRestoreAttributes, restoreInPlace } from "./restoreAttributes";

type TestWindow = Window & Record<string, unknown>;
const win = window as TestWindow;

function player() {
  const calls: string[] = [];
  win.__player = { seek: (t: number) => calls.push(`seek ${t}`), isPlaying: () => false };
  win.__hfForceTimelineRebind = () => calls.push("rebind");
  win.__hfStudioManualEditsApply = () => calls.push("manual");
  return calls;
}

afterEach(() => {
  document.body.innerHTML = "";
  for (const name of [
    "__player",
    "__hfForceTimelineRebind",
    "__hfStudioManualEditsApply",
    "__hfStudioSeekReapplyStarted",
  ])
    delete win[name];
});

const moved = '<div data-hf-id="box" class="card" style="left: 90px"></div>';
const restore = (key: string, attributes: [string, string][], file: string | null = null) => ({
  scopes: [{ file, elements: [{ key, attributes }] }],
  scripted: false,
  time: 1.5,
});

describe("restore-attributes", () => {
  it("puts the restored attributes on the live element and rebinds at the playhead", () => {
    document.body.innerHTML = moved;
    const calls = player();
    const params = restore("hf:box", [
      ["data-hf-id", "box"],
      ["style", "left: 0px"],
    ]);
    expect(restoreInPlace(params)).toBe("applied");
    const box = document.querySelector('[data-hf-id="box"]')!;
    expect(box.getAttribute("style")).toBe("left: 0px");
    expect(box.hasAttribute("class")).toBe(false);
    expect(calls).toEqual(["seek 1.5", "rebind", "manual"]);
  });

  it("restores each copy of an inlined sub-composition", () => {
    document.body.innerHTML = [1, 2]
      .map((n) => `<section data-composition-file="sub.html" id="host${n}">${moved}</section>`)
      .join("");
    player();
    const params = restore("hf:box", [["data-hf-id", "box"]], "sub.html");
    expect(restoreInPlace(params)).toBe("applied");
    expect(document.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("changes nothing when an element is missing, shared by two, or GSAP-parsed under a script", () => {
    const attributes: [string, string][] = [["data-hf-id", "box"]];
    const refused = (html: string, params = restore("hf:box", attributes)) => {
      document.body.innerHTML = html;
      player();
      const before = document.body.innerHTML;
      expect(restoreInPlace(params)).toBe("refused");
      expect(document.body.innerHTML).toBe(before);
    };
    refused('<div data-hf-id="other"></div>');
    refused(moved + moved);
    refused(moved, restore("hf:box", attributes, "missing.html"));
    document.body.innerHTML = moved;
    Object.assign(document.querySelector("div")!, { _gsap: {} });
    const rebind = vi.fn();
    player();
    win.__hfForceTimelineRebind = rebind;
    expect(restoreInPlace({ ...restore("hf:box", attributes), scripted: true })).toBe(
      "gsap-parsed",
    );
    expect(rebind).not.toHaveBeenCalled();
  });

  // fails without the fix: a redo of a sealed move was refused for setting Studio's mark and reloaded the preview.
  it("puts back Studio's own edit marks in place, as a redo of a move needs", () => {
    document.body.innerHTML = '<div data-hf-id="box"></div>';
    player();
    const params = restore("hf:box", [
      ["data-hf-id", "box"],
      ["data-hf-studio-original-inline-translate", ""],
      ["style", "translate: 130px 90px"],
    ]);
    expect(restoreInPlace(params)).toBe("applied");
    const box = document.querySelector('[data-hf-id="box"]')!;
    expect(box.getAttribute("data-hf-studio-original-inline-translate")).toBe("");
    expect(box.getAttribute("style")).toBe("translate: 130px 90px");
  });

  // fails without the fix: a page whose seek-reapply script never started reverted the size on the next seek.
  it("reloads for a mark a seek has to reapply until the page's reapply script has started", () => {
    document.body.innerHTML = '<div data-hf-id="box"></div><i data-hf-studio-rotation="true"></i>';
    player();
    const sized = () =>
      restoreInPlace(
        restore("hf:box", [
          ["data-hf-id", "box"],
          ["data-hf-studio-box-size", "true"],
        ]),
      );
    expect(sized()).toBe("refused");
    win.__hfStudioSeekReapplyStarted = true;
    expect(sized()).toBe("applied");
  });

  // fails without the fix: dropping a motion mark in place left its timeline running.
  it("reloads to take a motion mark away", () => {
    document.body.innerHTML = '<div data-hf-id="box" data-hf-studio-motion="{}"></div>';
    player();
    expect(restoreInPlace(restore("hf:box", [["data-hf-id", "box"]]))).toBe("refused");
  });

  it("changes no handler, URL or sandbox-style attribute, and leaves an unchanged one alone", () => {
    const refused = (html: string, attributes: [string, string][]) => {
      document.body.innerHTML = html;
      player();
      const before = document.body.innerHTML;
      expect(restoreInPlace(restore("hf:box", attributes))).toBe("refused");
      expect(document.body.innerHTML).toBe(before);
    };
    const box = '<div data-hf-id="box"></div>';
    const id: [string, string] = ["data-hf-id", "box"];
    for (const name of ["onclick", "ONCLICK", "onerror", "href", "src", "srcdoc", "xlink:href"])
      refused(box, [id, [name, "alert(1)"]]);
    for (const name of ["sandbox", "data-hf-handle", "data-hf-studio", "data-studio-x"])
      refused(box, [id, [name, "alert(1)"]]);
    for (const name of ["data-hf-studio-motion", "data-hf-studio-motion-original-opacity"])
      refused(box, [id, [name, "{}"]]);
    refused(box, [id, ["data-composition-src", "https://example.com/a.html"]]);
    refused('<iframe data-hf-id="box" sandbox=""></iframe>', [id]);

    document.body.innerHTML =
      '<img data-hf-id="box" src="a.png" style="left: 9px" loading="lazy" data-hf-preview-lazy>';
    player();
    const img = document.querySelector("img")!;
    const setAttribute = vi.spyOn(img, "setAttribute");
    const params = restore("hf:box", [id, ["src", "a.png"], ["style", "left: 0px"]]);
    expect(restoreInPlace(params)).toBe("applied");
    expect(setAttribute.mock.calls).toEqual([["style", "left: 0px"]]);
    expect(img.hasAttribute("loading")).toBe(false);
  });

  it("accepts only bounded, well-formed params", () => {
    const ok = restore("hf:box", [["style", "left: 0"]]);
    expect(parseRestoreAttributes(ok)).toEqual(ok);
    for (const bad of [
      { ...ok, time: -1 },
      { ...ok, extra: 1 },
      { ...ok, scopes: [] },
      restore("box", [["style", "x"]]),
      restore("hf:box", [["on click", "x"]]),
      restore("hf:box", [["style", 1 as unknown as string]]),
      restore("hf:box", [], ""),
      { ...ok, scopes: [{ file: null, elements: Array(2_001).fill(ok.scopes[0]!.elements[0]) }] },
    ])
      expect(parseRestoreAttributes(bad)).toBeNull();
  });
});
