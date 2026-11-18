import { afterEach, describe, expect, it, vi } from "vitest";
import { installMarkedEditingAgent } from "./editingAgent.test-helpers";
import { createEditingPortClient, EditingPortError, type EditingPortClient } from "./editingPort";

type Listener = (event: Partial<MessageEvent>) => void;

/** A parent window whose message listener the test drives directly. */
function fakeHost() {
  let listener: Listener | null = null;
  const host = {
    addEventListener: (_type: string, fn: Listener) => (listener = fn),
    removeEventListener: vi.fn(() => (listener = null)),
  };
  return { host: host as unknown as Window, deliver: (e: Partial<MessageEvent>) => listener?.(e) };
}

function hostReachingEveryListenerOfADispatch() {
  const listeners = new Set<Listener>();
  const host = {
    addEventListener: (_type: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_type: string, fn: Listener) => listeners.delete(fn),
  };
  const deliver = (e: Partial<MessageEvent>) => [...listeners].forEach((fn) => fn(e));
  return { host: host as unknown as Window, deliver };
}

function previewFrame() {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const connects = vi.fn();
  iframe.contentWindow!.postMessage = connects as unknown as Window["postMessage"];
  return { iframe, frame: iframe.contentWindow!, connects };
}

const PORT_MESSAGE = { source: "hf-preview", type: "editing-port", v: 1 };
const CONNECT = { source: "hf-parent", type: "editing-connect", v: 1 };
const clients: EditingPortClient[] = [];
const ports: MessagePort[] = [];

function channel() {
  const pair = new MessageChannel();
  ports.push(pair.port1, pair.port2);
  return pair;
}

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  for (const port of ports.splice(0)) port.close();
  document.body.innerHTML = "";
});

