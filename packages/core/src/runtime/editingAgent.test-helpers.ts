import { STUDIO_PREVIEW_MARK_META } from "../studioPreviewMark";
import { installEditingAgent } from "./editingAgent";

/** The agent in a page Studio's preview server marked, the only page it serves a port in. */
export function installMarkedEditingAgent(parent: Window): { dispose: () => void } {
  const mark = document.createElement("meta");
  mark.name = STUDIO_PREVIEW_MARK_META;
  document.head.append(mark);
  const agent = installEditingAgent(parent);
  return {
    dispose() {
      agent.dispose();
      mark.remove();
    },
  };
}

export const CONNECT = { source: "hf-parent", type: "editing-connect", v: 2 };

export function connectFrom(source: Window | null, data: unknown = CONNECT): MessagePort {
  const { port1, port2 } = new MessageChannel();
  window.dispatchEvent(new MessageEvent("message", { source, data, ports: [port2] }));
  return port1;
}
