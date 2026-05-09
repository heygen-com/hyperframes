// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { hasUnloadedAssets, shouldShowCompositionLoadingOverlay } from "./Player";

describe("composition loading overlay", () => {
  it("shows while the composition is loading", () => {
    expect(shouldShowCompositionLoadingOverlay(true)).toBe(true);
  });

  it("hides after the composition is ready", () => {
    expect(shouldShowCompositionLoadingOverlay(false)).toBe(false);
  });

  it("keeps the asset overlay up while media is still buffering", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const audio = iframe.contentDocument?.createElement("audio");
    expect(audio).toBeDefined();
    Object.defineProperty(audio, "readyState", {
      value: 0,
      configurable: true,
    });
    Object.defineProperty(audio, "networkState", {
      value: 2,
      configurable: true,
    });
    iframe.contentDocument?.body.appendChild(audio!);

    expect(hasUnloadedAssets(iframe, false)).toBe(true);

    iframe.remove();
  });

  it("does not keep the asset overlay stuck on failed media sources", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const audio = iframe.contentDocument?.createElement("audio");
    expect(audio).toBeDefined();
    Object.defineProperty(audio, "error", {
      value: { code: 4, message: "format error" },
      configurable: true,
    });
    Object.defineProperty(audio, "readyState", {
      value: 0,
      configurable: true,
    });
    Object.defineProperty(audio, "networkState", {
      value: 3,
      configurable: true,
    });
    iframe.contentDocument?.body.appendChild(audio!);

    expect(hasUnloadedAssets(iframe, false)).toBe(false);

    iframe.remove();
  });
});
