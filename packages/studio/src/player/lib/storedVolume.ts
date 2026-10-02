export function parseStoredVolume(text: string | null): number | undefined {
  const volume = Number.parseFloat(text ?? "");
  return Number.isFinite(volume) ? volume : undefined;
}

/** Discovery's reading: the element's own `data-volume`, else its media's. */
export const elementVolume = (el: Element, media: Element) =>
  parseStoredVolume(el.getAttribute("data-volume") ?? media.getAttribute("data-volume"));
