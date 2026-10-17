import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLIP_HIDDEN_ATTR,
  setTimedClipPaintVisibility,
  setTimedClipVisibility,
  showHiddenClips,
  showHiddenClipFilters,
} from "./timedClipHide";

const mount = () => document.body.appendChild(document.createElement("div"));
afterEach(() => {
  document.body.innerHTML = "";
});

describe("timed clip paint transitions", () => {
  it("finishes only a new transition of the host's runtime filter", () => {
    const clip = mount();
    const existing = { transitionProperty: "filter", effect: { target: clip }, finish: vi.fn() };
    const gate = { transitionProperty: "filter", effect: { target: clip }, finish: vi.fn() };
    const prefixed = {
      transitionProperty: "-webkit-filter",
      effect: { target: clip },
      finish: vi.fn(),
    };
    const opacity = { transitionProperty: "opacity", effect: { target: clip }, finish: vi.fn() };
    const pseudo = {
      transitionProperty: "filter",
      effect: { target: clip, pseudoElement: "::before" },
      finish: vi.fn(),
    };
    const child = {
      transitionProperty: "filter",
      effect: { target: document.createElement("div") },
      finish: vi.fn(),
    };
    const animation = { effect: { target: clip }, finish: vi.fn() };
    const getAnimations = vi
      .fn()
      .mockReturnValueOnce([existing])
      .mockReturnValue([existing, gate, prefixed, opacity, pseudo, child, animation]);
    Object.defineProperty(clip, "getAnimations", { value: getAnimations });
    setTimedClipVisibility(clip, "hidden");
    expect(gate.finish).toHaveBeenCalledOnce();
    expect(prefixed.finish).toHaveBeenCalledOnce();
    for (const untouched of [existing, opacity, pseudo, child, animation])
      expect(untouched.finish).not.toHaveBeenCalled();
    expect(getAnimations).toHaveBeenCalledTimes(2);
    setTimedClipVisibility(clip, "hidden");
    expect(getAnimations).toHaveBeenCalledTimes(2);
  });

  it("settles temporary first-render reveals and restores without removing the hide flag", () => {
    const clip = mount();
    setTimedClipVisibility(clip, "hidden");
    const reveal = { transitionProperty: "filter", effect: { target: clip }, finish: vi.fn() };
    const restore = { transitionProperty: "filter", effect: { target: clip }, finish: vi.fn() };
    const getAnimations = vi
      .fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([reveal])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([restore]);
    Object.defineProperty(clip, "getAnimations", { value: getAnimations });
    const hideAgain = showHiddenClips();
    expect(clip.style.visibility).toBe("visible");
    expect(clip.hasAttribute(CLIP_HIDDEN_ATTR)).toBe(true);
    expect(reveal.finish).toHaveBeenCalledOnce();
    hideAgain();
    expect(clip.style.visibility).toBe("hidden");
    expect(restore.finish).toHaveBeenCalledOnce();
  });

  it("preserves marker ownership and clears an empty visibility override", () => {
    const clip = mount();
    clip.style.visibility = "hidden";
    const scans = vi.fn().mockReturnValue([]);
    Object.defineProperty(clip, "getAnimations", { value: scans });
    setTimedClipPaintVisibility(clip, "visible");
    expect(scans).not.toHaveBeenCalled();
    clip.setAttribute(CLIP_HIDDEN_ATTR, "");
    setTimedClipPaintVisibility(clip, "hidden");
    expect(scans).toHaveBeenCalledTimes(2);
    setTimedClipPaintVisibility(clip, "");
    expect(clip.style.getPropertyValue("visibility")).toBe("");
    expect(clip.hasAttribute(CLIP_HIDDEN_ATTR)).toBe(true);
    expect(scans).toHaveBeenCalledTimes(4);
  });

  it("removes a Studio-stamped clip's gate without changing its authored visibility", () => {
    const clip = mount();
    setTimedClipVisibility(clip, "hidden");
    const gate = { transitionProperty: "filter", effect: { target: clip }, finish: vi.fn() };
    Object.defineProperty(clip, "getAnimations", {
      value: vi.fn().mockReturnValueOnce([]).mockReturnValueOnce([gate]),
    });
    setTimedClipVisibility(clip, null);
    expect(clip.style.visibility).toBe("hidden");
    expect(clip.hasAttribute(CLIP_HIDDEN_ATTR)).toBe(false);
    expect(gate.finish).toHaveBeenCalledOnce();
  });
  it("borrows only the filter and restores owned flags after nested calls and authored changes", () => {
    const clip = mount();
    setTimedClipVisibility(clip, "hidden");
    const restore = showHiddenClipFilters();
    expect(clip.style.visibility).toBe("hidden");
    expect(clip.hasAttribute("data-hf-filter-sampling")).toBe(true);
    const restoreNested = showHiddenClipFilters();
    restoreNested();
    expect(clip.hasAttribute("data-hf-filter-sampling")).toBe(true);
    const scans = vi.fn().mockReturnValue([]);
    Object.defineProperty(clip, "getAnimations", { value: scans });
    setTimedClipPaintVisibility(clip, "visible");
    expect(scans).not.toHaveBeenCalled();
    clip.remove();
    restore();
    expect(scans).not.toHaveBeenCalled();
    expect(clip.hasAttribute("data-hf-filter-sampling")).toBe(false);
    expect(clip.style.visibility).toBe("visible");
    clip.setAttribute("data-hf-filter-sampling", "");
    restore();
    expect(clip.hasAttribute("data-hf-filter-sampling")).toBe(true);
  });

  it("collects the whole batch before finishing any newly created transition", () => {
    const clips = [mount(), mount()];
    const order: string[] = [];
    for (const [i, clip] of clips.entries()) {
      setTimedClipVisibility(clip, "hidden");
      const transition = {
        transitionProperty: "filter",
        effect: { target: clip },
        finish: () => order.push(`finish${i}`),
      };
      Object.defineProperty(clip, "getAnimations", {
        value: () => {
          order.push(`read${i}`);
          return clip.hasAttribute("data-hf-filter-sampling") ? [transition] : [];
        },
      });
    }
    const restore = showHiddenClipFilters();
    expect(order).toEqual(["read0", "read1", "read0", "read1", "finish0", "finish1"]);
    restore();
    for (const clip of clips) expect(clip.hasAttribute("data-hf-filter-sampling")).toBe(false);
  });

  it("keeps an outer jump reveal visible when a nested reveal restores", () => {
    const clip = mount();
    setTimedClipVisibility(clip, "hidden");
    const restore = showHiddenClips();
    showHiddenClips()();
    expect(clip.style.visibility).toBe("visible");
    restore();
    expect(clip.style.visibility).toBe("hidden");
  });

  it("borrows only hidden filters in an explicitly supplied preview document", () => {
    const outside = mount();
    setTimedClipVisibility(outside, "hidden");
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const preview = iframe.contentDocument!;
    const clip = preview.createElement("div");
    preview.body.appendChild(clip);
    setTimedClipVisibility(clip, "hidden");
    const restore = showHiddenClipFilters(preview);
    expect(clip.hasAttribute("data-hf-filter-sampling")).toBe(true);
    expect(outside.hasAttribute("data-hf-filter-sampling")).toBe(false);
    showHiddenClipFilters(preview)();
    expect(clip.hasAttribute("data-hf-filter-sampling")).toBe(true);
    restore();
    expect(clip.hasAttribute("data-hf-filter-sampling")).toBe(false);
    expect(clip.style.visibility).toBe("hidden");
  });
});
