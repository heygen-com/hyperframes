export function findAuthoredElement(doc: Document, live: Element): Element | null {
  const hfId = live.getAttribute("data-hf-id");
  if (hfId) return doc.querySelector(`[data-hf-id="${hfId}"]`);
  return live.id ? doc.getElementById(live.id) : null;
}
