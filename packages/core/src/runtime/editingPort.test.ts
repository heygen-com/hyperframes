import { afterEach, describe, expect, it, vi } from "vitest";
import { installMarkedEditingAgent, offeredPort } from "./editingAgent.test-helpers";
import {
  createEditingPortClient,
  EditingPortError,
  parseEditingRequest,
  type EditingPortClient,
} from "./editingPort";

const clients: EditingPortClient[] = [];
const ports: MessagePort[] = [];

function channel() {
  const pair = new MessageChannel();
  ports.push(pair.port1, pair.port2);
  return pair;
}

/** A client on a channel whose frame end, `page`, the test answers; with `later` the port waits for `hand`. */
function clientOn(options: { timeoutMs?: number; later?: boolean } = {}) {
  const { port1: studio, port2: page } = channel();
  let hand: (port: MessagePort | null) => void = () => {};
  const port = options.later
    ? new Promise<MessagePort | null>((resolve) => (hand = resolve))
    : Promise.resolve(studio);
  const client = createEditingPortClient({ port, timeoutMs: options.timeoutMs });
  clients.push(client);
  return { client, page, hand: () => hand(studio), handNone: () => hand(null) };
}

/** A client of the agent in this page, on the port the agent offered as it loaded. */
function clientOfAgent(timeoutMs?: number) {
  const client = createEditingPortClient({ port: Promise.resolve(offeredPort()), timeoutMs });
  clients.push(client);
  return client;
}

/** The frame's end answering hello as the runtime does and handing every other request to `onRequest`. */
function runtimeEnd(page: MessagePort, onRequest?: (data: Record<string, unknown>) => void) {
  page.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
    if (event.data.kind === "hello") page.postMessage({ v: 2, id: event.data.id, ok: true });
    else onRequest?.(event.data);
  };
  return page;
}

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  for (const port of ports.splice(0)) port.close();
  document.body.innerHTML = "";
});

