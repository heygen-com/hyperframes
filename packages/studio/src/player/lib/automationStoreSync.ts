/**
 * Keeping the player store's automation attributes true.
 *
 * The store is what a lane draws from, and it is populated by element discovery — a
 * message from the preview runtime, which only arrives on load. Anything that edits
 * an envelope afterwards writes to the preview document and the source file, and the
 * store would go on holding the value it was born with until a reload.
 *
 * One reader, called from the two places a change lands: the resync every dom-edit
 * attribute commit already runs, and the soft restore an undo or redo applies. It
 * reads the preview rather than being told, because those callers know a file
 * changed, not which attribute — and because three separate writers shipped without
 * remembering to sync, which is what a single sink prevents.
 */

import { HF_AUDIO_AUTOMATION_ATTR } from "@hyperframes/core/audio-automation";
import { HF_AUDIO_FX_ATTR } from "@hyperframes/core/audio-fx";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { groupInfoFor } from "./timelineGroupInfo";

/** The preview node an element stands for, by dom id and then by `data-hf-id`. */
function previewNodeFor(doc: Document, element: TimelineElement): Element | null {
  const domId = element.domId ?? element.id;
  const byId = domId ? doc.getElementById(domId) : null;
  if (byId) return byId;
  return element.hfId ? doc.querySelector(`[data-hf-id="${element.hfId}"]`) : null;
}

/**
 * Re-read every element's automation and FX-chain attributes from the preview
 * document, for a change that reached the DOM without going through this store.
 *
 * That is undo and redo. A soft restore patches the reverted attributes onto the
 * live preview and re-runs the timeline — deliberately, so the frame does not blank
 * — but the store it does not touch is the one the lanes read, so an undone delete
 * stayed invisible until a reload. A full restore already clears the store and waits
 * for discovery, so it needs nothing from here.
 *
 * Reads rather than being told: an undo restores whole files, so the attribute it
 * reverted is only known by looking.
 */
/**
 * What an element's four synced fields SHOULD read, given the preview.
 *
 * Its own two come off its node; the other two are its copy of what its group
 * carries. The timeline derives a group's lanes and chain from these mirrors,
 * never from the group element — and the FX rack is not group-aware: selecting
 * a group and automating one of its parameters writes `data-automation` on the
 * group node through the ordinary element path, which used to refresh an
 * element's own two fields and nothing else. So the group's row went on reading
 * the value it was born with, and its `∿` never appeared.
 */
function syncedFields(doc: Document, element: TimelineElement, node: Element) {
  const group = element.audioGroup ? groupInfoFor(doc, element.audioGroup) : null;
  return {
    automation: node.getAttribute(HF_AUDIO_AUTOMATION_ATTR) ?? undefined,
    fxChain: node.getAttribute(HF_AUDIO_FX_ATTR) ?? undefined,
    audioGroupAutomation: group?.automation,
    audioGroupFxChain: group?.fxChain,
  };
}

export function syncStoredAutomationFromPreview(doc: Document | null | undefined): void {
  if (!doc) return;
  usePlayerStore.setState((state) => {
    let changed = false;
    const elements = state.elements.map((element) => {
      const node = previewNodeFor(doc, element);
      if (!node) return element;
      const fields = syncedFields(doc, element, node);
      // Same array back when nothing moved: `elements` keys memos all over the
      // timeline, and a fresh object per sync would re-render every one.
      const keys = Object.keys(fields) as (keyof typeof fields)[];
      if (keys.every((key) => fields[key] === element[key])) return element;
      changed = true;
      return { ...element, ...fields };
    });
    return changed ? { elements } : {};
  });
}
