import { afterEach, describe, expect, it, vi } from "vitest";
import { installEditingAgent } from "../editingAgent";
import { captureStageGhosts } from "./stageGhost";
import {
  endStageAct,
  MAX_STAGE_ACTS,
  parseStageActParams,
  STAGE_HOLD_WATCH_MS,
  stageAct,
  stageActReadyEvent,
  stageInputEvent,
  type StageActParams,
} from "./stageAct";

// jsdom has no CSS.escape; browsers do (capturedMediaIdleRoute.test.ts stubs it the same way).
(globalThis as typeof globalThis & { CSS?: { escape?: (v: string) => string } }).CSS ??= {};
globalThis.CSS.escape ??= (v: string) => v.replace(/["\\]/g, "\\$&");

const V = 1;
const fakePort = () =>
  ({ postMessage: vi.fn() }) as unknown as MessagePort & { postMessage: ReturnType<typeof vi.fn> };
const sized = (element: Element, width = 100, height = 40) =>
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 20,
    width,
    height,
    top: 20,
    left: 10,
    right: 10 + width,
    bottom: 20 + height,
    toJSON: () => ({}),
  } as DOMRect);
const hold = (acts: unknown[], deferred = false) =>
  parseStageActParams({ op: "hold", acts, deferred, caretColor: "#3ce6ac" })!;
const run = (params: StageActParams | null, port: MessagePort) => {
  expect(params).not.toBeNull();
  return stageAct(params!, port, V);
};

