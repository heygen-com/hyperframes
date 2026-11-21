import { STUDIO_PREVIEW_MARK_META } from "../studioPreviewMark";
import { installEditingAgent } from "./editingAgent";

/** The agent in a page Studio's preview server marked, the only page it hands a port to. */
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
