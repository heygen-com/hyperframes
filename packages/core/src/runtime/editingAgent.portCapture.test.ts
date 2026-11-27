import { afterEach, expect, it, vi } from "vitest";
import { installEditingAgent } from "./editingAgent";
import { STUDIO_PREVIEW_MARK_META } from "../studioPreviewMark";

const CONNECT = { source: "hf-parent", type: "editing-connect", v: 1 };
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

function frameWindow(): Window {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  return iframe.contentWindow!;
}

const connect = (source: Window) =>
  window.dispatchEvent(new MessageEvent("message", { source, data: CONNECT }));

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

it("keeps its port from a composition that patched MessagePort before Studio connected", async () => {
  const parent = frameWindow();
  const handoff = vi.fn();
  parent.postMessage = handoff as unknown as Window["postMessage"];
  const agent = installEditingAgent(parent);
  cleanups.push(() => agent.dispose());
  const seen = patchPortsLikeAComposition();

  connect(parent);
  const studio = (handoff.mock.calls[0][2] as MessagePort[])[0]!;
  cleanups.push(() => studio.close());
  // Studio talks from its own realm in a browser, so its side keeps the original methods here.
  const pushed: unknown[] = [];
  const reply = new Promise<Record<string, unknown>>((resolve) => {
    onmessage.set!.call(studio, (event: MessageEvent<Record<string, unknown>>) => {
      if (typeof event.data.id === "number") resolve(event.data);
      else pushed.push(event.data);
    });
  });
  nativePost.call(studio, { v: 1, id: 1, kind: "hello" });
  expect(await reply).toMatchObject({ id: 1, ok: true });

  // A Delete posted through any port the composition collected would reach Studio as the frame's.
  for (const port of seen) {
    nativePost.call(port, {
      v: 1,
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

it("hands its port to the parent it loaded with, not one a composition put on window.parent", () => {
  const stranger = frameWindow();
  const handoff = vi.fn();
  stranger.postMessage = handoff as unknown as Window["postMessage"];
  Object.defineProperty(window, "parent", { configurable: true, value: stranger });
  cleanups.push(() => Reflect.deleteProperty(window, "parent"));
  const agent = installEditingAgent();
  cleanups.push(() => agent.dispose());

  connect(stranger);
  expect(handoff).not.toHaveBeenCalled();
});
