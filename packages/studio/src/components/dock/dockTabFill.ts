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

function placeFill(list: HTMLElement) {
  const fill = fillOf(list);
  const tab = list.querySelector<HTMLElement>(":scope > .dv-active-tab");
  fill.hidden = !tab;
  if (!tab) return;
  fill.style.width = `${tab.offsetWidth}px`;
  fill.style.transform = `translateX(${tab.offsetLeft}px)`;
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
  function placeAll() {
    for (const list of lists()) {
      placeFill(list);
      markClippedEdges(list);
      resizeObserver.observe(list);
      for (const tab of list.querySelectorAll(":scope > .dv-tab")) resizeObserver.observe(tab);
    }
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
