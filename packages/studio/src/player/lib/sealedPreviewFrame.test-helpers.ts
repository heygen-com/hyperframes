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