describe("createEditingPortClient", () => {
  it("round-trips a request with the runtime agent", async () => {
    const { iframe, frame } = previewFrame();
    const { host, deliver } = fakeHost();
    // The preview's parent: what the agent sends is what the host receives.
    const parent = document.body.appendChild(document.createElement("iframe")).contentWindow!;
    parent.postMessage = ((data: unknown, _origin: string, transfer: MessagePort[]) => {
      ports.push(...transfer);
      deliver({ source: frame, data, ports: transfer });
    }) as Window["postMessage"];
    frame.postMessage = ((data: unknown) =>
      window.dispatchEvent(
        new MessageEvent("message", { source: parent, data }),
      )) as Window["postMessage"];
    const agent = installMarkedEditingAgent(parent);
    try {
      const client = createEditingPortClient({ iframe, host });
      clients.push(client);
      await client.ready;
      expect(await client.request("hello", {})).toEqual({
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
          "draft",
          "gesture-start",
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
          "gsap-set",
          "patch-tweens",
        ],
      });
    } finally {
      agent.dispose();
    }
  });

  it("gives two clients of one frame a port each, so both get their replies", async () => {
    const { iframe, frame } = previewFrame();
    const { host, deliver } = hostReachingEveryListenerOfADispatch();
    const parent = document.body.appendChild(document.createElement("iframe")).contentWindow!;
    parent.postMessage = ((data: unknown, _origin: string, transfer: MessagePort[]) => {
      ports.push(...transfer);
      setTimeout(() => deliver({ source: frame, data, ports: transfer }));
    }) as Window["postMessage"];
    frame.postMessage = ((data: unknown) =>
      window.dispatchEvent(
        new MessageEvent("message", { source: parent, data }),
      )) as Window["postMessage"];
    const agent = installMarkedEditingAgent(parent);
    try {
      const first = createEditingPortClient({ iframe, host, timeoutMs: 1_000 });
      const second = createEditingPortClient({ iframe, host, timeoutMs: 1_000 });
      clients.push(first, second);
      await Promise.all([first.ready, second.ready]);
      const [z, loop] = await Promise.all([
        first.request("max-z-index", {}),
        second.request("set-loop-start", { seconds: null }),
      ]);
      expect([z, loop]).toEqual([{ zIndex: 0 }, { applied: false }]);
    } finally {
      agent.dispose();
    }
  });

  it("hands each key the frame forwards to its listeners and drops off-shape ones", async () => {
    const { iframe, frame } = previewFrame();
    const { host, deliver } = fakeHost();
    const client = createEditingPortClient({ iframe, host });
    clients.push(client);
    const { port1, port2 } = channel();
    deliver({ source: frame, data: PORT_MESSAGE, ports: [port1] });
    await client.ready;
    const key = {
      type: "keydown",
      key: "k",
      code: "KeyK",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
    };
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = client.onKey(first);
    client.onKey(second);
    for (const bad of [
      { v: 2, event: "key", key },
      { v: 1, event: "keys", key },
      { v: 1, event: "key", key: { ...key, type: "keypress" } },
      { v: 1, event: "key", key: { ...key, repeat: "no" } },
      { v: 1, event: "key", key: { ...key, extra: 1 } },
      { v: 1, event: "key", key: { ...key, key: "k".repeat(65) } },
    ])
      port2.postMessage(bad);
    port2.postMessage({ v: 1, event: "key", key });
    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
    expect(first).toHaveBeenCalledExactlyOnceWith(key);
    stopFirst();
    port2.postMessage({ v: 1, event: "key", key: { ...key, type: "keyup" } });
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(2));
    expect(first).toHaveBeenCalledOnce();
  });

  it("serves a new client for the same frame after the first is disposed", async () => {
    const { iframe, frame } = previewFrame();
    const { host, deliver } = fakeHost();
    const parent = document.body.appendChild(document.createElement("iframe")).contentWindow!;
    parent.postMessage = ((data: unknown, _origin: string, transfer: MessagePort[]) => {
      ports.push(...transfer);
      deliver({ source: frame, data, ports: transfer });
    }) as Window["postMessage"];
    frame.postMessage = ((data: unknown) =>
      window.dispatchEvent(
        new MessageEvent("message", { source: parent, data }),
      )) as Window["postMessage"];
    const agent = installMarkedEditingAgent(parent);
    try {
      const first = createEditingPortClient({ iframe, host });
      await first.ready;
      first.dispose();
      const second = createEditingPortClient({ iframe, host, timeoutMs: 1_000 });
      clients.push(second);
      await second.ready;
      expect(await second.request("wait-for-seek", {})).toEqual({ waited: false });
    } finally {
      agent.dispose();
    }
  });

  // The runtime posts `ready` before it installs its agent, so a client can send its connect
  // twice and receive two ports. Each step below is one queued delivery, run in the order given.
  it.each([
    ["ready before either port", ["ready", "agent", "agent", "port", "port"]],
    ["ready between the connects", ["agent", "ready", "port", "agent", "port"]],
    ["first port before ready", ["agent", "port", "ready", "agent", "port"]],
  ])("keeps a working port when %s", async (_name, steps) => {
    const { iframe, frame } = previewFrame();
    const { host, deliver } = fakeHost();
    const parent = document.body.appendChild(document.createElement("iframe")).contentWindow!;
    const toAgent: unknown[] = [];
    const toHost: Partial<MessageEvent>[] = [];
    parent.postMessage = ((data: unknown, _origin: string, transfer: MessagePort[]) => {
      ports.push(...transfer);
      toHost.push({ source: frame, data, ports: transfer });
    }) as Window["postMessage"];
    frame.postMessage = ((data: unknown) => toAgent.push(data)) as Window["postMessage"];
    const agent = installMarkedEditingAgent(parent);
    try {
      const client = createEditingPortClient({ iframe, host, timeoutMs: 300 });
      clients.push(client);
      for (const step of steps) {
        if (step === "ready")
          deliver({ source: frame, data: { source: "hf-preview", type: "ready" } });
        else if (step === "port") deliver(toHost.shift() ?? {});
        else if (toAgent.length > 0)
          window.dispatchEvent(
            new MessageEvent("message", { source: parent, data: toAgent.shift() }),
          );
      }
      await client.ready;
      await expect(client.request("hello", {})).resolves.toMatchObject({ version: 1 });
    } finally {
      agent.dispose();
    }
  });

  it("asks for the port at once and on ready, and takes it only from its own frame", async () => {
    const { iframe, frame, connects } = previewFrame();
    const { host, deliver } = fakeHost();
    const client = createEditingPortClient({ iframe, host });
    clients.push(client);
    deliver({ source: frame, data: { source: "hf-preview", type: "ready" } });
    expect(connects).toHaveBeenCalledTimes(2);
    expect(connects).toHaveBeenLastCalledWith({ ...CONNECT }, "*");
    const settled = vi.fn();
    void client.ready.then(settled);
    deliver({ source: previewFrame().frame, data: PORT_MESSAGE, ports: [channel().port2] });
    deliver({ source: frame, data: { ...PORT_MESSAGE, v: 2 }, ports: [channel().port2] });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    deliver({ source: frame, data: PORT_MESSAGE, ports: [channel().port2] });
    await client.ready;
    expect(host.removeEventListener).toHaveBeenCalled();
  });

  it("maps error and malformed replies to typed errors", async () => {
    const { iframe, frame } = previewFrame();
    const { host, deliver } = fakeHost();
    const pair = channel();
    pair.port1.onmessage = (event) => {
      const { id } = event.data as { id: number };
      pair.port1.postMessage(
        id === 1
          ? { v: 1, id, ok: false, error: { code: "invalid-params", message: "bad" } }
          : { v: 1, id, ok: "yes" },
      );
    };
    const client = createEditingPortClient({ iframe, host });
    clients.push(client);
    deliver({ source: frame, data: PORT_MESSAGE, ports: [pair.port2] });
    await expect(client.request("set-loop-start", { seconds: 1 })).rejects.toMatchObject({
      code: "invalid-params",
      message: "bad",
    });
    await expect(client.request("hello", {})).rejects.toMatchObject({ code: "malformed" });
  });

  it("times out a request that gets no reply, before or after the port arrives", async () => {
    const { iframe, frame } = previewFrame();
    const { host, deliver } = fakeHost();
    const client = createEditingPortClient({ iframe, host, timeoutMs: 10 });
    clients.push(client);
    await expect(client.request("hello", {})).rejects.toMatchObject({ code: "timeout" });
    deliver({ source: frame, data: PORT_MESSAGE, ports: [channel().port2] });
    const late = client.request("runtime-snapshot", {}, { timeoutMs: 5 });
    await expect(late).rejects.toBeInstanceOf(EditingPortError);
    await expect(late).rejects.toMatchObject({ code: "timeout" });
  });

  it("hands each geometry push to its listeners, drops off-shape ones, and stops the watch on dispose", async () => {
    const { iframe, frame } = previewFrame();
    const { host, deliver } = fakeHost();
    const client = createEditingPortClient({ iframe, host });
    const { port1, port2 } = channel();
    deliver({ source: frame, data: PORT_MESSAGE, ports: [port1] });
    await client.ready;
    const asked: Array<Record<string, unknown>> = [];
    port2.onmessage = (event) => asked.push(event.data);
    const heard = vi.fn();
    client.onGeometry(heard);
    void client.request("watch-geometry", { handles: ["0123456789abcdef:1"] }).catch(() => {});
    port2.postMessage({ v: 1, event: "geometry", at: 1, elements: [null], extra: 1 });
    port2.postMessage({ v: 1, event: "geometry", at: 2, elements: [null] });
    await vi.waitFor(() => expect(heard).toHaveBeenCalledOnce());
    expect(heard).toHaveBeenCalledWith({ at: 2, elements: [null] });
    client.dispose();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]).toMatchObject({ kind: "watch-geometry", params: { handles: [] } });
  });

  it("dispose rejects pending and later requests and closes the port", async () => {
    const { iframe, frame } = previewFrame();
    const { host, deliver } = fakeHost();
    const pair = channel();
    const close = vi.spyOn(pair.port2, "close");
    const client = createEditingPortClient({ iframe, host });
    deliver({ source: frame, data: PORT_MESSAGE, ports: [pair.port2] });
    await client.ready;
    const pending = client.request("wait-for-seek", {});
    client.dispose();
    await expect(pending).rejects.toMatchObject({ code: "disposed" });
    await expect(client.request("hello", {})).rejects.toMatchObject({ code: "disposed" });
    expect(close).toHaveBeenCalled();
    client.dispose();
  });

  it("dispose before the handoff rejects ready and pending requests, and stops listening", async () => {
    const { iframe } = previewFrame();
    const { host } = fakeHost();
    const client = createEditingPortClient({ iframe, host });
    const pending = client.request("hello", {});
    client.dispose();
    await expect(pending).rejects.toMatchObject({ code: "disposed" });
    await expect(client.ready).rejects.toMatchObject({ code: "disposed" });
    expect(host.removeEventListener).toHaveBeenCalled();
  });
});
