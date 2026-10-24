import { afterEach, describe, expect, it } from "vitest";
import { STUDIO_PREVIEW_MARK_META } from "../studioPreviewMark";
import { revealClip } from "./clipReveal";
import {
  CLIP_HIDDEN_ATTR,
  hideTimedClipsUntilFirstPass,
  keepInlineHideRulesForOlderShaders,
  revealTimedClipsAfterFirstPass,
  showHiddenClips,
} from "./timedClipHide";

const injectedSelectors = () =>
  Array.from(document.head.querySelectorAll("style")).flatMap((style) =>
    Array.from(style.sheet!.cssRules).map((rule) => (rule as CSSStyleRule).selectorText),
  );

type ShaderWindow = Window & {
  HyperShader?: unknown;
  __hf?: object;
  __hfClipRevealAware?: boolean;
};

afterEach(() => {
  const win = window as ShaderWindow;
  delete win.HyperShader;
  delete win.__hf;
  delete win.__hfClipRevealAware;
  revealTimedClipsAfterFirstPass();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("hideTimedClipsUntilFirstPass", () => {
  it("injects no rule that matches an element's inline style, in playback or Studio preview", () => {
    document.head.append(
      Object.assign(document.createElement("meta"), { name: STUDIO_PREVIEW_MARK_META }),
    );
    hideTimedClipsUntilFirstPass();
    const selectors = injectedSelectors();
    expect(selectors.length).toBeGreaterThan(2);
    expect(selectors.filter((selector) => /\[style\b/.test(selector))).toEqual([]);
  });

  it("hides a hidden clip's contents by the runtime's mark alone", () => {
    hideTimedClipsUntilFirstPass();
    document.body.innerHTML = `<div data-start="5" ${CLIP_HIDDEN_ATTR}><p style="visibility: visible">Later</p></div>`;
    expect(getComputedStyle(document.querySelector("p")!).visibility).toBe("hidden");
  });

  // jsdom resolves !important ties by order, not weight, so the weight is asserted on the selector.
  it("keeps the contents rule at the weight of two attribute selectors", () => {
    hideTimedClipsUntilFirstPass();
    expect(injectedSelectors()).toContain(`[${CLIP_HIDDEN_ATTR}][${CLIP_HIDDEN_ATTR}] *`);
  });
});

describe("keepInlineHideRulesForOlderShaders", () => {
  // How a shader build that predates revealClip leaves a scene it reveals for capture.
  const revealedByInlineStyleOnly = `<div data-start="5" ${CLIP_HIDDEN_ATTR} style="visibility: visible"><p>Title</p><img src="a.png"></div>`;
  const previewWith = (win: Partial<ShaderWindow>) => {
    Object.assign(window, win);
    document.head.append(
      Object.assign(document.createElement("meta"), { name: STUDIO_PREVIEW_MARK_META }),
    );
    hideTimedClipsUntilFirstPass();
    keepInlineHideRulesForOlderShaders();
    revealTimedClipsAfterFirstPass();
    document.body.innerHTML = `${revealedByInlineStyleOnly}<div data-start="9" ${CLIP_HIDDEN_ATTR} style="visibility: hidden"><p>Later</p></div>`;
    const [revealed, hidden] = Array.from(document.querySelectorAll("p"));
    return {
      revealed: getComputedStyle(revealed!).visibility,
      revealedImage: getComputedStyle(document.querySelector("img")!).display,
      hidden: getComputedStyle(hidden!).visibility,
    };
  };

  it("shows a scene an older shader build revealed, found by its global or its transitions", () => {
    for (const older of [{ HyperShader: {} }, { __hf: { transitions: [] } }]) {
      expect(previewWith(older)).toEqual({
        revealed: "visible",
        revealedImage: "inline",
        hidden: "hidden",
      });
      delete (window as ShaderWindow).HyperShader;
      document.head.innerHTML = "";
    }
  });

  it("keeps the mark-only rules for a shader build that declares it lifts the mark", () => {
    expect(previewWith({ HyperShader: {}, __hfClipRevealAware: true })).toEqual({
      revealed: "hidden",
      revealedImage: "none",
      hidden: "hidden",
    });
    expect(injectedSelectors().filter((selector) => /\[style\b/.test(selector))).toEqual([]);
  });
});

describe("showHiddenClips", () => {
  it("lifts the mark while the clips show and puts it back with their inline hide", () => {
    hideTimedClipsUntilFirstPass();
    document.body.innerHTML = `<div data-start="5" ${CLIP_HIDDEN_ATTR} style="visibility: hidden"><p>Later</p></div>`;
    const clip = document.querySelector<HTMLElement>("[data-start]")!;

    const hideAgain = showHiddenClips();
    expect([clip.hasAttribute(CLIP_HIDDEN_ATTR), clip.style.visibility]).toEqual([
      false,
      "visible",
    ]);
    hideAgain();
    expect([clip.hasAttribute(CLIP_HIDDEN_ATTR), clip.style.visibility]).toEqual([true, "hidden"]);
  });
});

describe("revealClip", () => {
  it("shows a clip and lifts its mark until put back, and leaves an unmarked element unmarked", () => {
    document.body.innerHTML = `<div id="marked" ${CLIP_HIDDEN_ATTR} style="visibility: hidden"></div><div id="plain"></div>`;
    const marked = document.getElementById("marked")!;
    const plain = document.getElementById("plain")!;

    const putMarkedBack = revealClip(marked, "important");
    const putPlainBack = revealClip(plain);
    expect([marked.style.cssText, marked.hasAttribute(CLIP_HIDDEN_ATTR)]).toEqual([
      "visibility: visible !important;",
      false,
    ]);
    expect([plain.style.visibility, plain.hasAttribute(CLIP_HIDDEN_ATTR)]).toEqual([
      "visible",
      false,
    ]);
    putMarkedBack();
    putPlainBack();
    expect([marked.hasAttribute(CLIP_HIDDEN_ATTR), plain.hasAttribute(CLIP_HIDDEN_ATTR)]).toEqual([
      true,
      false,
    ]);
  });
});
