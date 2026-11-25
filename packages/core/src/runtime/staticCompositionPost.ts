import { postRuntimeMessage } from "./bridge";
import {
  findRootCompositionElement,
  readStaticComposition,
  STATIC_COMPOSITION,
} from "./compositionLength";

/** Posts the document's static read once, as soon as it is whole: when the root is parsed if it declares its length,
 *  else at DOMContentLoaded. A parent that can't read the frame is then ready when one that can would be. */
export function postStaticCompositionWhenParsed(doc: Document = document): void {
  // A top-level page (a render) has no parent to tell, and the read walks every clip.
  if (window.parent === window) return;
  let posted = false;
  const post = (): void => {
    if (posted) return;
    posted = true;
    const read = readStaticComposition(doc);
    if (!read) return;
    postRuntimeMessage({
      source: "hf-preview",
      type: STATIC_COMPOSITION,
      durationSeconds: read.durationSeconds,
      width: read.compositionSize?.width ?? null,
      height: read.compositionSize?.height ?? null,
    });
  };
  const declared = () => findRootCompositionElement(doc)?.hasAttribute("data-duration") === true;
  if (doc.readyState !== "loading" || declared()) return post();
  const observer = new MutationObserver(() => {
    if (!declared()) return;
    observer.disconnect();
    post();
  });
  observer.observe(doc, { childList: true, subtree: true });
  doc.addEventListener(
    "DOMContentLoaded",
    () => {
      observer.disconnect();
      post();
    },
    { once: true },
  );
}
