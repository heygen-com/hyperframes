import type { DockviewApi } from "dockview-react";

const TAB_FILL_CLASS = "hf-dock-tab-fill";

/** The strip's one fill, created on first use. Dockview inserts tabs before tabs, so it stays first. */
function fillOf(list: HTMLElement): HTMLElement {
  const existing = list.querySelector<HTMLElement>(`:scope > .${TAB_FILL_CLASS}`);
  if (existing) return existing;
  const fill = document.createElement("span");
  fill.className = TAB_FILL_CLASS;
  fill.setAttribute("aria-hidden", "true");
  list.prepend(fill);
  // Placed once without motion; only later moves slide.
  requestAnimationFrame(() => fill.setAttribute("data-ready", ""));
  return fill;
}

/** Reads where the shown tab sits; the write happens after every strip is read, so layout runs once. */
function measureFill(list: HTMLElement): () => void {
  const fill = fillOf(list);
  const tab = list.querySelector<HTMLElement>(":scope > .dv-active-tab");
  const box = tab ? { width: tab.offsetWidth, left: tab.offsetLeft } : null;
  return () => {
    fill.hidden = !box;
    if (!box) return;
    fill.style.width = `${box.width}px`;
    fill.style.transform = `translateX(${box.left}px)`;
  };
}

/** Marks which edges of a scrolled strip are clipped, for the CSS edge fade. */
function markClippedEdges(list: HTMLElement) {
  const edges = [];
  if (list.scrollLeft > 0) edges.push("start");
  if (list.scrollLeft + list.clientWidth < list.scrollWidth - 1) edges.push("end");
  const value = edges.join(" ");
  if (value) list.setAttribute("data-clipped", value);
  else list.removeAttribute("data-clipped");
}

/**
 * Slides one fill per tab strip under its shown tab, and keeps the clipped-edge marks current.
 * Returns a disposer.
 */
export function installTabFill(api: DockviewApi, root: HTMLElement): () => void {
  const lists = () => root.querySelectorAll<HTMLElement>(".dv-tabs-container");
  // Tab widths change when a tab gains or loses its icon, after React renders it.
  const resizeObserver = new ResizeObserver(() => placeAll());
  const observed = new Set<Element>();
  function observe(elements: Iterable<Element>) {
    for (const element of observed) {
      if (element.isConnected) continue;
      resizeObserver.unobserve(element);
      observed.delete(element);
    }
    for (const element of elements) {
      if (observed.has(element)) continue;
      resizeObserver.observe(element);
      observed.add(element);
    }
  }
  function placeAll() {
    const strips = [...lists()];
    const writes = strips.map(measureFill);
    for (const write of writes) write();
    for (const list of strips) markClippedEdges(list);
    observe(strips.flatMap((list) => [list, ...list.querySelectorAll(":scope > .dv-tab")]));
  }
  const onScroll = (event: Event) => {
    const list = event.target;
    if (list instanceof HTMLElement && list.classList.contains("dv-tabs-container")) {
      markClippedEdges(list);
    }
  };
  const subscriptions = [
    api.onDidActivePanelChange(placeAll),
    api.onDidAddPanel(placeAll),
    api.onDidRemovePanel(placeAll),
    api.onDidMovePanel(placeAll),
    api.onDidLayoutChange(placeAll),
    api.onDidLayoutFromJSON(placeAll),
  ];
  // Scroll does not bubble; a capturing listener still sees every strip's.
  root.addEventListener("scroll", onScroll, true);
  placeAll();
  return () => {
    root.removeEventListener("scroll", onScroll, true);
    for (const subscription of subscriptions) subscription.dispose();
    resizeObserver.disconnect();
  };
}
