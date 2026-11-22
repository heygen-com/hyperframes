import { afterEach, describe, expect, it, vi } from "vitest";
import { patchTweens } from "./patchTween";
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
    "MotionPathPlugin",
    "__hfMotionPathWaiters",
    "__hfSwapsWaiting",
    "__hfTimelineGenerations",
  ])
    delete win[key];
  document.head.innerHTML = "";
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

// Every order of the events a re-run waiting for the MotionPath plugin can meet. The older run re-runs
// "main" and restores #a; the other events are a scrub, newer runs on "main" or "other", an attribute
// restore of #a, and the plugin loading or failing.
describe("a re-run that waits for the MotionPath plugin", () => {
  const run = (key: string, name: string, motion = false) =>
    `var __timelines = {}; __timelines["${key}"] = 1; document.body.dataset.${key} = "${name}";` +
    (motion ? " var p = { motionPath: {} };" : "");
  const restoreA = (left: number) => [
    {
      file: null,
      elements: [
        {
          key: "hf:a",
          attributes: [
            ["id", "a"],
            ["data-hf-id", "a"],
            ["style", `left: ${left}px`],
          ],
        },
      ],
    },
  ];
  type Step =
    | "scrub"
    | "play"
    | "same"
    | "other"
    | "two"
    | "patch"
    | "attr"
    | "edit"
    | "ok"
    | "fail";
  type Outcome = {
    answer: string;
    main?: string;
    other?: string;
    left: string;
    color: string;
    at: number;
  };

  function page() {
    document.body.innerHTML =
      `<div data-composition-id="main"><div id="a" data-hf-id="a" style="left: 0px"></div></div>` +
      `<div data-composition-id="other"></div>` +
      `<script>${run("main", "file")}</script><script>${run("other", "file")}</script>`;
    delete document.body.dataset.main;
    delete document.body.dataset.other;
    const kills: string[] = [];
    const timeline = (key: string) => ({ kill: () => kills.push(key), clear: () => {} });
    win.gsap = { timeline: () => ({}), set: () => {} };
    win.__timelines = { main: timeline("main"), other: timeline("other") };
    win.__hfForceTimelineRebind = () => {};
    const seeks: number[] = [];
    let now = 4;
    let playing = false;
    win.__player = {
      seek: (t: number) => seeks.push((now = t)),
      getTime: () => now,
      isPlaying: () => playing,
      play: () => {},
      playFor: (t: number) => ((playing = true), (now = t)),
    };
    const append = document.body.appendChild.bind(document.body);
    document.body.appendChild = <T extends Node>(node: T): T => {
      for (const [, key] of (node.textContent ?? "").matchAll(/__timelines\["(\w+)"\]/g))
        (win.__timelines as Record<string, object>)[key!] = timeline(key!);
      const added = append(node);
      if (node.nodeName === "SCRIPT") new Function(node.textContent ?? "")();
      return added;
    };
    return { seeks, kills };
  }

  const plugin = () => document.head.querySelector<HTMLScriptElement>("script[src]")!;
  const newer = async (key: string) =>
    expect(await softReload(params({ script: run(key, "newer") }))).toEqual({ result: "applied" });
  const STEPS: Record<Step, () => unknown> = {
    play: () => (win.__player as { playFor(t: number): void }).playFor(5),
    two: () => void softReload(params({ script: run("other", "newer", true), time: 3 })),
    patch: () =>
      expect(
        patchTweens({
          patches: [{ selector: "#a", change: { kind: "set", props: { x: 300 } } }],
          seek: true,
        }),
      ).toEqual({ patched: false }),
    scrub: () => {
      for (const t of [3, 4]) (win.__player as { seek(t: number): void }).seek(t);
    },
    same: () => newer("main"),
    other: () => newer("other"),
    attr: () => restoreAttributesOrRerun({ scopes: restoreA(2), scripted: false, time: 4 }),
    edit: () => document.getElementById("a")!.style.setProperty("color", "red"),
    ok: () => {
      win.MotionPathPlugin = {};
      plugin().onload!(new Event("load"));
    },
    fail: () => plugin().onerror!(new Event("error")),
  };

  async function play(steps: Step[]): Promise<Outcome> {
    const { seeks } = page();
    const older = softReload(
      params({ script: run("main", "older", true), time: 2, restore: restoreA(1) }),
    );
    for (const step of steps) {
      await STEPS[step]();
      await Promise.resolve();
    }
    const { dataset } = document.body;
    return {
      answer: (await older).result,
      main: dataset.main,
      other: dataset.other,
      left: document.getElementById("a")!.style.left,
      color: document.getElementById("a")!.style.color,
      at: seeks.at(-1) ?? NaN,
    };
  }

  it("starts a fresh plugin load for the next re-run after one failed", async () => {
    page();
    const motion = params({ script: run("main", "older", true) });
    const first = softReload(motion);
    plugin().onerror!(new Event("error"));
    expect(await first).toEqual({ result: "cannot-soft-reload" });
    const second = softReload(motion);
    expect(document.head.querySelectorAll("script[src]")).toHaveLength(2);
    win.MotionPathPlugin = {};
    document.head.querySelectorAll<HTMLScriptElement>("script[src]")[1]!.onload!(new Event("load"));
    expect(await second).toEqual({ result: "applied" });
  });

  // fails without the fix: rows "ok", "same,ok", "same,fail", "other,ok", "other,fail", "attr,ok", "play,ok",
  // "two,ok" and "patch,ok".
  it.each<[string, Step[], Partial<Outcome>]>([
    ["ok", ["ok"], { answer: "applied", main: "older", left: "1px", at: 4 }],
    ["scrub,ok", ["scrub", "ok"], { answer: "applied", main: "older", at: 4 }],
    ["ok,scrub", ["ok", "scrub"], { answer: "applied", main: "older", at: 4 }],
    ["same,ok", ["same", "ok"], { answer: "superseded", main: "newer", left: "1px" }],
    ["same,fail", ["same", "fail"], { answer: "superseded", main: "newer" }],
    ["ok,same", ["ok", "same"], { answer: "applied", main: "newer" }],
    ["fail,same", ["fail", "same"], { answer: "cannot-soft-reload", main: "newer" }],
    ["other,ok", ["other", "ok"], { answer: "applied", main: "older", other: "newer" }],
    [
      "other,fail",
      ["other", "fail"],
      { answer: "cannot-soft-reload", main: undefined, other: "newer", left: "1px" },
    ],
    ["ok,other", ["ok", "other"], { answer: "applied", main: "older", other: "newer" }],
    ["attr,ok", ["attr", "ok"], { answer: "applied", main: "older", left: "2px" }],
    ["ok,attr", ["ok", "attr"], { answer: "applied", main: "older", left: "2px" }],
    ["edit,ok", ["edit", "ok"], { answer: "applied", main: "older", color: "red" }],
    ["ok,edit", ["ok", "edit"], { answer: "applied", main: "older", color: "red" }],
    ["play,ok", ["play", "ok"], { answer: "applied", main: "older", at: 5 }],
    ["two,ok", ["two", "ok"], { answer: "applied", main: "older", other: "newer", at: 4 }],
    ["patch,ok", ["patch", "ok"], { answer: "applied", main: "older" }],
  ])("%s", async (_name, steps, expected) => {
    expect(await play(steps)).toMatchObject(expected);
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
    expect(await restoreAttributesOrRerun(params)).toEqual({ applied: true, reran: true });
    expect(seen).toEqual([expect.stringContaining("left: 0px")]);
    expect(killed).toHaveBeenCalledOnce();
    expect(seeks).toContain(1.5);
  });

  it("refuses and changes nothing when GSAP has parsed a restored element and no re-run came", async () => {
    preview(MARKUP);
    const el = parsedEl();
    expect(await restoreAttributesOrRerun(parseRestoreAttributesRerun(request())!)).toEqual({
      applied: false,
      reran: false,
    });
    expect(el.getAttribute("style")).toBe("left: 90px");
    expect(killed).not.toHaveBeenCalled();
  });

  it("sets the attributes without re-running when GSAP has parsed none of them", async () => {
    preview(MARKUP);
    const params = parseRestoreAttributesRerun(request(RERUN))!;
    expect(await restoreAttributesOrRerun(params)).toEqual({ applied: true, reran: false });
    expect(document.getElementById("a")!.getAttribute("style")).toBe("left: 0px");
    expect(killed).not.toHaveBeenCalled();
  });

  it("is refused by an older frame's parser, so Studio reloads as before", () => {
    expect(parseRestoreAttributes(request(RERUN))).toBeNull();
  });

  // fails without the fix: an unrelated style over the re-run's limit refused a restore that needed no re-run.
  it.each([
    ["an empty script", { ...RERUN, script: "" }],
    ["a field soft-reload does not take", { ...RERUN, restore: [] }],
    ["an authored style over its limit", { ...RERUN, authored: [["#big", "x".repeat(16_385)]] }],
    ["no object", "rerun"],
  ])("drops a re-run with %s and keeps the restore", (_name, rerun) => {
    expect(parseRestoreAttributesRerun({ ...request(), rerun })).toEqual(request());
  });

  it("sets the attributes in place when the re-run it carried was dropped and none is needed", async () => {
    preview(MARKUP);
    const big = { ...RERUN, authored: [["#big", "x".repeat(16_385)]] };
    const params = parseRestoreAttributesRerun(request(big))!;
    expect(await restoreAttributesOrRerun(params)).toEqual({ applied: true, reran: false });
    expect(document.getElementById("a")!.getAttribute("style")).toBe("left: 0px");
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
