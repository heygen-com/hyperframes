import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRestoreAttributes, restoreAttributes } from "./restoreAttributes";

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
  for (const name of ["__player", "__hfForceTimelineRebind", "__hfStudioManualEditsApply"])
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
    expect(restoreAttributes(params)).toEqual({ applied: true });
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
    expect(restoreAttributes(params)).toEqual({ applied: true });
    expect(document.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("changes nothing when an element is missing, shared by two, or GSAP-parsed under a script", () => {
    const attributes: [string, string][] = [["data-hf-id", "box"]];
    const refused = (html: string, params = restore("hf:box", attributes)) => {
      document.body.innerHTML = html;
      player();
      const before = document.body.innerHTML;
      expect(restoreAttributes(params)).toEqual({ applied: false });
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
    expect(restoreAttributes({ ...restore("hf:box", attributes), scripted: true })).toEqual({
      applied: false,
    });
    expect(rebind).not.toHaveBeenCalled();
  });

  it("changes no handler, URL or sandbox-style attribute, and leaves an unchanged one alone", () => {
    const refused = (html: string, attributes: [string, string][]) => {
      document.body.innerHTML = html;
      player();
      const before = document.body.innerHTML;
      expect(restoreAttributes(restore("hf:box", attributes))).toEqual({ applied: false });
      expect(document.body.innerHTML).toBe(before);
    };
    const box = '<div data-hf-id="box"></div>';
    const id: [string, string] = ["data-hf-id", "box"];
    for (const name of ["onclick", "ONCLICK", "href", "src", "srcdoc", "xlink:href", "sandbox"])
      refused(box, [id, [name, "alert(1)"]]);
    refused(box, [id, ["data-composition-src", "https://example.com/a.html"]]);
    refused('<iframe data-hf-id="box" sandbox=""></iframe>', [id]);

    document.body.innerHTML =
      '<img data-hf-id="box" src="a.png" style="left: 9px" loading="lazy" data-hf-preview-lazy>';
    player();
    const img = document.querySelector("img")!;
    const setAttribute = vi.spyOn(img, "setAttribute");
    const params = restore("hf:box", [id, ["src", "a.png"], ["style", "left: 0px"]]);
    expect(restoreAttributes(params)).toEqual({ applied: true });
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
