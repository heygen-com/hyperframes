/**
 * Seek and measure every sample for one tween inside a single browser
 * evaluation. GSAP/HyperFrames seeks update DOM state synchronously, so a
 * separate CDP round trip and wall-clock sleep per sample only adds latency.
 */
export async function sampleTweenBboxes(page, selector, times) {
  return page.evaluate(
    ({ selector: sel, times: sampleTimes }) => {
      const seek = (time) => {
        if (window.__hf && typeof window.__hf.seek === "function") {
          window.__hf.seek(time);
          return;
        }
        const timelines = window.__timelines;
        if (!timelines) return;
        for (const timeline of Object.values(timelines)) {
          if (typeof timeline.seek === "function") timeline.seek(time);
        }
      };

      return sampleTimes.map((time) => {
        seek(time);
        const el = document.querySelector(sel);
        if (!el) return { t: time, x: 0, y: 0, w: 0, h: 0, missing: true };
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          t: time,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          opacity: parseFloat(style.opacity),
          visible: style.visibility !== "hidden" && style.display !== "none",
        };
      });
    },
    { selector, times },
  );
}
