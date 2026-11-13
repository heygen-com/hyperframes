import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installEditingAgent } from "./editingAgent";

const CONNECT = { source: "hf-parent", type: "editing-connect", v: 1 };

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
          "elements-at-point",
          "pointer-targets",
          "describe",
          "ancestors",
          "query",
          "geometry",
          "layers",
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
    ...[["--"], ["--a b"], ["--a;b"], ["--a:b"], ["Color"], ["-x"], ["--" + "a".repeat(255)]].map(
      (properties, index) => [
        { v: 1, id: 60 + index, kind: "computed-styles", params: { selector: "p", properties } },
        60 + index,
        "invalid-params",
      ],
    ),
  ])("rejects %j with a typed error", async (request, id, code) => {
    const setLoopStart = vi.fn();
    window.__hf = { setLoopStart };
    const reply = await ask(connectedPort(), request);
    expect(reply).toMatchObject({ v: 1, id, ok: false, error: { code } });
    expect(setLoopStart).not.toHaveBeenCalled();
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
});
