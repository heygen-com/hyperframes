import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSoftReload, softReload, type SoftReloadParams } from "./softReload";

type TestWindow = Window & Record<string, unknown>;
const win = window as TestWindow;
const SCRIPT = `var __timelines = {}; __timelines["main"] = 1;`;
const params = (over: Partial<SoftReloadParams> = {}): SoftReloadParams => ({
  script: SCRIPT,
  time: 1.5,
  sets: [],
  authored: [],
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
  for (const key of ["gsap", "__timelines", "__hfForceTimelineRebind", "__player"]) delete win[key];
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
  ])("refuses %s", (_label, request) => {
    expect(parseSoftReload(request)).toBeNull();
  });
});