describe("createEditingPortClient", () => {
  it("round-trips a request with the runtime agent", async () => {
    const agent = installMarkedEditingAgent();
    try {
      const client = clientOfAgent();
      clients.push(client);
      await client.ready;
      expect(await client.request("hello", {})).toEqual({
        version: 2,
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
          "remove-elements",
          "stacking-family",
          "gsap-set",
          "patch-tweens",
          "soft-reload",
          "hold-scenes",
          "mark-scenes-stale",
          "swap-scenes",
          "live-retime",
          "rebind-timing",
          "assets-unloaded",
          "text-edit",
          "serve-paused-frames",
          "frame-presented",
          "arm-canvas-keys",
          "resolve-canvas-key-action",
          "stage-measure",
          "stage-act",
        ],
      });
      document.body.innerHTML = `<div id="hero" data-hf-id="hf-hero">Hi</div>`;
      const measured = await client.request("stage-measure", { maxItems: 10 });
      expect(measured.truncated).toBe(false);
      expect(measured.items.map((item) => [item.key, item.text])).toEqual([["#hf-hero", "Hi"]]);

      document.body.insertAdjacentHTML("beforeend", `<p style="display: none">Later</p>`);
      const [hero, later] = [...document.body.children] as HTMLElement[];
      const inputs: (string | null)[] = [];
      const readied: string[] = [];
      client.onStageInput((event) => inputs.push(event.key));
      client.onStageActReady((event) => readied.push(...event.held.map((one) => one.key)));
      const fade = { borrow: ["opacity" as const], draw: { styles: { opacity: "0" } } };
      const held = await client.request("stage-act", {
        op: "hold",
        acts: [
          { key: "0", hfId: null, ...fade },
          { key: "1", hfId: null, ...fade },
        ],
        deferred: true,
        caretColor: "#3ce6ac",
      });
      expect(held).toEqual({ op: "hold", held: [] });
      for (const element of [hero!, later!])
        vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 50, 10));
      later!.style.display = "block";
      await vi.waitFor(() => expect(readied).toEqual(["0", "1"]));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      await vi.waitFor(() => expect(inputs).toEqual(["a"]));
      await client.request("stage-act", { op: "restore", keys: null });
      expect([hero!.style.opacity, later!.style.opacity]).toEqual(["", ""]);
    } finally {
      agent.dispose();
    }
  });

  it("gives two clients of one frame a port each, so both get their replies", async () => {
    const agent = installMarkedEditingAgent();
    try {
      const first = clientOfAgent(1_000);
      const second = clientOfAgent(1_000);
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
    const { client, page } = clientOn();
    const port2 = runtimeEnd(page);
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
      { v: 1, event: "key", key },
      { v: 2, event: "keys", key },
      { v: 2, event: "key", key: { ...key, type: "keypress" } },
      { v: 2, event: "key", key: { ...key, repeat: "no" } },
      { v: 2, event: "key", key: { ...key, extra: 1 } },
      { v: 2, event: "key", key: { ...key, key: "k".repeat(65) } },
    ])
      port2.postMessage(bad);
    port2.postMessage({ v: 2, event: "key", key });
    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
    expect(first).toHaveBeenCalledExactlyOnceWith(key);
    stopFirst();
    port2.postMessage({ v: 2, event: "key", key: { ...key, type: "keyup" } });
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(2));
    expect(first).toHaveBeenCalledOnce();
  });

  it("hands a text edit's away press to its listeners and drops an off-shape one", async () => {
    const { client, page } = clientOn();
    const port2 = runtimeEnd(page);
    await client.ready;
    const away = {
      handle: "0123456789abcdef:1",
      button: 0,
      point: { x: 1, y: 2 },
      viewportWidth: 640,
      keys: { shiftKey: false, metaKey: false, ctrlKey: false },
    };
    const listener = vi.fn();
    const ended = vi.fn();
    client.onTextEditAway(listener);
    client.onTextEditEnded(ended);
    port2.postMessage({ v: 2, event: "text-edit-away", ...away, button: 1 });
    port2.postMessage({ v: 2, event: "text-edit-away", ...away });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledExactlyOnceWith(away));
    expect(ended).not.toHaveBeenCalled();
  });

  it("serves a new client for the same frame after the first is disposed", async () => {
    const agent = installMarkedEditingAgent();
    try {
      const first = clientOfAgent();
      await first.ready;
      first.dispose();
      const second = clientOfAgent(1_000);
      clients.push(second);
      await second.ready;
      expect(await second.request("wait-for-seek", {})).toEqual({ waited: false });
    } finally {
      agent.dispose();
    }
  });

  it("is ready only on its runtime's own answer on the port it was handed", async () => {
    const { client, page, hand } = clientOn({ later: true });
    const settled = vi.fn();
    void client.ready.then(settled);
    const asked: unknown[] = [];
    page.onmessage = (event: MessageEvent<unknown>) => asked.push(event.data);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).toEqual([]);
    hand();
    await vi.waitFor(() => expect(asked).toEqual([{ v: 2, id: 1, kind: "hello", params: {} }]));
    page.postMessage({ v: 1, id: 1, ok: true });
    page.postMessage({ v: 2, id: 1, ok: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).not.toHaveBeenCalled();
    page.postMessage({ v: 2, id: 1, ok: true });
    await client.ready;
  });

  it("ends when its load has no port", async () => {
    const { client, handNone } = clientOn({ later: true });
    const pending = client.request("hello", {});
    handNone();
    await expect(client.ready).rejects.toMatchObject({ code: "disposed" });
    await expect(pending).rejects.toMatchObject({ code: "disposed" });
  });

  it("maps error and malformed replies to typed errors", async () => {
    const { client, page } = clientOn();
    clients.push(client);
    const port = runtimeEnd(page, ({ id, kind }) =>
      port.postMessage(
        kind === "set-loop-start"
          ? { v: 2, id, ok: false, error: { code: "invalid-params", message: "bad" } }
          : { v: 2, id, ok: "yes" },
      ),
    );
    await expect(client.request("set-loop-start", { seconds: 1 })).rejects.toMatchObject({
      code: "invalid-params",
      message: "bad",
    });
    await expect(client.request("max-z-index", {})).rejects.toMatchObject({ code: "malformed" });
  });

  it("times out a request that gets no reply, before or after the port arrives", async () => {
    const { client, page, hand } = clientOn({ timeoutMs: 10, later: true });
    await expect(client.request("hello", {})).rejects.toMatchObject({ code: "timeout" });
    runtimeEnd(page);
    hand();
    await client.ready;
    const late = client.request("runtime-snapshot", {}, { timeoutMs: 5 });
    await expect(late).rejects.toBeInstanceOf(EditingPortError);
    await expect(late).rejects.toMatchObject({ code: "timeout" });
  });

  it("takes a frame-presented wait only as a bounded number of ms", () => {
    const parse = (params: unknown) =>
      parseEditingRequest({ v: 2, id: 1, kind: "frame-presented", params });
    expect(parse({})).toMatchObject({ ok: true, params: {} });
    expect(parse({ waitMs: 10_000 })).toMatchObject({ ok: true, params: { waitMs: 10_000 } });
    for (const bad of [
      { waitMs: 0 },
      { waitMs: 15_001 },
      { waitMs: NaN },
      { waitMs: "1" },
      { waitMs: 1, x: 1 },
    ])
      expect(parse(bad)).toMatchObject({ ok: false, code: "invalid-params" });
  });

  // fails without the fix: the client gave up at its fixed timeout while the frame was still asked to wait.
  it("waits for a frame-presented answer a second past the frame's wait, never less than its default", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { client } = clientOn({ timeoutMs: 10, later: true });
      const outcome = vi.fn();
      void client.request("frame-presented", { waitMs: 3_000 }).catch(outcome);
      await vi.advanceTimersByTimeAsync(3_900);
      expect(outcome).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(outcome).toHaveBeenCalledWith(expect.objectContaining({ code: "timeout" }));
      const short = vi.fn();
      const { client: patient } = clientOn({ timeoutMs: 5_000, later: true });
      void patient.request("frame-presented", { waitMs: 100 }).catch(short);
      await vi.advanceTimersByTimeAsync(4_900);
      expect(short).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands each geometry push to its listeners, drops off-shape ones, and stops the watch on dispose", async () => {
    const { client, page } = clientOn();
    const asked: Array<Record<string, unknown>> = [];
    const port2 = runtimeEnd(page, (data) => asked.push(data));
    await client.ready;
    const heard = vi.fn();
    client.onGeometry(heard);
    void client.request("watch-geometry", { handles: ["0123456789abcdef:1"] }).catch(() => {});
    port2.postMessage({ v: 2, event: "geometry", at: 1, elements: [null], extra: 1 });
    port2.postMessage({ v: 2, event: "geometry", at: 2, elements: [null] });
    await vi.waitFor(() => expect(heard).toHaveBeenCalledOnce());
    expect(heard).toHaveBeenCalledWith({ at: 2, elements: [null] });
    client.dispose();
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]).toMatchObject({ kind: "watch-geometry", params: { handles: [] } });
  });

  it("dispose rejects pending and later requests and closes the port", async () => {
    const { client, page } = clientOn();
    const port = runtimeEnd(page);
    const closed = new Promise<void>((resolve) => port.addEventListener("close", () => resolve()));
    await client.ready;
    const pending = client.request("wait-for-seek", {});
    client.dispose();
    await expect(pending).rejects.toMatchObject({ code: "disposed" });
    await expect(client.request("hello", {})).rejects.toMatchObject({ code: "disposed" });
    await closed;
    client.dispose();
  });

  it("dispose before the port arrives rejects ready and pending requests, and closes the port handed after", async () => {
    const { client, page, hand } = clientOn({ later: true });
    const pending = client.request("hello", {});
    client.dispose();
    await expect(pending).rejects.toMatchObject({ code: "disposed" });
    await expect(client.ready).rejects.toMatchObject({ code: "disposed" });
    const closed = new Promise<void>((resolve) => page.addEventListener("close", () => resolve()));
    hand();
    await closed;
  });
});
