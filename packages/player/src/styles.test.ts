import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSharedPlayerStyleSheet,
  applyPlayerStyles,
  getSharedPlayerStyleSheet,
  PLAYER_STYLES,
} from "./styles.js";

type AdoptingShadowRoot = ShadowRoot & {
  adoptedStyleSheets: CSSStyleSheet[];
};

function createShadowHost(): AdoptingShadowRoot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host.attachShadow({ mode: "open" }) as AdoptingShadowRoot;
}

describe("getSharedPlayerStyleSheet", () => {
  beforeEach(() => {
    _resetSharedPlayerStyleSheet();
  });

  it("returns the same CSSStyleSheet instance across calls", () => {
    const a = getSharedPlayerStyleSheet();
    const b = getSharedPlayerStyleSheet();

    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it("returns null and memoizes the failure when CSSStyleSheet is unavailable", () => {
    const original = globalThis.CSSStyleSheet;
    (globalThis as { CSSStyleSheet?: unknown }).CSSStyleSheet = undefined;

    try {
      expect(getSharedPlayerStyleSheet()).toBeNull();
      expect(getSharedPlayerStyleSheet()).toBeNull();
    } finally {
      globalThis.CSSStyleSheet = original;
    }
  });
});

describe("applyPlayerStyles", () => {
  beforeEach(() => {
    _resetSharedPlayerStyleSheet();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("adopts the shared sheet on a fresh shadow root and adds no <style> element", () => {
    const shadow = createShadowHost();

    applyPlayerStyles(shadow);

    const sheet = getSharedPlayerStyleSheet();
    expect(sheet).not.toBeNull();
    expect(shadow.adoptedStyleSheets).toContain(sheet);
    expect(shadow.querySelector("style")).toBeNull();
  });

  it("shares one CSSStyleSheet across multiple shadow roots", () => {
    const shadowA = createShadowHost();
    const shadowB = createShadowHost();

    applyPlayerStyles(shadowA);
    applyPlayerStyles(shadowB);

    const adoptedA = shadowA.adoptedStyleSheets.at(-1);
    const adoptedB = shadowB.adoptedStyleSheets.at(-1);

    expect(adoptedA).toBeDefined();
    expect(adoptedA).toBe(adoptedB);
  });

  it("preserves any pre-existing adopted stylesheets", () => {
    const shadow = createShadowHost();
    const existing = new CSSStyleSheet();
    existing.replaceSync(":host { --pre: 1; }");
    shadow.adoptedStyleSheets = [existing];

    applyPlayerStyles(shadow);

    expect(shadow.adoptedStyleSheets[0]).toBe(existing);
    expect(shadow.adoptedStyleSheets).toContain(getSharedPlayerStyleSheet());
    expect(shadow.adoptedStyleSheets).toHaveLength(2);
  });

  it("is idempotent when called repeatedly on the same shadow root", () => {
    const shadow = createShadowHost();

    applyPlayerStyles(shadow);
    applyPlayerStyles(shadow);
    applyPlayerStyles(shadow);

    expect(shadow.adoptedStyleSheets).toHaveLength(1);
    expect(shadow.querySelectorAll("style")).toHaveLength(0);
  });

  it("falls back to a <style> element when adoptedStyleSheets is unsupported", () => {
    const shadow = createShadowHost();
    Object.defineProperty(shadow, "adoptedStyleSheets", {
      configurable: true,
      get() {
        return undefined;
      },
      set() {
        throw new Error("adoptedStyleSheets is not supported in this environment");
      },
    });

    applyPlayerStyles(shadow);

    const styleEl = shadow.querySelector("style");
    expect(styleEl).not.toBeNull();
    expect(styleEl?.textContent).toBe(PLAYER_STYLES);
  });

  it("falls back to a <style> element when CSSStyleSheet is unavailable", () => {
    const original = globalThis.CSSStyleSheet;
    (globalThis as { CSSStyleSheet?: unknown }).CSSStyleSheet = undefined;

    try {
      const shadow = createShadowHost();
      applyPlayerStyles(shadow);

      const styleEl = shadow.querySelector("style");
      expect(styleEl).not.toBeNull();
      expect(styleEl?.textContent).toBe(PLAYER_STYLES);
    } finally {
      globalThis.CSSStyleSheet = original;
    }
  });

  it("falls back to a <style> element when replaceSync throws", () => {
    const replaceSyncSpy = vi
      .spyOn(CSSStyleSheet.prototype, "replaceSync")
      .mockImplementation(() => {
        throw new Error("simulated replaceSync failure");
      });

    try {
      const shadow = createShadowHost();
      applyPlayerStyles(shadow);

      expect(shadow.querySelector("style")?.textContent).toBe(PLAYER_STYLES);
    } finally {
      replaceSyncSpy.mockRestore();
    }
  });
});
