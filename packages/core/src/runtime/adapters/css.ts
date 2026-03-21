import type { RuntimeDeterministicAdapter } from "../types";

export function createCssAdapter(params?: {
  resolveStartSeconds?: (element: Element) => number;
}): RuntimeDeterministicAdapter {
  let entries: Array<{
    el: HTMLElement;
    baseDelay: string;
    basePlayState: string;
  }> = [];

  return {
    name: "css",
    discover: () => {
      entries = [];
      const all = document.querySelectorAll("*");
      for (const rawEl of all) {
        if (!(rawEl instanceof HTMLElement)) continue;
        const style = window.getComputedStyle(rawEl);
        if (!style.animationName || style.animationName === "none") continue;
        entries.push({
          el: rawEl,
          baseDelay: rawEl.style.animationDelay || "",
          basePlayState: rawEl.style.animationPlayState || "",
        });
      }
    },
    seek: (ctx) => {
      const time = Number(ctx.time) || 0;
      for (const entry of entries) {
        if (!entry.el.isConnected) continue;
        const start = params?.resolveStartSeconds
          ? params.resolveStartSeconds(entry.el)
          : Number.parseFloat(entry.el.getAttribute("data-start") ?? "0") || 0;
        const localTime = Math.max(0, time - start);
        entry.el.style.animationPlayState = "paused";
        entry.el.style.animationDelay = `-${localTime.toFixed(3)}s`;
      }
    },
    pause: () => {
      for (const entry of entries) {
        if (!entry.el.isConnected) continue;
        entry.el.style.animationPlayState = entry.basePlayState || "paused";
        if (entry.baseDelay) entry.el.style.animationDelay = entry.baseDelay;
      }
    },
    revert: () => {
      entries = [];
    },
  };
}
