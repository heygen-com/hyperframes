import { STUDIO_PREVIEW_MARK_META } from "../studioPreviewMark";
import { installEditingAgent, offerEditingPort } from "./editingAgent";

/** The agent in a page Studio's preview server marked, the only page it serves a port in. */
export function installMarkedEditingAgent(): { dispose: () => void } {
  const mark = document.createElement("meta");
  mark.name = STUDIO_PREVIEW_MARK_META;
  document.head.append(mark);
  const agent = installEditingAgent();
  return {
    dispose() {
      agent.dispose();
      mark.remove();
    },
  };
}

export function parentTaking() {
  const offers: unknown[] = [];
  const ports: MessagePort[] = [];
  const postMessage = (data: unknown, _origin: string, transfer?: MessagePort[]) => {
    offers.push(data);
    ports.push(...(transfer ?? []));
  };
  return { parent: { postMessage } as unknown as Window, offers, ports };
}

export function offeredPort(): MessagePort {
  const { parent, ports } = parentTaking();
  offerEditingPort(parent);
  return ports[0]!;
}
