import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRestoreAttributes } from "./restoreAttributes";
import {
  parseRestoreAttributesRerun,
  parseSoftReload,
  restoreAttributesOrRerun,
  softReload,
  type SoftReloadParams,
} from "./softReload";

type TestWindow = Window & Record<string, unknown>;
const win = window as TestWindow;
const SCRIPT = `var __timelines = {}; __timelines["main"] = 1;`;
const params = (over: Partial<SoftReloadParams> = {}): SoftReloadParams => ({
  script: SCRIPT,
  time: 1.5,
  sets: [],
  authored: [],
  timing: [],
  restore: [],
  ...over,
});

const killed = vi.fn();
function preview(markup: string) {
  document.body.innerHTML = `${markup}<script>${SCRIPT}</script>`;
  const seeks: number[] = [];
  win.gsap = {
    timeline: () => ({}),
    set: (targets: HTMLElement[], vars: Record<string, unknown>) => {
      if (vars.clearProps) for (const el of targets) el.removeAttribute("style");
    },
  };
  win.__timelines = { main: { kill: killed, clear: () => {} } };
  win.__hfForceTimelineRebind = () => {};
  win.__player = { seek: (t: number) => seeks.push(t) };
  // The sent script registers on a local: the stub registers what a real run would.
  const append = document.body.appendChild.bind(document.body);
  document.body.appendChild = <T extends Node>(node: T): T => {
    if ((node as Node).nodeName === "SCRIPT") (win.__timelines as Record<string, object>).main = {};
    return append(node);
  };
  return seeks;
}

afterEach(() => {
  document.body.innerHTML = "";
  for (const key of [
    "gsap",
    "__timelines",
    "__hfForceTimelineRebind",
    "__player",
    "__hfStudioSeekReapplyStarted",
  ])
    delete win[key];
  delete (document.body as Partial<HTMLElement>).appendChild;
  killed.mockReset();
});

describe("soft-reload", () => {
  it("re-runs the sent script and gives a reset element the authored style Studio sent", async () => {
    const seeks = preview(
      `<div data-composition-id="main"><div id="a" data-hf-id="h1" style="opacity: 0.3; transform: translateX(50px)"></div></div>`,
    );
    const el = document.getElementById("a")!;
    Object.assign(el, { _gsap: {} });

    const reply = await softReload(params({ authored: [["hf:h1", "opacity: 0.8"]] }));

    expect(reply).toEqual({ result: "applied" });
    expect([el.style.opacity, el.style.transform]).toEqual(["0.8", ""]);
    expect(killed).toHaveBeenCalledOnce();
    const scripts = [...document.querySelectorAll("script")].map((s) => s.textContent);
    expect(scripts).toEqual([`(function(){${SCRIPT}\n})();`]);
    expect(seeks).toEqual([1.5]);
  });

  it("restores what a removed standalone set wrote, from the selector and names Studio sent", async () => {
    preview(`<div data-composition-id="main"><div id="a" style="left: 10px"></div></div>`);
    const el = document.getElementById("a")!;
    el.style.backgroundColor = "red";

    await softReload(
      params({
        sets: [{ selector: "#a", props: ["background-color"] }],
        authored: [["#a", "left: 10px"]],
      }),
    );

    expect([el.style.backgroundColor, el.style.left]).toEqual(["", "10px"]);
  });

  it("changes nothing and refuses when a reset element is written in a file Studio did not send", async () => {
    preview(
      `<div data-composition-id="main" data-composition-file="main.html"><div data-composition-file="card.html"><div id="b"></div></div></div>`,
    );
    const el = document.getElementById("b")!;
    Object.assign(el, { _gsap: {} });
    el.style.opacity = "0.3";

    const reply = await softReload(params());

    expect(reply).toEqual({ result: "cannot-soft-reload" });
    expect(killed).not.toHaveBeenCalled();
    expect(el.style.opacity).toBe("0.3");
    expect(document.querySelector("script")?.textContent).toBe(SCRIPT);
  });

  it("refuses a script that registers no timeline key, before touching anything", async () => {
    preview(`<div data-composition-id="main"></div>`);
    expect(await softReload(params({ script: "gsap.to('#a', {x: 1})" }))).toEqual({
      result: "cannot-soft-reload",
    });
    expect(killed).not.toHaveBeenCalled();
  });
});

const restoreOf = (key: string, attributes: Array<[string, string]>) => ({
  file: null,
  elements: [{ key, attributes }],
});

