import { STUDIO_MANUAL_EDIT_GESTURE_ATTR } from "../editing/draftMarkers";

export interface ManualEditGestureWatch {
  /** True while any element in the document carries the gesture marker. */
  isActive: () => boolean;
  disconnect: () => void;
}

const SELECTOR = `[${STUDIO_MANUAL_EDIT_GESTURE_ATTR}]`;

/**
 * Live answer to "is the Studio mid-drag", without a whole-document query per
 * frame.
 *
 * The marker is one attribute on one element for the length of a drag, so the
 * set of marked elements changes a handful of times per gesture and never
 * during playback — but the transport asked the document for it on every
 * paused frame, which measured 1.8 ms/s on a large project and 3.0 ms/s (6.4%
 * of the whole paused main-thread budget) on a media-heavy one. An
 * attribute-filtered MutationObserver answers the same question in O(edits).
 *
 * `onChange` fires whenever the marker set may have changed, which is also the
 * signal a parked transport needs to start ticking again.
 */
export function createManualEditGestureWatch(
  doc: Document,
  onChange: () => void,
): ManualEditGestureWatch {
  const Observer = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (!Observer || !doc.documentElement) {
    // No observer to trust: keep answering from the document, as before.
    return {
      isActive: () => doc.querySelector(SELECTOR) != null,
      disconnect: () => {},
    };
  }

  // Seeded from the document because an element could already be marked when a
  // runtime re-initialises over a live Studio session; the observer only ever
  // reports changes after it attaches.
  const marked = new Set<Element>(doc.querySelectorAll(SELECTOR));

  const ingest = (records: MutationRecord[]): void => {
    for (const record of records) {
      const target = record.target;
      if (!(target instanceof Element)) continue;
      if (target.hasAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR)) marked.add(target);
      else marked.delete(target);
    }
  };

  const observer = new Observer((records) => {
    ingest(records);
    onChange();
  });
  observer.observe(doc.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: [STUDIO_MANUAL_EDIT_GESTURE_ATTR],
  });

  return {
    isActive: () => {
      // Records are delivered in a microtask, so a caller reading back in the
      // same synchronous block as the gesture's own attribute write would
      // otherwise be served the pre-write answer. Draining here makes the
      // watch correct within a task, not just across tasks.
      ingest(observer.takeRecords());
      for (const element of marked) {
        if (element.isConnected && element.hasAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR)) {
          return true;
        }
        // A marked element torn out of the document (hot reload mid-drag) can
        // never clear its own marker.
        marked.delete(element);
      }
      return false;
    },
    disconnect: () => {
      observer.disconnect();
      marked.clear();
    },
  };
}
