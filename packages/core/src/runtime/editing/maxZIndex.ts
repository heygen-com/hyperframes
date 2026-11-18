/** The highest z-index on the page, hidden clips included, so a block the parent adds sits above them all. */
export function maxZIndex(): { zIndex: number } {
  let max = 0;
  for (const element of Array.from(document.body?.querySelectorAll("*") ?? [])) {
    const z = Number.parseInt(getComputedStyle(element).zIndex, 10);
    if (Number.isFinite(z) && z > max) max = z;
  }
  return { zIndex: max };
}