// fails without the fix: a sealed undo of a keyframe edit could not re-run in place, so the preview reloaded.
describe("soft-reload of an undo", () => {
  const MARKUP = `<div data-composition-id="main"><div id="a" data-hf-id="h1" style="left: 90px" data-hf-studio-path-offset="1"></div></div>`;
  const KEPT: Array<[string, string]> = [
    ["id", "a"],
    ["data-hf-id", "h1"],
  ];

  it("sets the restored attributes before the re-run, as restore-attributes would", async () => {
    preview(MARKUP);
    const el = document.getElementById("a")!;
    const seen: Array<string | null> = [];
    win.__hfForceTimelineRebind = () => seen.push(el.getAttribute("style"));

    const restore = [restoreOf("hf:h1", [...KEPT, ["style", "left: 0px"]])];
    expect(await softReload(params({ restore }))).toEqual({ result: "applied" });

    expect(seen).toEqual(["left: 0px"]);
    expect(el.hasAttribute("data-hf-studio-path-offset")).toBe(false);
    expect(killed).toHaveBeenCalledOnce();
  });

  it("refuses the whole request and changes nothing when the restore carries an attribute it may not set", async () => {
    preview(MARKUP);
    const el = document.getElementById("a")!;
    const restore = [restoreOf("hf:h1", [...KEPT, ["style", "left: 0px"], ["onclick", "x()"]])];

    expect(await softReload(params({ restore }))).toEqual({ result: "cannot-soft-reload" });

    expect(el.getAttribute("style")).toBe("left: 90px");
    expect(el.hasAttribute("onclick")).toBe(false);
    expect(killed).not.toHaveBeenCalled();
    expect(document.querySelector("script")?.textContent).toBe(SCRIPT);
  });

  // fails without the fix: the in-place re-run set a mark the next seek reverts, its reapply script never started.
  it("refuses a restored mark a seek has to reapply until the page's reapply script has started", async () => {
    preview(MARKUP);
    const el = document.getElementById("a")!;
    const restore = [restoreOf("hf:h1", [...KEPT, ["data-hf-studio-box-size", "true"]])];

    expect(await softReload(params({ restore }))).toEqual({ result: "cannot-soft-reload" });
    expect(el.hasAttribute("data-hf-studio-box-size")).toBe(false);
    expect(killed).not.toHaveBeenCalled();

    win.__hfStudioSeekReapplyStarted = true;
    expect(await softReload(params({ restore }))).toEqual({ result: "applied" });
    expect(el.getAttribute("data-hf-studio-box-size")).toBe("true");
  });
});

// fails without the fix: the frame refused an element GSAP parsed, and Studio's later re-run raced newer edits.
describe("restore-attributes with a re-run", () => {
  const MARKUP = `<div data-composition-id="main"><div id="a" data-hf-id="h1" style="left: 90px"></div></div>`;
  const RERUN = { script: SCRIPT, sets: [], authored: [], timing: [] };
  const request = (rerun?: object) => ({
    scopes: [
      restoreOf("hf:h1", [
        ["id", "a"],
        ["data-hf-id", "h1"],
        ["style", "left: 0px"],
      ]),
    ],
    scripted: true,
    time: 1.5,
    ...(rerun && { rerun }),
  });
  const parsedEl = () => Object.assign(document.getElementById("a")!, { _gsap: {} });

  it("re-runs the script in the same request when GSAP has parsed a restored element", async () => {
    const seeks = preview(MARKUP);
    const el = parsedEl();
    const seen: Array<string | null> = [];
    win.__hfForceTimelineRebind = () => seen.push(el.getAttribute("style"));
    const params = parseRestoreAttributesRerun(request(RERUN))!;
    expect(await restoreAttributesOrRerun(params)).toEqual({ applied: true });
    expect(seen).toEqual(["left: 0px"]);
    expect(killed).toHaveBeenCalledOnce();
    expect(seeks).toContain(1.5);
  });

  it("refuses and changes nothing when GSAP has parsed a restored element and no re-run came", async () => {
    preview(MARKUP);
    const el = parsedEl();
    expect(await restoreAttributesOrRerun(parseRestoreAttributesRerun(request())!)).toEqual({
      applied: false,
    });
    expect(el.getAttribute("style")).toBe("left: 90px");
    expect(killed).not.toHaveBeenCalled();
  });

  it("sets the attributes without re-running when GSAP has parsed none of them", async () => {
    preview(MARKUP);
    const params = parseRestoreAttributesRerun(request(RERUN))!;
    expect(await restoreAttributesOrRerun(params)).toEqual({ applied: true });
    expect(document.getElementById("a")!.getAttribute("style")).toBe("left: 0px");
    expect(killed).not.toHaveBeenCalled();
  });

  it("is refused by an older frame's parser, so Studio reloads as before", () => {
    expect(parseRestoreAttributes(request(RERUN))).toBeNull();
  });

  it.each([
    ["an empty script", { ...RERUN, script: "" }],
    ["a field soft-reload does not take", { ...RERUN, restore: [] }],
    ["no object", "rerun"],
  ])("refuses a re-run with %s", (_name, rerun) => {
    expect(parseRestoreAttributesRerun({ ...request(), rerun })).toBeNull();
  });
});

