import { afterEach, expect, it, vi } from "vitest";
import { installEditingAgent, offerEditingPort } from "./editingAgent";
import { parentTaking } from "./editingAgent.test-helpers";
import { STUDIO_PREVIEW_MARK_META } from "../studioPreviewMark";

const mark = document.createElement("meta");
mark.name = STUDIO_PREVIEW_MARK_META;
document.head.append(mark);

const proto = MessagePort.prototype;
const onmessage = Object.getOwnPropertyDescriptor(proto, "onmessage")!;
const nativePost = proto.postMessage;
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.innerHTML = "";
});

/** The parent's end of the port the runtime offered as it loaded, before any composition script ran. */
function offeredAtLoad(offer: (parent: Window) => void = offerEditingPort): MessagePort {
  const { parent, ports } = parentTaking();
  offer(parent);
  cleanups.push(() => ports.forEach((port) => port.close()));
  return ports[0]!;
}

function answers(studio: MessagePort): Promise<boolean> {
  return new Promise((resolve) => {
    onmessage.set!.call(studio, () => resolve(true));
    nativePost.call(studio, { v: 2, id: 1, kind: "hello" });
    setTimeout(() => resolve(false), 50);
  });
}

/** What a composition script can do once the runtime has evaluated: patch MessagePort to collect ports. */
function patchPortsLikeAComposition(): Set<MessagePort> {
  const seen = new Set<MessagePort>();
  Object.defineProperty(proto, "onmessage", {
    configurable: true,
    get() {
      return onmessage.get!.call(this);
    },
    set(handler) {
      seen.add(this);
      onmessage.set!.call(this, handler);
    },
  });
  proto.postMessage = function (
    this: MessagePort,
    ...args: Parameters<MessagePort["postMessage"]>
  ) {
    seen.add(this);
    return nativePost.apply(this, args);
  };
  cleanups.push(() => {
    Object.defineProperty(proto, "onmessage", onmessage);
    proto.postMessage = nativePost;
  });
  return seen;
}

it("keeps the runtime's port from a composition that patched MessagePort after it loaded", async () => {
  const studio = offeredAtLoad();
  const seen = patchPortsLikeAComposition();
  const agent = installEditingAgent();
  cleanups.push(() => agent.dispose());

  // Studio talks from its own realm in a browser, so its side keeps the original methods here.
  const pushed: unknown[] = [];
  const reply = new Promise<Record<string, unknown>>((resolve) => {
    onmessage.set!.call(studio, (event: MessageEvent<Record<string, unknown>>) => {
      if (typeof event.data.id === "number") resolve(event.data);
      else pushed.push(event.data);
    });
  });
  nativePost.call(studio, { v: 2, id: 1, kind: "hello" });
  expect(await reply).toMatchObject({ id: 1, ok: true });

  // A Delete posted through any port the composition collected would reach Studio as the frame's.
  for (const port of seen) {
    nativePost.call(port, {
      v: 2,
      event: "canvas-key-action",
      action: "delete",
      actionId: 1,
      revision: 1,
      handles: ["0123456789abcdef:1"],
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect([...seen]).toEqual([]);
  expect(pushed).toEqual([]);
});

it("keeps the runtime's port from a composition that patched the event's ports and stop, Set.add or Map.set", async () => {
  const studio = offeredAtLoad();
  const seen = new Set<unknown>();
  const keep = (value: unknown) => {
    if (value && typeof value === "object" && "postMessage" in value) seen.add(value);
  };
  const eventProto = MessageEvent.prototype;
  const ports = Object.getOwnPropertyDescriptor(eventProto, "ports")!;
  Object.defineProperty(eventProto, "ports", {
    configurable: true,
    get() {
      const taken = ports.get!.call(this) as MessagePort[];
      taken.forEach(keep);
      return taken;
    },
  });
  const stop = Event.prototype.stopImmediatePropagation;
  Event.prototype.stopImmediatePropagation = () => {};
  const add = Set.prototype.add;
  const set = Map.prototype.set;
  Set.prototype.add = function (value) {
    keep(value);
    return add.call(this, value);
  };
  Map.prototype.set = function (key, value) {
    keep(key);
    return set.call(this, key, value);
  };
  cleanups.push(() => {
    Object.defineProperty(eventProto, "ports", ports);
    Event.prototype.stopImmediatePropagation = stop;
    Set.prototype.add = add;
    Map.prototype.set = set;
  });
  const page = vi.fn();
  window.addEventListener("message", page);
  cleanups.push(() => window.removeEventListener("message", page));

  const agent = installEditingAgent();
  cleanups.push(() => agent.dispose());
  const replies: Array<Record<string, unknown>> = [];
  onmessage.set!.call(studio, (event: MessageEvent<Record<string, unknown>>) => {
    replies.push(event.data);
  });
  nativePost.call(studio, { v: 2, id: 1, kind: "watch-keys", params: { combos: ["Space"] } });
  nativePost.call(studio, { v: 2, id: 2, kind: "watch-geometry", params: { handles: [] } });
  await vi.waitFor(() => expect(replies.map((reply) => reply.id)).toEqual([1, 2]));
  expect([...seen]).toEqual([]);
  expect(page).not.toHaveBeenCalled();
});

/** The runtime as it loads in a frame whose parent is `parent`. */
async function loadedIn(parent: Window) {
  Object.defineProperty(window, "parent", { configurable: true, value: parent });
  cleanups.push(() => Reflect.deleteProperty(window, "parent"));
  vi.resetModules();
  const runtimePort = await import("./runtimePort");
  runtimePort.allowPortStandInsForTests();
  return import("./editingAgent");
}

it("offers its port to the parent it loaded with, not one a composition put on window.parent", async () => {
  const atLoad = parentTaking();
  const loaded = await loadedIn(atLoad.parent);
  const stranger = parentTaking();
  Object.defineProperty(window, "parent", { configurable: true, value: stranger.parent });
  loaded.offerEditingPort();
  const agent = loaded.installEditingAgent();
  cleanups.push(() => agent.dispose());

  expect(stranger.ports).toEqual([]);
  expect(await answers(atLoad.ports[0]!)).toBe(true);
});

it("holds the port it offered before the agent starts, and serves it at start", async () => {
  const atLoad = parentTaking();
  const loaded = await loadedIn(atLoad.parent);
  loaded.offerEditingPort();
  const agent = loaded.installEditingAgent();
  cleanups.push(() => agent.dispose());
  expect(await answers(atLoad.ports[0]!)).toBe(true);
});

it("offers no port when the port's own methods could not be read at load", async () => {
  delete (proto as { onmessage?: unknown }).onmessage;
  vi.resetModules();
  const loaded = await import("./editingAgent").finally(() =>
    Object.defineProperty(proto, "onmessage", onmessage),
  );
  const { parent, offers } = parentTaking();
  loaded.offerEditingPort(parent);
  expect(offers).toEqual([]);
});
