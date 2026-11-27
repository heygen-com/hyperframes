import { isHtmlElement } from "@hyperframes/core/runtime/dom-realm";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { collectPreviewLayerItems } from "../components/editor/previewLayers";
import { findSelectionElement, standInHandle } from "../components/editor/previewSelection";
import { previewEditingClient, previewFrameOpaque } from "../player/lib/previewChannel";
import { handleLookup, type PreviewTargets } from "./handles";
import { collectStudioLookScene, type StudioLookSceneSnapshot } from "./tools/lookTools";

export interface ElementNow {
  box: { x: number; y: number; width: number; height: number };
  text: string | null;
}

/** The agent tools' one read of the preview, answered by the frame's runtime when Studio cannot script it. */
export interface AgentPreview extends PreviewTargets {
  /** The selection's element as the preview shows it now. Throws when the preview no longer has it. */
  readNow: (selection: DomEditSelection) => Promise<ElementNow>;
  scene: (activeGroupElement: HTMLElement | null) => Promise<StudioLookSceneSnapshot>;
}

function frameDocument(iframe: HTMLIFrameElement | null): Document | null {
  try {
    return iframe?.contentDocument ?? null;
  } catch {
    return null;
  }
}

async function sealedScene(
  iframe: HTMLIFrameElement,
  activeCompositionPath: string | null,
  activeGroupElement: HTMLElement | null,
): Promise<StudioLookSceneSnapshot> {
  // ponytail: one layers page (MAX_QUERY_MATCHES); page on with previewLayers' offset if films outgrow it.
  const reply = await collectPreviewLayerItems(iframe, {
    activeCompositionPath,
    activeGroupElement: null,
  });
  if (!reply) return { status: "loading" };
  const group = activeGroupElement && standInHandle(activeGroupElement) ? activeGroupElement : null;
  const drillInItem = group ? (reply.items.find((item) => item.element === group) ?? null) : null;
  return { status: "ready", items: reply.items, drillInItem };
}

export function agentPreview(
  getIframe: () => HTMLIFrameElement | null,
  activeCompositionPath: string | null,
): AgentPreview {
  return {
    load: () => {
      const iframe = getIframe();
      if (!iframe) return null;
      return previewFrameOpaque(iframe) ? previewEditingClient(iframe) : frameDocument(iframe);
    },
    find: async (handle) => {
      const lookup = handleLookup(handle);
      return lookup ? findSelectionElement(getIframe(), lookup.target, lookup.path) : null;
    },
    readNow: async (selection) => {
      const found = await findSelectionElement(getIframe(), selection, activeCompositionPath);
      const element =
        found ?? (found === undefined && !selection.handle ? selection.element : null);
      if (!element) throw new Error("the target is missing from the current Studio preview");
      if (!isHtmlElement(element)) {
        const { x, y, width, height } = element.rect;
        return { box: { x, y, width, height }, text: element.text };
      }
      const { x, y, width, height } = element.getBoundingClientRect();
      return { box: { x, y, width, height }, text: element.textContent };
    },
    scene: async (activeGroupElement) => {
      const iframe = getIframe();
      if (iframe && previewFrameOpaque(iframe))
        return sealedScene(iframe, activeCompositionPath, activeGroupElement);
      return collectStudioLookScene(
        frameDocument(iframe),
        activeCompositionPath,
        activeGroupElement,
      );
    },
  };
}
