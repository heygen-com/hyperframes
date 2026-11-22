// A preview frame Studio cannot script, served by the frame's real runtime agent over this document.
import { onTestFinished } from "vitest";
import { installMarkedEditingAgent } from "../../../../core/src/runtime/editingAgent.test-helpers";
import { detachedFakeIframe } from "../hooks/timelinePlayerTestHarness";

/** A browser's postMessage: delivered on a later task, to every listener present then. */
function postLater(init: MessageEventInit): void {
  setTimeout(() => window.dispatchEvent(new MessageEvent("message", init)));
}

export interface SealedPreviewFrame {
  iframe: HTMLIFrameElement;
  /** The frame's window as Studio sees it: only `postMessage` answers, and it reaches the runtime. */
  frame: Record<string, unknown>;
}

export function sealedPreviewFrame(
  options: { wrapHandedOverPort?: (port: MessagePort) => MessagePort } = {},
): SealedPreviewFrame {
  const target: Record<string, unknown> = {};
  const frame = new Proxy(target, {
    get: (_, key) => {
      if (key === "postMessage") return target.postMessage;
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  let onPageUntilPlayerRemovesIt = true;
  Object.defineProperty(iframe, "isConnected", {
    configurable: true,
    get: () => onPageUntilPlayerRemovesIt,
  });
  iframe.remove = () => void (onPageUntilPlayerRemovesIt = false);
  const wrap = options.wrapHandedOverPort ?? ((port: MessagePort) => port);
  const parent = {
    postMessage: (data: unknown, _origin: string, ports: MessagePort[]) =>
      postLater({ source: frame as unknown as Window, data, ports: ports.map(wrap) }),
  } as unknown as Window;
  const agent = installMarkedEditingAgent(parent);
  frame.postMessage = (data: unknown) => postLater({ source: parent, data });
  onTestFinished(() => agent.dispose());
  return { iframe, frame };
}

export type PortRequest = { id?: unknown; kind?: unknown; params?: unknown };

/** Studio's end of the frame's port, for `wrapHandedOverPort`: `hold` keeps the frame's answers to the requests it
 * picks until the call it returns hands them to Studio, in order. */
export function answerTap() {
  let pick: ((request: PortRequest) => boolean) | null = null;
  const heldIds = new Set<unknown>();
  const held: Array<() => void> = [];
  const wrapHandedOverPort = (port: MessagePort) => {
    const end = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage(request: PortRequest) {
        if (pick?.(request)) heldIds.add(request.id);
        port.postMessage(request);
      },
      close: () => port.close(),
    };
    port.onmessage = (event) => {
      const deliver = () => end.onmessage?.(event);
      if (heldIds.has(event.data?.id)) held.push(deliver);
      else deliver();
    };
    return end as unknown as MessagePort;
  };
  const hold = (match: (request: PortRequest) => boolean) => {
    pick = match;
    return () => {
      pick = null;
      heldIds.clear();
      held.splice(0).forEach((deliver) => deliver());
    };
  };
  return { wrapHandedOverPort, hold, held };
}
