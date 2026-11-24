import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installEditingAgent } from "./editingAgent";
import { handleFor } from "./editingHandles";
import { PREVIEW_FOR_ANOTHER_SITE_META, STUDIO_PREVIEW_MARK_META } from "../studioPreviewMark";

const CONNECT = { source: "hf-parent", type: "editing-connect", v: 1 };
const H = "0123456789abcdef:1";
const studioMark = document.createElement("meta");
studioMark.name = STUDIO_PREVIEW_MARK_META;
document.head.append(studioMark);

function frameWindow(): Window {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  return iframe.contentWindow!;
}

function post(source: Window | null, data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { source, data }));
}

function ask(port: MessagePort, data: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    port.onmessage = (event) => resolve(event.data);
    port.postMessage(data);
  });
}

describe("installEditingAgent", () => {
  let parent: Window;
  let handoff: ReturnType<typeof vi.fn>;
  let agent: { dispose: () => void };

  beforeEach(() => {
    parent = frameWindow();
    handoff = vi.fn();
    parent.postMessage = handoff as unknown as Window["postMessage"];
    agent = installEditingAgent(parent);
  });
  afterEach(() => {
    agent.dispose();
    for (const call of handoff.mock.calls) (call[2] as MessagePort[])[0]?.close();
    document.body.innerHTML = "";
    delete window.__clipManifest;
    delete window.__clipTree;
    delete window.__player;
    delete window.__hfStartupError;
    delete window.__hfWaitForSeekCompletion;
    delete window.__hf;
    Reflect.deleteProperty(window, "__hfPreviewErrors");
  });

  const connectedPort = (): MessagePort => {
    post(parent, CONNECT);
    return (handoff.mock.calls[0][2] as MessagePort[])[0];
  };

  it("hands a port to the parent on its connect", () => {
    post(parent, CONNECT);
    expect(handoff).toHaveBeenCalledOnce();
    const [message, targetOrigin, transfer] = handoff.mock.calls[0];
    expect(message).toEqual({ source: "hf-preview", type: "editing-port", v: 1 });
    expect(targetOrigin).toBe("*");
    expect(transfer).toHaveLength(1);
  });

  // fails without the fix: the plugin preload ran before the handoff, so a page it threw on never got a port.
  it("hands the port over before the optional plugin preload", () => {
    Object.defineProperty(window, "gsap", {
      configurable: true,
      get: () => {
        throw new Error("page gsap getter");
      },
    });
    const reported = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", reported);
    try {
      post(parent, CONNECT);
      expect(handoff).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("error", reported);
      Reflect.deleteProperty(window, "gsap");
    }
  });

  it("hands a fresh port to each later connect from the parent and keeps the earlier one working", async () => {
    const old = connectedPort();
    post(parent, CONNECT);
    expect(handoff).toHaveBeenCalledTimes(2);
    const fresh = (handoff.mock.calls[1][2] as MessagePort[])[0];
    expect(fresh).not.toBe(old);
    expect(await ask(old, { v: 1, id: 1, kind: "hello" })).toMatchObject({ id: 1, ok: true });
    expect(await ask(fresh, { v: 1, id: 2, kind: "hello" })).toMatchObject({ id: 2, ok: true });
  });

  it("closes every port it handed over when disposed", async () => {
    const first = connectedPort();
    post(parent, CONNECT);
    const second = (handoff.mock.calls[1][2] as MessagePort[])[0];
    const closed = [first, second].map(
      (port) => new Promise<void>((resolve) => port.addEventListener("close", () => resolve())),
    );
    agent.dispose();
    await Promise.all(closed);
  });

  it("ignores a connect from the page itself or another frame, without using up the handoff", () => {
    post(window, CONNECT);
    post(frameWindow(), CONNECT);
    post(null, CONNECT);
    post(parent, { ...CONNECT, v: 2 });
    post(parent, { ...CONNECT, source: "hf-preview" });
    expect(handoff).not.toHaveBeenCalled();
    post(parent, CONNECT);
    expect(handoff).toHaveBeenCalledOnce();
  });

  it("keeps the parent's port when another frame asks after it", async () => {
    const port = connectedPort();
    post(frameWindow(), CONNECT);
    post(window, CONNECT);
    expect(handoff).toHaveBeenCalledOnce();
    expect(await ask(port, { v: 1, id: 1, kind: "hello" })).toMatchObject({ id: 1, ok: true });
  });

  it("never hands off on a top-level page, where the page is its own parent", () => {
    const selfPost = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const topLevel = installEditingAgent(window);
    try {
      post(window, CONNECT);
      expect(selfPost).not.toHaveBeenCalled();
    } finally {
      topLevel.dispose();
      selfPost.mockRestore();
    }
  });

  it("never hands off in a document its server answered to another site", () => {
    const mark = document.createElement("meta");
    mark.name = PREVIEW_FOR_ANOTHER_SITE_META;
    document.head.appendChild(mark);
    try {
      post(parent, CONNECT);
      expect(handoff).not.toHaveBeenCalled();
    } finally {
      mark.remove();
    }
    post(parent, CONNECT);
    expect(handoff).toHaveBeenCalledOnce();
  });

  it("never hands off in a document Studio's preview server did not mark", () => {
    studioMark.remove();
    try {
      post(parent, CONNECT);
      expect(handoff).not.toHaveBeenCalled();
    } finally {
      document.head.append(studioMark);
    }
    post(parent, CONNECT);
    expect(handoff).toHaveBeenCalledOnce();
  });

  it("stops listening for a connect once disposed", () => {
    agent.dispose();
    post(parent, CONNECT);
    expect(handoff).not.toHaveBeenCalled();
  });

  it("answers each request kind from the runtime's state", async () => {
    const setLoopStart = vi.fn();
    const manifest = { source: "hf-preview", type: "timeline", clips: [] };
    window.__clipManifest = manifest as unknown as Window["__clipManifest"];
    window.__player = {} as Window["__player"];
    window.__hfStartupError = "boom";
    window.__hfWaitForSeekCompletion = () => Promise.resolve();
    window.__hf = { setLoopStart };
    const leaf = { id: "b", parentId: "a", children: [], element: document.body };
    window.__clipTree = {
      roots: [{ id: "a", parentId: null, children: [leaf], element: document.body }],
    };
    const port = connectedPort();

    expect(await ask(port, { v: 1, id: 1, kind: "hello" })).toEqual({
      v: 1,
      id: 1,
      ok: true,
      result: {
        version: 1,
        kinds: [
          "hello",
          "runtime-snapshot",
          "wait-for-seek",
          "set-loop-start",
          "computed-styles",
          "authored-styles",
          "font-faces",
          "elements-at-point",
          "pointer-targets",
          "describe",
          "ancestors",
          "query",
          "geometry",
          "layers",
          "draft",
          "gesture-start",
          "gesture-base",
          "console-errors",
          "watch-keys",
          "restore-attributes",
          "caption-words",
          "caption-transform",
          "color-grading-status",
          "color-grading-previews",
          "color-grading-playback",
          "watch-geometry",
          "audio-meter",
          "document-markup",
          "set-audio-group-attribute",
          "assign-audio-group",
          "gsap-snapshot",
          "motion-path-home",
          "max-z-index",
          "crop-lift",
          "edit-element",
          "stacking-family",
          "gsap-set",
          "patch-tweens",
          "soft-reload",
          "hold-scenes",
          "mark-scenes-stale",
          "swap-scenes",
          "live-retime",
          "assets-unloaded",
          "text-edit",
          "serve-paused-frames",
        ],
      },
    });
    expect((await ask(port, { v: 1, id: 2, kind: "runtime-snapshot", params: {} })).result).toEqual(
      {
        playerReady: true,
        startupError: "boom",
        clipManifest: manifest,
        clipParents: [["b", "a"]],
      },
    );
    expect((await ask(port, { v: 1, id: 3, kind: "wait-for-seek" })).result).toEqual({
      waited: true,
    });
    const loop = await ask(port, { v: 1, id: 4, kind: "set-loop-start", params: { seconds: 2 } });
    expect(loop.result).toEqual({ applied: true });
    expect(setLoopStart).toHaveBeenCalledWith(2);
  });

  it.each([
    [null, null, "malformed"],
    ["hello", null, "malformed"],
    [{ v: 1, kind: "hello" }, null, "malformed"],
    [{ v: 1, id: -1, kind: "hello" }, null, "malformed"],
    [{ v: 1, id: 1.5, kind: "hello" }, null, "malformed"],
    [{ v: 2, id: 5, kind: "hello" }, 5, "unsupported-version"],
    [{ id: 6, kind: "hello" }, 6, "unsupported-version"],
    [{ v: 1, id: 7, kind: "__proto__" }, 7, "unknown-kind"],
    [{ v: 1, id: 8, kind: "toString" }, 8, "unknown-kind"],
    [{ v: 1, id: 9, kind: "hello", params: { extra: 1 } }, 9, "invalid-params"],
    [{ v: 1, id: 10, kind: "hello", params: [] }, 10, "invalid-params"],
    [{ v: 1, id: 11, kind: "set-loop-start" }, 11, "invalid-params"],
    [{ v: 1, id: 12, kind: "set-loop-start", params: { seconds: -1 } }, 12, "invalid-params"],
    [{ v: 1, id: 13, kind: "set-loop-start", params: { seconds: "2" } }, 13, "invalid-params"],
    [{ v: 1, id: 14, kind: "set-loop-start", params: { seconds: NaN } }, 14, "invalid-params"],
    [
      { v: 1, id: 15, kind: "set-loop-start", params: { seconds: 1, extra: 1 } },
      15,
      "invalid-params",
    ],
    [{ v: 1, id: 16, kind: "computed-styles", params: { selector: "p" } }, 16, "invalid-params"],
    ...[
      { selector: "p", properties: ["font-size"] },
      { handle: H, properties: [] },
      { handle: H, properties: ["font-size;"] },
      { handle: H, properties: Array(65).fill("font-size") },
      { handle: "not a handle", properties: ["font-size"] },
      { handle: H, properties: ["font-size"], extra: 1 },
    ].map((params, index) => [
      { v: 1, id: 900 + index, kind: "authored-styles", params },
      900 + index,
      "invalid-params",
    ]),
    [{ v: 1, id: 910, kind: "font-faces", params: { all: true } }, 910, "invalid-params"],
    [{ v: 1, id: 160, kind: "console-errors", params: {} }, 160, "invalid-params"],
    [{ v: 1, id: 161, kind: "console-errors", params: { from: -1 } }, 161, "invalid-params"],
    [{ v: 1, id: 162, kind: "console-errors", params: { from: 1.5 } }, 162, "invalid-params"],
    [
      { v: 1, id: 17, kind: "computed-styles", params: { selector: "", properties: [] } },
      17,
      "invalid-params",
    ],
    [
      { v: 1, id: 18, kind: "computed-styles", params: { selector: "p", properties: ["color;"] } },
      18,
      "invalid-params",
    ],
    [
      { v: 1, id: 19, kind: "computed-styles", params: { selector: "p", properties: [1] } },
      19,
      "invalid-params",
    ],
    [
      {
        v: 1,
        id: 20,
        kind: "computed-styles",
        params: { selector: "p", properties: Array(65).fill("color") },
      },
      20,
      "invalid-params",
    ],
    [
      {
        v: 1,
        id: 21,
        kind: "computed-styles",
        params: { selector: "p".repeat(2001), properties: ["color"] },
      },
      21,
      "invalid-params",
    ],
    [
      {
        v: 1,
        id: 22,
        kind: "computed-styles",
        params: { selector: "p", properties: ["color"], extra: 1 },
      },
      22,
      "invalid-params",
    ],
    ...[
      { y: 1 },
      { x: 1, y: Number.NaN },
      { x: "1", y: 1 },
      { x: 1, y: Infinity },
      { x: 1, y: 2, z: 3 },
    ].flatMap((params, index) =>
      (["elements-at-point", "pointer-targets"] as const).map((kind, k) => [
        { v: 1, id: 30 + index * 2 + k, kind, params },
        30 + index * 2 + k,
        "invalid-params",
      ]),
    ),
    ...[
      {},
      { handles: [] },
      { handles: [1] },
      { handles: ["1"] },
      { handles: ["0123456789abcdef"] },
      { handles: ["0123456789abcdef:0"] },
      { handles: ["0123456789abcdef:01"] },
      { handles: ["0123456789ABCDEF:1"] },
      { handles: ["0123456789abcde:1"] },
      { handles: ["0123456789abcdef:1 "] },
      { handles: [`0123456789abcdef:${"9".repeat(16)}`] },
      { handles: Array(257).fill("0123456789abcdef:1") },
      { handles: ["0123456789abcdef:1"], extra: 1 },
      { handles: { 0: "0123456789abcdef:1", length: 1 } },
    ].map((params, index) => [
      { v: 1, id: 40 + index, kind: "describe", params },
      40 + index,
      "invalid-params",
    ]),
    ...[
      { handle: "0123456789abcdef:1" },
      { handle: "1", properties: ["color"] },
      { handle: 1, properties: ["color"] },
      { handle: "0123456789abcdef:1", selector: "p", properties: ["color"] },
      { handle: "0123456789abcdef:1", properties: ["color;"] },
    ].map((params, index) => [
      { v: 1, id: 70 + index, kind: "computed-styles", params },
      70 + index,
      "invalid-params",
    ]),
    ...[
      {},
      { handles: [] },
      { handles: ["1"] },
      { handles: Array(257).fill("0123456789abcdef:1") },
    ].map((params, index) => [
      { v: 1, id: 80 + index, kind: "ancestors", params },
      80 + index,
      "invalid-params",
    ]),
    ...[
      {},
      { selector: "" },
      { selector: 1 },
      { selector: "p".repeat(2001) },
      { selector: "p", x: 1 },
    ].map((params, index) => [
      { v: 1, id: 90 + index, kind: "query", params },
      90 + index,
      "invalid-params",
    ]),
    ...[
      {},
      { handles: [] },
      { handles: ["1"] },
      { handles: [1] },
      { handles: Array(257).fill("0123456789abcdef:1") },
      { handles: ["0123456789abcdef:1"], extra: 1 },
      { children: "0123456789abcdef:1" },
      { handles: ["0123456789abcdef:1"], children: undefined },
      { handles: ["0123456789abcdef:1"], children: null },
      { handles: ["0123456789abcdef:1"], children: true },
      { handles: ["0123456789abcdef:1"], children: ["0123456789abcdef:1"] },
      { handles: ["0123456789abcdef:1"], children: "0123456789abcdef:0" },
    ].map((params, index) => [
      { v: 1, id: 100 + index, kind: "geometry", params },
      100 + index,
      "invalid-params",
    ]),
    ...[
      { group: null },
      { group: "0123456789abcdef:0" },
      { group: ["0123456789abcdef:1"] },
      { group: "0123456789abcdef:1", max: 5 },
      { scope: "0123456789abcdef:1" },
      { offset: -1 },
      { offset: 1.5 },
      { offset: "2" },
    ].map((params, index) => [
      { v: 1, id: 130 + index, kind: "layers", params },
      130 + index,
      "invalid-params",
    ]),
    ...[
      {},
      { drafts: [] },
      { drafts: Array(257).fill({ handle: H, end: "keep" }) },
      { drafts: [{ handle: "1", end: "keep" }] },
      { drafts: [{ handle: H, end: "drop" }] },
      { drafts: [{ handle: H, end: "keep", translate: null }] },
      { drafts: [{ handle: H, translate: null }] },
      { drafts: [{ handle: H, translate: { x: 1 }, size: null }] },
      { drafts: [{ handle: H, translate: { x: "1", y: 0 }, size: null }] },
      { drafts: [{ handle: H, translate: { x: Infinity, y: 0 }, size: null }] },
      { drafts: [{ handle: H, translate: { x: 1e6, y: 0 }, size: null }] },
      { drafts: [{ handle: H, translate: { x: 1, y: 0, route: "css" }, size: null }] },
      { drafts: [{ handle: H, translate: { x: 1e6, y: 0, route: "gsap" }, size: null }] },
      { drafts: [{ handle: H, translate: null, size: { width: -1, height: 2 } }] },
      ...[
        { seconds: 1, values: {} },
        { seconds: -1, values: { opacity: 1 } },
        { seconds: 1, values: { color: 1 } },
        { seconds: 1, values: { opacity: "1" } },
        { seconds: 1, values: { opacity: 1 }, extra: 1 },
      ].map((props) => ({ drafts: [{ handle: H, translate: null, size: null, props }] })),
      {
        drafts: [
          {
            handle: H,
            translate: { x: 1, y: 0, route: "gsap" },
            size: null,
            props: { seconds: 1, values: { x: 2 } },
          },
        ],
      },
      { drafts: [{ handle: H, translate: null, size: { width: 1, height: 2, depth: 3 } }] },
      { drafts: [{ handle: H, translate: null, size: null, rotate: { angle: 1 } }] },
      { drafts: [{ handle: H, translate: null, size: null, rotate: { angle: 1, route: "x" } }] },
      {
        drafts: [{ handle: H, translate: null, size: null, rotate: { angle: "1", route: "css" } }],
      },
      {
        drafts: [{ handle: H, translate: null, size: null, rotate: { angle: 1e6, route: "css" } }],
      },
      {
        drafts: [{ handle: H, translate: null, size: null, rotate: { angle: NaN, route: "gsap" } }],
      },
      {
        drafts: [
          { handle: H, translate: null, size: null, rotate: { angle: 1, route: "transform" } },
        ],
      },
      ...[
        "url(x.png)",
        "rotate(1deg);color:red",
        "translate(1px",
        "scale(2) /* x",
        "x".repeat(513),
      ].map((value) => ({
        drafts: [
          {
            handle: H,
            translate: null,
            size: null,
            rotate: { angle: 1, route: "transform", value },
          },
        ],
      })),
    ].map((params, index) => [
      { v: 1, id: 600 + index, kind: "draft", params },
      600 + index,
      "invalid-params",
    ]),
    ...[{}, { handles: [] }, { handles: ["1"] }, { handles: Array(257).fill(H) }].map(
      (params, index) => [
        { v: 1, id: 170 + index, kind: "gesture-start", params },
        170 + index,
        "invalid-params",
      ],
    ),
    ...[
      {},
      { combos: "Space" },
      { combos: [1] },
      { combos: ["ctrl+alt+x"] },
      { combos: ["k".repeat(65)] },
      { combos: Array(33).fill("k") },
      { combos: [], extra: 1 },
    ].map((params, index) => [
      { v: 1, id: 180 + index, kind: "watch-keys", params },
      180 + index,
      "invalid-params",
    ]),
    ...[{}, { handles: ["1"] }, { handles: Array(33).fill(H) }, { handles: [], extra: 1 }].map(
      (params, index) => [
        { v: 1, id: 900 + index, kind: "watch-geometry", params },
        900 + index,
        "invalid-params",
      ],
    ),
    ...[["--"], ["--a b"], ["--a;b"], ["--a:b"], ["Color"], ["-x"], ["--" + "a".repeat(255)]].map(
      (properties, index) => [
        { v: 1, id: 60 + index, kind: "computed-styles", params: { selector: "p", properties } },
        60 + index,
        "invalid-params",
      ],
    ),
    ...[{}, { words: 3 }, { words: [-1] }, { words: [1.5] }, { words: [100_000] }].map(
      (params, index) => [
        { v: 1, id: 190 + index, kind: "caption-words", params },
        190 + index,
        "invalid-params",
      ],
    ),
    ...[
      { entries: [] },
      { entries: Array(257).fill({ group: 0, word: 0 }) },
      { entries: [{ group: -1, word: 0 }] },
      { entries: [{ group: 0, word: 0, extra: 1 }] },
      { entries: [{ group: 0, word: 0, set: { x: 100_001 } }] },
      { entries: [{ group: 0, word: 0, set: { x: Infinity } }] },
      { entries: [{ group: 0, word: 0, set: { x: undefined } }] },
      { entries: [{ group: 0, word: 0, set: { skew: 1 } }] },
      { entries: [{ group: 0, word: 0, set: [] }] },
    ].map((params, index) => [
      { v: 1, id: 200 + index, kind: "caption-transform", params },
      200 + index,
      "invalid-params",
    ]),
  ])("rejects %j with a typed error", async (request, id, code) => {
    const setLoopStart = vi.fn();
    window.__hf = { setLoopStart };
    const reply = await ask(connectedPort(), request);
    expect(reply).toMatchObject({ v: 1, id, ok: false, error: { code } });
    expect(setLoopStart).not.toHaveBeenCalled();
  });

  describe("console errors", () => {
    const errorsFrom = async (port: MessagePort, from: number) =>
      (await ask(port, { v: 1, id: 30, kind: "console-errors", params: { from } })).result;
    let logged: unknown[][];
    beforeEach(() => {
      logged = [];
      vi.spyOn(console, "error").mockImplementation((...args) => void logged.push(args));
    });
    afterEach(() => {
      agent.dispose();
      vi.restoreAllMocks();
    });

    it("starts from what the page raised before it was asked, then keeps what follows", async () => {
      Reflect.set(window, "__hfPreviewErrors", ["Uncaught Error: early"]);
      const port = connectedPort();
      expect(await errorsFrom(port, 0)).toEqual({
        errors: ["Uncaught Error: early"],
        truncated: false,
      });

      console.error("GSAP target", new Error("not found"), 3);
      console.error("GET /favicon.ico 404");
      window.dispatchEvent(new ErrorEvent("error", { message: "Uncaught TypeError: x" }));

      expect(await errorsFrom(port, 1)).toEqual({
        errors: ["GSAP target not found 3", "Uncaught TypeError: x"],
        truncated: false,
      });
      expect(logged).toHaveLength(2);
    });

    it("sends a long list in pages", async () => {
      const raised = Array.from({ length: 2_050 }, (_, i) => `e${i}`);
      Reflect.set(window, "__hfPreviewErrors", raised);
      const port = connectedPort();
      const first = (await errorsFrom(port, 0)) as { errors: string[]; truncated: boolean };
      expect(first.errors).toHaveLength(2_048);
      expect(first.truncated).toBe(true);
      expect(await errorsFrom(port, 2_048)).toEqual({
        errors: ["e2048", "e2049"],
        truncated: false,
      });
    });

    it("leaves the page's console alone until asked, and puts it back when disposed", async () => {
      const own = console.error;
      const port = connectedPort();
      expect(console.error).toBe(own);
      await errorsFrom(port, 0);
      expect(console.error).not.toBe(own);
      agent.dispose();
      expect(console.error).toBe(own);
    });
  });

  it("re-runs a sent script through the port, and refuses a request carrying anything extra", async () => {
    const script = `var __timelines = {}; __timelines["main"] = 1;`;
    document.body.innerHTML = `<div data-composition-id="main"></div><script>${script}</script>`;
    const frame = window as unknown as Record<string, unknown>;
    Object.assign(frame, { gsap: { set: () => {} }, __timelines: { main: {} } });
    frame.__hfForceTimelineRebind = () => {};
    const port = connectedPort();
    const params = { script, time: 0, sets: [], authored: [], timing: [], restore: [] };

    const extra = { ...params, keys: ["main"] };
    expect(await ask(port, { v: 1, id: 1, kind: "soft-reload", params: extra })).toMatchObject({
      id: 1,
      ok: false,
    });
    expect(document.body.querySelector("script")?.textContent).toBe(script);
    // The sent script registers on a local, so the frame reads its timeline empty for now.
    expect(await ask(port, { v: 1, id: 2, kind: "soft-reload", params })).toMatchObject({
      id: 2,
      ok: true,
      result: { result: "verify-failed" },
    });
    expect(document.body.querySelector("script")?.textContent).toBe(`(function(){${script}\n})();`);
    for (const key of ["gsap", "__timelines", "__hfForceTimelineRebind", "__hfMotionPathWaiters"])
      delete frame[key];
    document.head.querySelector("script[src]")?.remove();
  });

  it("holds and swaps scenes through the port, and refuses a hold carrying anything extra", async () => {
    const hold = vi.fn(async () => {});
    window.__hfHoldScenes = hold;
    window.__hfSwapScenes = async () => {
      throw new Error("no scene changed");
    };
    const port = connectedPort();

    const extra = { names: ["intro"], holder: "frame" };
    expect(await ask(port, { v: 1, id: 1, kind: "hold-scenes", params: extra })).toMatchObject({
      ok: false,
    });
    expect(hold).not.toHaveBeenCalled();
    const held = await ask(port, {
      v: 1,
      id: 2,
      kind: "hold-scenes",
      params: { names: ["intro"] },
    });
    expect(held).toMatchObject({ ok: true, result: { held: true } });
    const swap = { html: "<p></p>", timeoutMs: 1000 };
    expect(await ask(port, { v: 1, id: 3, kind: "swap-scenes", params: swap })).toMatchObject({
      ok: true,
      result: { swapped: false, reason: "Error: no scene changed" },
    });
    delete window.__hfHoldScenes;
    delete window.__hfSwapScenes;
  });

  it("answers a live retime through the port, and refuses one carrying anything extra", async () => {
    const port = connectedPort();
    const tween = { selector: "#a", start: 1, duration: 1, wasStart: 0, wasDuration: 1 };
    const tweens = [{ ...tween, moved: true, source: 0 }];
    const plan = { key: "t", after: "x", time: 0, tweens, timing: [] };

    const extra = { ...plan, script: "x" };
    expect(await ask(port, { v: 1, id: 1, kind: "live-retime", params: extra })).toMatchObject({
      ok: false,
    });
    // No live script registers the timeline, so nothing can move.
    expect(await ask(port, { v: 1, id: 2, kind: "live-retime", params: plan })).toMatchObject({
      ok: true,
      result: { result: "unchanged" },
    });
  });

  // fails without the fix: the frame refused a turn drawn inside a translating transform, so it never turned.
  it("draws a turn inside a translating transform through the port", async () => {
    const port = connectedPort();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="spun" style="transform: translate(-50%, -50%)"></div>',
    );
    const spun = document.getElementById("spun")!;
    const value = "translate(-50%, -50%) rotate(20deg)";
    const rotate = { angle: 20, route: "transform", value };
    const drafts = [{ handle: handleFor(spun), translate: null, size: null, rotate }];
    expect(await ask(port, { v: 1, id: 1, kind: "draft", params: { drafts } })).toMatchObject({
      ok: true,
    });
    expect(spun.style.transform).toBe(value);
  });

  it("ends a drawn size and sets GSAP values in one request, the size ended first", async () => {
    document.body.innerHTML = `<div id="box"></div>`;
    const box = document.getElementById("box")!;
    const handle = handleFor(box);
    const widthAtSet: string[] = [];
    Object.assign(window, { gsap: { set: () => widthAtSet.push(box.style.width) } });
    const port = connectedPort();
    const size = { width: 307, height: 204 };
    const drawn = await ask(port, {
      v: 1,
      id: 1,
      kind: "draft",
      params: { drafts: [{ handle, translate: null, size }] },
    });
    expect(drawn).toMatchObject({ ok: true, result: { gsapSetTakesDrafts: true } });
    expect(box.style.width).toBe("307px");

    const ending = [{ handle, translate: null, size: null }];
    const props = { scaleX: 1.9, scaleY: 1.9 };
    const set = await ask(port, {
      v: 1,
      id: 2,
      kind: "gsap-set",
      params: { handle, props, drafts: ending },
    });
    const malformed = [{ handle, translate: null, size: "none" }];
    const refused = await ask(port, {
      v: 1,
      id: 3,
      kind: "gsap-set",
      params: { handle, props, drafts: malformed },
    });

    expect(set).toMatchObject({ id: 2, ok: true, result: { applied: true } });
    expect(widthAtSet).toEqual([""]);
    expect(refused).toMatchObject({ id: 3, ok: false, error: { code: "invalid-params" } });
    Reflect.deleteProperty(window, "gsap");
  });

  // fails without the fix: the frame refused a move routed through its GSAP, so a sealed drag drew a CSS translate.
  it("moves a GSAP-held element's x/y through the port", async () => {
    const port = connectedPort();
    document.body.insertAdjacentHTML("beforeend", '<div id="held"></div>');
    const held = document.getElementById("held")!;
    const position = { x: 40, y: 30 };
    Object.assign(window, {
      gsap: {
        getProperty: (_: Element, axis: "x" | "y") => position[axis],
        set: (_: Element, props: Partial<typeof position>) => Object.assign(position, props),
      },
    });
    const translate = { x: 35, y: 33, route: "gsap" };
    const drafts = [{ handle: handleFor(held), translate, size: null }];
    expect(await ask(port, { v: 1, id: 1, kind: "draft", params: { drafts } })).toMatchObject({
      ok: true,
    });
    expect(position).toEqual({ x: 35, y: 33 });
    Reflect.deleteProperty(window, "gsap");
  });

  it("answers computed styles for the element a selector names", async () => {
    document.body.innerHTML = `<p id="title" style="color: rgb(1, 2, 3); opacity: 0.5">Hi</p>
      <canvas data-hf-preview-video-canvas style="opacity: 0.25"></canvas>
      <video id="clip" data-hf-preview-video-frame style="opacity: 0"></video>`;
    const port = connectedPort();
    const ask_ = (id: number, selector: string, properties: string[]) =>
      ask(port, { v: 1, id, kind: "computed-styles", params: { selector, properties } });

    expect((await ask_(1, "#title", ["color", "opacity", "--unset"])).result).toEqual({
      styles: { color: "rgb(1, 2, 3)", opacity: "0.5" },
    });
    // A paused video's canvas carries its authored opacity.
    expect((await ask_(2, "#clip", ["opacity"])).result).toEqual({ styles: { opacity: "0.25" } });
    expect((await ask_(3, "#missing", ["color"])).result).toEqual({ styles: null });
    expect(await ask_(4, "p[", ["color"])).toMatchObject({
      id: 4,
      ok: false,
      error: { code: "failed" },
    });
  });

  it("reads custom properties whose names use any case or an underscore", async () => {
    document.body.innerHTML = `<p id="title" style="--Brand_Color: red; --x2: 4px">Hi</p>`;
    const properties = ["--Brand_Color", "--x2", "--é"];
    const reply = await ask(connectedPort(), {
      v: 1,
      id: 1,
      kind: "computed-styles",
      params: { selector: "#title", properties },
    });
    expect(reply).toMatchObject({ ok: true });
    expect(Object.keys((reply.result as { styles: object }).styles)).toEqual(
      expect.arrayContaining(["--Brand_Color", "--x2"]),
    );
  });

  it("patches a set tween through the port, and refuses a patch with an unknown field", async () => {
    document.body.innerHTML = `<div id="box"></div>`;
    const set = {
      vars: { x: 0 },
      targets: () => [document.getElementById("box")],
      duration: () => 0,
    };
    Object.assign(window, { __timelines: { main: { getChildren: () => [set], time: () => 0 } } });
    const port = connectedPort();
    const patch = { selector: "#box", change: { kind: "set", props: { x: 12 } } };

    const applied = await ask(port, {
      v: 1,
      id: 1,
      kind: "patch-tweens",
      params: { patches: [patch], seek: true },
    });
    const refused = await ask(port, {
      v: 1,
      id: 2,
      kind: "patch-tweens",
      params: { patches: [{ ...patch, script: "x" }], seek: true },
    });

    expect(applied).toMatchObject({ id: 1, ok: true, result: { patched: true } });
    expect(set.vars.x).toBe(12);
    expect(refused).toMatchObject({ id: 2, ok: false, error: { code: "invalid-params" } });
    Reflect.deleteProperty(window, "__timelines");
  });

  it("replies failed when a handler rejects or its result cannot be cloned", async () => {
    window.__hfWaitForSeekCompletion = () => Promise.reject(new Error("seek lost"));
    const port = connectedPort();
    expect(await ask(port, { v: 1, id: 1, kind: "wait-for-seek" })).toMatchObject({
      id: 1,
      ok: false,
      error: { code: "failed", message: "seek lost" },
    });
    window.__clipManifest = { clips: [() => {}] } as unknown as Window["__clipManifest"];
    expect(await ask(port, { v: 1, id: 2, kind: "runtime-snapshot" })).toMatchObject({
      id: 2,
      ok: false,
      error: { code: "failed" },
    });
  });

  describe("watch-keys", () => {
    const press = (type: string, init: KeyboardEventInit, target: EventTarget = document.body) => {
      const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const SPACE = { key: " ", code: "Space" };
    const forwarded = (type: string, key: string, code: string, repeat = false) => ({
      v: 1,
      event: "key",
      key: {
        type,
        key,
        code,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        repeat,
      },
    });
    // Port messages arrive in order, so everything sent before this reply has arrived by then.
    const received = async (port: MessagePort, seen: unknown[]) => {
      port.postMessage({ v: 1, id: 99, kind: "hello" });
      await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ id: 99 }));
      return seen.slice(0, -1);
    };
    const watch = (port: MessagePort, combos: string[], id = 1) =>
      ask(port, { v: 1, id, kind: "watch-keys", params: { combos } });
    const collect = (port: MessagePort) => {
      const seen: unknown[] = [];
      port.onmessage = (event) => seen.push(event.data);
      return seen;
    };

    it("cancels and forwards a watched combo outside the elements that own keys, and its keyup", async () => {
      document.body.innerHTML = `<input id="field" /><button id="go">Go</button>`;
      const port = connectedPort();
      expect(await watch(port, ["Space", "k"])).toMatchObject({
        ok: true,
        result: { watching: 2 },
      });
      const seen = collect(port);

      expect(press("keydown", SPACE)).toBe(true);
      expect(press("keydown", { ...SPACE, repeat: true })).toBe(true);
      expect(press("keydown", { key: "j", code: "KeyJ" })).toBe(false);
      expect(press("keydown", SPACE, document.getElementById("field")!)).toBe(false);
      expect(press("keydown", SPACE, document.getElementById("go")!)).toBe(false);
      expect(press("keyup", SPACE)).toBe(false);
      press("keyup", { key: "j", code: "KeyJ" });

      expect(await received(port, seen)).toEqual([
        forwarded("keydown", " ", "Space"),
        forwarded("keydown", " ", "Space", true),
        forwarded("keyup", " ", "Space"),
      ]);
    });

    it("leaves a key typed into a field inside a shadow root to the field", async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const field = host
        .attachShadow({ mode: "open" })
        .appendChild(document.createElement("input"));
      field.focus();
      const port = connectedPort();
      await watch(port, ["b"]);
      const seen = collect(port);

      const event = new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      field.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(await received(port, seen)).toEqual([]);
      host.remove();
    });

    it("leaves a key the film cancelled before it", async () => {
      const film = (event: Event) => event.preventDefault();
      window.addEventListener("keydown", film, true);
      try {
        const port = connectedPort();
        await watch(port, ["k"]);
        const seen = collect(port);
        press("keydown", { key: "k", code: "KeyK" });
        expect(await received(port, seen)).toEqual([]);
      } finally {
        window.removeEventListener("keydown", film, true);
      }
    });

    it("still forwards the keyup of a key held while the watch list changes", async () => {
      const port = connectedPort();
      await watch(port, ["k"]);
      const seen = collect(port);
      press("keydown", { key: "k", code: "KeyK" });
      await vi.waitFor(() => expect(seen).toEqual([forwarded("keydown", "k", "KeyK")]));
      expect(await watch(port, ["k", "j"], 2)).toMatchObject({ result: { watching: 2 } });
      const after = collect(port);
      press("keyup", { key: "k", code: "KeyK" });
      expect(await received(port, after)).toEqual([forwarded("keyup", "k", "KeyK")]);
    });

    it("stops on an empty list and when disposed", async () => {
      const port = connectedPort();
      await watch(port, ["k"]);
      expect(await watch(port, [], 2)).toMatchObject({ result: { watching: 0 } });
      expect(press("keydown", { key: "k", code: "KeyK" })).toBe(false);
      await watch(port, ["k"], 3);
      agent.dispose();
      expect(press("keydown", { key: "k", code: "KeyK" })).toBe(false);
    });
  });
});