afterEach(() => {
  endStageAct();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("parseStageActParams", () => {
  const act = { key: "hf-a", hfId: "hf-a", borrow: ["translate"], draw: { translate: [1, 2] } };
  it("accepts each op in its shape", () => {
    expect(hold([act])).toMatchObject({ op: "hold", acts: [act], deferred: false });
    for (const ok of [
      {
        op: "frame",
        draws: [
          { key: "hf-a", draw: { scale: 1.04, styles: { "box-shadow": "0 14px 28px #18181b33" } } },
        ],
      },
      {
        op: "frame",
        draws: [
          {
            key: "k",
            draw: {
              styles: {
                color: "oklch(0.7 0.1 140)",
                "background-image":
                  "radial-gradient(circle at 50% 50%, rgba(1, 2, 3, 1) 12.5px, transparent 12.5px)",
              },
            },
          },
        ],
      },
      {
        op: "frame",
        draws: [
          {
            key: "k",
            draw: {
              styles: {
                transform: "rotate(-22.0deg)",
                filter: "drop-shadow(0 3.0px 14px #18181b30)",
                opacity: "0.5",
                "font-size": "31.5px",
              },
            },
          },
        ],
      },
      { op: "ready", keys: ["a"] },
      { op: "restore", keys: null },
      { op: "restore", keys: ["a"] },
      { op: "capture", targets: [{ key: "0>1", hfId: null }] },
    ])
      expect(parseStageActParams(ok)).toEqual(ok);
  });

  it.each([
    ["an unknown op", { op: "paint" }],
    [
      "too many acts",
      {
        op: "hold",
        acts: Array(MAX_STAGE_ACTS + 1).fill(act),
        deferred: false,
        caretColor: "#fff",
      },
    ],
    ["a caret colour that loads", { op: "hold", acts: [], deferred: false, caretColor: "url(x)" }],
    [
      "an unknown borrow",
      { op: "hold", acts: [{ ...act, borrow: ["width"] }], deferred: false, caretColor: "#fff" },
    ],
    ["an unknown field", { op: "ready", keys: [], extra: 1 }],
    [
      "a non-finite translate",
      { op: "frame", draws: [{ key: "a", draw: { translate: [Infinity, 0] } }] },
    ],
    ["a negative scale", { op: "frame", draws: [{ key: "a", draw: { scale: -1 } }] }],
    ["a fractional typed count", { op: "frame", draws: [{ key: "a", draw: { typed: 1.5 } }] }],
    [
      "a style named after an Object member",
      { op: "frame", draws: [{ key: "a", draw: { styles: { constructor: "x" } } }] },
    ],
    [
      "a draw field named after an Object member",
      { op: "frame", draws: [{ key: "a", draw: { toString: 1 } }] },
    ],
    ["an op named after an Object member", { op: "constructor" }],
    [
      "an oversized ghost",
      {
        op: "hold",
        acts: [
          {
            key: "g",
            ghost: { markup: "x".repeat(65_537), box: { x: 0, y: 0, width: 1, height: 1 } },
            draw: {},
          },
        ],
        deferred: false,
        caretColor: "#fff",
      },
    ],
    [
      "a ghost with a field it does not take",
      {
        op: "hold",
        acts: [
          {
            key: "g",
            ghost: { markup: "<i></i>", box: { x: 0, y: 0, width: 1, height: 1 } },
            draw: {},
            hfId: null,
          },
        ],
        deferred: false,
        caretColor: "#fff",
      },
    ],
    [
      "a ghost with no finite box",
      {
        op: "hold",
        acts: [
          {
            key: "g",
            ghost: { markup: "<i></i>", box: { x: NaN, y: 0, width: 1, height: 1 } },
            draw: {},
          },
        ],
        deferred: false,
        caretColor: "#fff",
      },
    ],
    [
      "too many capture targets",
      { op: "capture", targets: Array(MAX_STAGE_ACTS + 1).fill({ key: "a", hfId: null }) },
    ],
    [
      "the same key twice in one hold",
      { op: "hold", acts: [act, act], deferred: false, caretColor: "#fff" },
    ],
    [
      "a style it does not draw",
      { op: "frame", draws: [{ key: "a", draw: { styles: { width: "1px" } } }] },
    ],
    [
      "a colour through var()",
      { op: "frame", draws: [{ key: "a", draw: { styles: { color: "var(--x)" } } }] },
    ],
    [
      "a nested colour call",
      { op: "frame", draws: [{ key: "a", draw: { styles: { color: "rgb(url(x))" } } }] },
    ],
    [
      "a background picture",
      {
        op: "frame",
        draws: [{ key: "a", draw: { styles: { "background-image": "url(https://x/y.png)" } } }],
      },
    ],
    [
      "a shadow through url()",
      { op: "frame", draws: [{ key: "a", draw: { styles: { "box-shadow": "url(x) 0 0" } } }] },
    ],
    [
      "a filter that escapes its declaration",
      { op: "frame", draws: [{ key: "a", draw: { styles: { filter: "none; color: red" } } }] },
    ],
    [
      "an oversized font",
      { op: "frame", draws: [{ key: "a", draw: { styles: { "font-size": "5000px" } } }] },
    ],
    [
      "an opacity above one",
      { op: "frame", draws: [{ key: "a", draw: { styles: { opacity: "1.5" } } }] },
    ],
  ])("rejects %s", (_, params) => {
    expect(parseStageActParams(params)).toBeNull();
  });
});

describe("stageAct", () => {
  it("holds, draws only borrowed properties, reads boxes after every write, and restores the inline style byte-equal", () => {
    document.body.innerHTML = `<div data-hf-id="hf-a" style="color: rgb(1, 2, 3); scale: 2">A</div>`;
    const el = document.querySelector<HTMLElement>("[data-hf-id=hf-a]")!;
    const before = el.style.cssText;
    sized(el);
    const port = fakePort();
    const held = run(
      hold([
        {
          key: "hf-a",
          hfId: "hf-a",
          borrow: ["translate", "scale", "box-shadow"],
          draw: { translate: [4, -2] },
        },
      ]),
      port,
    );
    expect(held).toEqual({
      op: "hold",
      held: [
        { key: "hf-a", rect: { x: 10, y: 20, width: 100, height: 40 }, textStart: null, chars: 0 },
      ],
    });
    expect(el.style.translate).toBe("4px -2px");

    const drawn = run(
      parseStageActParams({
        op: "frame",
        draws: [
          {
            key: "hf-a",
            draw: {
              translate: [1, 1],
              scale: 1.04,
              styles: { "box-shadow": "0 14px 28px #18181b33", color: "rgb(9, 9, 9)" },
            },
          },
          { key: "gone", draw: {} },
        ],
      }),
      port,
    );
    expect(drawn).toEqual({
      op: "frame",
      rects: [{ key: "hf-a", rect: { x: 10, y: 20, width: 100, height: 40 } }],
    });
    // Its own scale grown, not replaced; jsdom folds the calc.
    expect(["calc(2 * 1.04)", "calc(2.08)"]).toContain(el.style.scale);
    expect(el.style.color).toBe("rgb(1, 2, 3)");

    expect(run(parseStageActParams({ op: "restore", keys: null }), port)).toEqual({
      op: "restore",
      restored: 1,
    });
    expect(el.style.cssText).toBe(before);
  });

  it("types an element's own text back by whole graphemes behind a caret and gives it back", () => {
    document.body.innerHTML = `<p data-hf-id="hf-t">Hi 👋🏽<b>x</b></p>`;
    const el = document.querySelector<HTMLElement>("[data-hf-id=hf-t]")!;
    const before = el.innerHTML;
    const port = fakePort();
    const held = run(
      hold([{ key: "hf-t", hfId: "hf-t", borrow: [], draw: {}, typing: { hidden: true } }]),
      port,
    );
    expect(held.op === "hold" && held.held[0]?.chars).toBe(4);
    expect(el.style.opacity).toBe("0");
    expect(el.firstChild?.textContent).toBe("");

    run(parseStageActParams({ op: "frame", draws: [{ key: "hf-t", draw: { typed: 3 } }] }), port);
    expect(el.firstChild?.textContent).toBe("Hi ");
    expect(el.style.opacity).toBe("");
    expect(el.querySelector("i")?.style.visibility).toBe("");
    run(parseStageActParams({ op: "frame", draws: [{ key: "hf-t", draw: { typed: 4 } }] }), port);
    expect(el.querySelector("i")).toBeNull();

    run(parseStageActParams({ op: "restore", keys: ["hf-t"] }), port);
    expect(el.innerHTML).toBe(before);
  });

  it("gives a hidden typed element its own opacity back even when the act borrowed opacity too", () => {
    document.body.innerHTML = `<p data-hf-id="hf-t" style="opacity: 0.8">Hi</p>`;
    const el = document.querySelector<HTMLElement>("[data-hf-id=hf-t]")!;
    const port = fakePort();
    run(
      hold([
        { key: "hf-t", hfId: "hf-t", borrow: ["opacity"], draw: {}, typing: { hidden: true } },
      ]),
      port,
    );
    run(parseStageActParams({ op: "restore", keys: null }), port);
    expect(el.style.opacity).toBe("0.8");
  });

  it("does not hold typing for an element with no own text", () => {
    document.body.innerHTML = `<p data-hf-id="hf-e"><b>x</b></p>`;
    expect(
      run(
        hold([{ key: "hf-e", hfId: "hf-e", borrow: [], draw: {}, typing: { hidden: false } }]),
        fakePort(),
      ),
    ).toEqual({ op: "hold", held: [] });
  });

  it("holds a deferred element the moment it shows, before paint, and tells the parent", async () => {
    document.body.innerHTML = `<div data-hf-id="hf-d" style="display: none">D</div>`;
    const el = document.querySelector<HTMLElement>("[data-hf-id=hf-d]")!;
    const port = fakePort();
    expect(
      run(
        hold(
          [{ key: "hf-d", hfId: "hf-d", borrow: ["opacity"], draw: { styles: { opacity: "0" } } }],
          true,
        ),
        port,
      ),
    ).toEqual({ op: "hold", held: [] });
    expect(el.style.opacity).toBe("");
    sized(el);
    el.style.display = "block";
    await vi.waitFor(() => expect(el.style.opacity).toBe("0"));
    const pushed = port.postMessage.mock.calls
      .map(([data]) => stageActReadyEvent(data, V))
      .find(Boolean);
    expect(pushed?.held.map((one) => one.key)).toEqual(["hf-d"]);
  });

  it("reports a key already held when asked ready again, so a lost reply is recovered", () => {
    document.body.innerHTML = `<div data-hf-id="hf-a">A</div>`;
    sized(document.querySelector("div")!);
    const port = fakePort();
    run(hold([{ key: "hf-a", hfId: "hf-a", borrow: ["opacity"], draw: {} }]), port);
    const ready = run(parseStageActParams({ op: "ready", keys: ["hf-a", "gone"] }), port);
    expect(ready.op === "ready" && ready.held.map((one) => one.key)).toEqual(["hf-a"]);
  });

  it("drops a deferred typing act that cannot type, instead of retrying it on every change", async () => {
    document.body.innerHTML = `<p data-hf-id="hf-e"><b>x</b></p><div id="other"></div>`;
    const el = document.querySelector<HTMLElement>("[data-hf-id=hf-e]")!;
    sized(el);
    const port = fakePort();
    const typing = { key: "hf-e", hfId: "hf-e", borrow: [], draw: {}, typing: { hidden: true } };
    expect(run(hold([typing], true), port)).toEqual({ op: "hold", held: [] });
    el.prepend("Now text");
    document.getElementById("other")!.textContent = "changed";
    await Promise.resolve();
    expect(el.style.opacity).toBe("");
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it("drops a deferred typing act whose element shows with no text to type", async () => {
    document.body.innerHTML = `<p data-hf-id="hf-e" style="display: none"><b>x</b></p>`;
    const el = document.querySelector<HTMLElement>("[data-hf-id=hf-e]")!;
    const port = fakePort();
    const typing = { key: "hf-e", hfId: "hf-e", borrow: [], draw: {}, typing: { hidden: true } };
    run(hold([typing], true), port);
    sized(el);
    el.style.display = "block";
    await Promise.resolve();
    el.prepend("Now text");
    await Promise.resolve();
    expect(el.style.opacity).toBe("");
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it("stops watching for deferred elements at the cap", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div data-hf-id="hf-d" style="display: none">D</div>`;
    const el = document.querySelector<HTMLElement>("[data-hf-id=hf-d]")!;
    run(
      hold(
        [{ key: "hf-d", hfId: "hf-d", borrow: ["opacity"], draw: { styles: { opacity: "0" } } }],
        true,
      ),
      fakePort(),
    );
    vi.advanceTimersByTime(STAGE_HOLD_WATCH_MS);
    sized(el);
    el.style.display = "block";
    await Promise.resolve();
    expect(el.style.opacity).toBe("");
  });

  it("forwards the person's input only while it holds, and ignores another port's draws", () => {
    document.body.innerHTML = `<div data-hf-id="hf-a">A</div>`;
    const port = fakePort();
    run(
      hold([
        { key: "hf-a", hfId: "hf-a", borrow: ["opacity"], draw: { styles: { opacity: "0.5" } } },
      ]),
      port,
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", metaKey: true }));
    expect(stageInputEvent(port.postMessage.mock.calls[0]?.[0], V)).toEqual({
      v: V,
      event: "stage-input",
      type: "keydown",
      key: "c",
      metaKey: true,
      ctrlKey: false,
    });
    expect(
      run(
        parseStageActParams({
          op: "frame",
          draws: [{ key: "hf-a", draw: { styles: { opacity: "1" } } }],
        }),
        fakePort(),
      ),
    ).toEqual({ op: "frame", rects: [] });

    run(parseStageActParams({ op: "restore", keys: null }), port);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    expect(port.postMessage).toHaveBeenCalledTimes(1);
  });

  it("gives everything back when a new hold starts and when the agent is disposed", () => {
    document.body.innerHTML = `<div data-hf-id="hf-a">A</div><div data-hf-id="hf-b">B</div>`;
    const [a, b] = [...document.querySelectorAll<HTMLElement>("div")];
    const port = fakePort();
    run(
      hold([
        { key: "hf-a", hfId: "hf-a", borrow: ["opacity"], draw: { styles: { opacity: "0" } } },
      ]),
      port,
    );
    run(
      hold([
        { key: "hf-b", hfId: "hf-b", borrow: ["opacity"], draw: { styles: { opacity: "0" } } },
      ]),
      port,
    );
    expect([a!.style.opacity, b!.style.opacity]).toEqual(["", "0"]);
    installEditingAgent(window).dispose();
    expect(b!.style.opacity).toBe("");
  });
});

describe("removed ghosts", () => {
  const box = { x: 40, y: 50, width: 10, height: 10 };

  it("captures a subtree with its computed look and without its identity, and stands it back as a fixed, inert ghost", () => {
    document.body.innerHTML = `<div data-hf-id="hf-r" id="r" style="color: rgb(5, 6, 7)"><img src="a.png"><span>Gone</span></div>`;
    const [ghost] = captureStageGhosts(document, [{ key: "hf-r", hfId: "hf-r" }]);
    expect(ghost?.key).toBe("hf-r");
    expect(ghost?.markup).not.toMatch(/data-hf-id|id="r"/);
    expect(ghost?.markup).toContain("color: rgb(5, 6, 7)");

    document.body.innerHTML = "";
    const port = fakePort();
    run(
      hold([
        {
          key: "hf-r",
          ghost: { markup: ghost!.markup, box },
          draw: { styles: { opacity: "0.5" } },
        },
      ]),
      port,
    );
    const stood = document.body.firstElementChild as HTMLElement;
    expect(stood.getAttribute("aria-hidden")).toBe("true");
    expect([
      stood.style.position,
      stood.style.left,
      stood.style.top,
      stood.style.pointerEvents,
      stood.style.opacity,
    ]).toEqual(["fixed", "40px", "50px", "none", "0.5"]);
    run(parseStageActParams({ op: "restore", keys: null }), port);
    expect(document.body.children.length).toBe(0);
  });

  it("stands back a picture and nested elements exactly as the frame it left had them, as open mode's import does", () => {
    document.body.innerHTML = `<figure data-hf-id="hf-f"><img src="p.png" alt="P"><figcaption><b>Big</b> <i>cat</i><svg viewBox="0 0 4 4"><circle r="2"></circle></svg></figcaption></figure>`;
    const open = document.querySelector("figure")!.cloneNode(true) as HTMLElement;
    const [ghost] = captureStageGhosts(document, [{ key: "hf-f", hfId: "hf-f" }]);
    document.body.innerHTML = "";
    run(hold([{ key: "hf-f", ghost: { markup: ghost!.markup, box }, draw: {} }]), fakePort());
    expect(document.body.firstElementChild!.innerHTML).toBe(open.innerHTML);
  });

  it("leaves out a subtree over the cap and a key it cannot find", () => {
    document.body.innerHTML = `<p data-hf-id="hf-big">${"x".repeat(70_000)}</p>`;
    expect(
      captureStageGhosts(document, [
        { key: "hf-big", hfId: "hf-big" },
        { key: "9", hfId: null },
      ]),
    ).toEqual([]);
  });
});
