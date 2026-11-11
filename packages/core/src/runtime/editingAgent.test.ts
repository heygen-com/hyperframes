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

  it("hands one port to the parent, once", () => {
    post(parent, CONNECT);
    post(parent, CONNECT);
    expect(handoff).toHaveBeenCalledOnce();
    const [message, targetOrigin, transfer] = handoff.mock.calls[0];
    expect(message).toEqual({ source: "hf-preview", type: "editing-port", v: 1 });
    expect(targetOrigin).toBe("*");
    expect(transfer).toHaveLength(1);
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
        kinds: ["hello", "runtime-snapshot", "wait-for-seek", "set-loop-start"],
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
  ])("rejects %j with a typed error", async (request, id, code) => {
    const setLoopStart = vi.fn();
    window.__hf = { setLoopStart };
    const reply = await ask(connectedPort(), request);
    expect(reply).toMatchObject({ v: 1, id, ok: false, error: { code } });
    expect(setLoopStart).not.toHaveBeenCalled();
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
