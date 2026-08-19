/**
 * In-page resolution between a render media id and its DOM element.
 *
 * The pipeline addresses media by id, but element ids are only unique within
 * one composition FILE and the render document inlines many, so
 * `document.getElementById` silently resolves duplicates to whichever element
 * comes first. The producer stamps a document-unique `data-hf-render-id`
 * (core's mediaRenderIds.ts); these helpers are the single place that knows to
 * prefer it, so every capture stage addresses the same element.
 *
 * Installed via `evaluateOnNewDocument` so it exists before any page script.
 * Every call site keeps a `getElementById` fallback for documents that were
 * never compiled by the producer (snapshot, check, and direct engine callers),
 * where the authored id already is the identity.
 *
 * `__hfMediaId` mirrors core's `readMediaRenderId`, which is the definition of
 * this rule; the copy exists only because code serialized into `page.evaluate`
 * cannot import. The runtime readers in core call that function directly, and
 * `renderFrameSibling.test.ts` pins the sibling-id format both sides build.
 */

import { MEDIA_RENDER_ID_ATTR } from "@hyperframes/core";
import type { Page } from "puppeteer-core";

declare global {
  interface Window {
    /** Element for a render media id, or null. */
    __hfMediaEl?: (id: string) => Element | null;
    /** Render media id for an element — its stamped id, else its plain id. */
    __hfMediaId?: (el: Element) => string;
  }
}

/**
 * Install the resolvers. Runs on every document this page loads, so a
 * mid-render navigation cannot leave a capture stage without them.
 */
export async function installMediaRenderIdBridge(page: Page): Promise<void> {
  await page.evaluateOnNewDocument((attr: string) => {
    window.__hfMediaEl = (id: string): Element | null => {
      // CSS.escape covers ids with characters that are not valid in a selector
      // literal; the attribute value still needs its own quote escaping.
      const escaped = id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return document.querySelector(`[${attr}="${escaped}"]`) ?? document.getElementById(id);
    };
    window.__hfMediaId = (el: Element): string => el.getAttribute(attr) || el.id;
  }, MEDIA_RENDER_ID_ATTR);
}
