import { withoutDragChrome } from "./dragChrome";

export function documentMarkup(): { html: string; baseURI: string } {
  return withoutDragChrome(() => ({
    html: document.documentElement.outerHTML,
    baseURI: document.baseURI,
  }));
}
