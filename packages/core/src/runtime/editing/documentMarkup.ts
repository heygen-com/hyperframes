export function documentMarkup(): { html: string; baseURI: string } {
  return { html: document.documentElement.outerHTML, baseURI: document.baseURI };
}