describe("soft-reload of a timing edit", () => {
  const MARKUP = `<div data-composition-id="main" data-hf-id="root" data-duration="5"><div id="clip" data-start="1" data-duration="2" data-hf-autostamped></div></div>`;

  it("puts the saved timing on the live clip and the film before the rebind derives its windows", async () => {
    preview(MARKUP);
    const clip = document.getElementById("clip")!;
    const root = document.querySelector("[data-composition-id]")!;
    const seen: Array<Array<string | null>> = [];
    win.__hfForceTimelineRebind = () =>
      seen.push([clip.getAttribute("data-start"), root.getAttribute("data-duration")]);

    const timing: SoftReloadParams["timing"] = [
      ["hf:root", [["data-duration", "8"]]],
      [
        "#clip",
        [
          ["data-start", "4"],
          ["data-duration", "2"],
        ],
      ],
    ];
    expect(await softReload(params({ timing }))).toEqual({ result: "applied" });

    expect(seen).toEqual([["4", "8"]]);
    expect(clip.hasAttribute("data-hf-autostamped")).toBe(false);
  });

  it("changes nothing and refuses when a timed element of the saved file is not in the preview", async () => {
    preview(MARKUP);
    const clip = document.getElementById("clip")!;

    const timing: SoftReloadParams["timing"] = [
      ["#clip", [["data-start", "4"]]],
      ["#gone", [["data-start", "1"]]],
    ];
    expect(await softReload(params({ timing }))).toEqual({ result: "cannot-soft-reload" });

    expect(clip.getAttribute("data-start")).toBe("1");
    expect(killed).not.toHaveBeenCalled();
  });

  it("times the saved file's clip even when a nested file's root repeats its per-file id", async () => {
    preview(
      `<div data-composition-file="main.html"><div data-composition-id="main" data-hf-id="root">` +
        `<div data-composition-file="card.html"><div data-composition-id="card" data-hf-inner-root data-hf-id="shared"></div></div>` +
        `<div id="clip" data-hf-id="shared" data-start="1" data-duration="2"></div></div></div>`,
    );

    const timing: SoftReloadParams["timing"] = [["hf:shared", [["data-start", "4"]]]];
    expect(await softReload(params({ timing }))).toEqual({ result: "applied" });

    expect(document.getElementById("clip")!.getAttribute("data-start")).toBe("4");
  });
});

describe("parseSoftReload", () => {
  it("accepts a bounded request", () => {
    const ok = params({ sets: [{ selector: "#a", props: ["width"] }], authored: [["hf:1", ""]] });
    expect(parseSoftReload(ok)).toEqual(ok);
  });

  it.each([
    ["an extra field", { ...params(), keys: ["main"] }],
    ["an empty script", params({ script: "" })],
    ["an oversized script", params({ script: "x".repeat(1_000_001) })],
    ["a negative time", params({ time: -1 })],
    ["a non-finite time", params({ time: Number.NaN })],
    ["a set with an extra field", params({ sets: [{ selector: "#a", props: [], x: 1 } as never] })],
    ["an authored key of no known kind", params({ authored: [["a", ""]] })],
    ["an authored entry with three parts", params({ authored: [["#a", "", ""] as never] })],
    ["a timing attribute that is not timing", params({ timing: [["#a", [["style", "x"]]]] })],
    ["no timing field", { ...params(), timing: undefined }],
    ["no restore field", { ...params(), restore: undefined }],
    ["a restore element keyed by neither id", params({ restore: [restoreOf("a", [])] })],
  ])("refuses %s", (_label, request) => {
    expect(parseSoftReload(request)).toBeNull();
  });
});
