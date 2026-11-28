// A preview frame Studio cannot script, served by the frame's real runtime agent over this document.
import { onTestFinished } from "vitest";
import {
  installMarkedEditingAgent,
  offeredPort,
} from "../../../../core/src/runtime/editingAgent.test-helpers";
import { detachedFakeIframe } from "../hooks/timelinePlayerTestHarness";
import { openPreviewPortsForTests } from "./previewChannel";

const SCENE_OPENED_ON_ITS_OWN =
  "http://localhost/api/projects/demo/preview/comp/compositions/scene5.html";

export interface SealedPreviewFrame {
  iframe: HTMLIFrameElement;
  /** The frame's window as Studio sees it: only `postMessage` answers, and Studio never calls it. */
  frame: Record<string, unknown>;
  reload: () => void;
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
  Object.defineProperty(iframe, "src", { value: SCENE_OPENED_ON_ITS_OWN, configurable: true });
  let onPageUntilPlayerRemovesIt = true;
  Object.defineProperty(iframe, "isConnected", {
    configurable: true,
    get: () => onPageUntilPlayerRemovesIt,
  });
  iframe.remove = () => void (onPageUntilPlayerRemovesIt = false);
  const wrap = options.wrapHandedOverPort;
  let agent = installMarkedEditingAgent();
  const portOfThisLoad = (): MessagePort => {
    const runtime = offeredPort();
    if (!wrap) return runtime;
    const { port1: studio, port2: relay } = new MessageChannel();
    const tapped = wrap(runtime);
    relay.onmessage = (event) => tapped.postMessage(event.data);
    tapped.onmessage = (event) => relay.postMessage(event.data);
    relay.addEventListener("close", () => tapped.close());
    return studio;
  };
  target.postMessage = () => {};
  onTestFinished(openPreviewPortsForTests(iframe, portOfThisLoad));
  onTestFinished(() => agent.dispose());
  const reload = () => {
    agent.dispose();
    agent = installMarkedEditingAgent();
    iframe.dispatchEvent(new Event("load"));
  };
  return { iframe, frame, reload };
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
