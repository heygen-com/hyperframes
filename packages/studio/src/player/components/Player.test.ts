// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasUnloadedAssets,
  Player,
  readPreviewErrorMessage,
  shouldShowCompositionLoadingOverlay,
} from "./Player";

vi.mock("@hyperframes/player", () => ({}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;
let lifecycleLog: string[] = [];

class TestHyperframesPlayer extends HTMLElement {
  readonly iframeElement = document.createElement("iframe");

  constructor() {
    super();

    const addIframeListener = this.iframeElement.addEventListener.bind(this.iframeElement);
    this.iframeElement.addEventListener = ((type, listener, options) => {
      lifecycleLog.push(`iframe:${type}`);
      addIframeListener(type, listener, options);
    }) as typeof this.iframeElement.addEventListener;

    const addPlayerListener = this.addEventListener.bind(this);
    this.addEventListener = ((type, listener, options) => {
      lifecycleLog.push(`player:${type}`);
      addPlayerListener(type, listener, options);
    }) as typeof this.addEventListener;

    const setPlayerAttribute = this.setAttribute.bind(this);
    this.setAttribute = (name, value) => {
      if (name === "src") lifecycleLog.push("src");
      setPlayerAttribute(name, value);
    };
  }
}

if (!customElements.get("hyperframes-player")) {
  customElements.define("hyperframes-player", TestHyperframesPlayer);
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  lifecycleLog = [];
  document.body.innerHTML = "";
});

async function mountPlayer() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      createElement(Player, {
        directUrl: "/api/projects/demo/preview",
        onLoad: vi.fn(),
        suppressLoadingOverlay: true,
      }),
    );
    await Promise.resolve();
  });

  const player = host.querySelector<TestHyperframesPlayer>("hyperframes-player");
  if (!player) throw new Error("player did not mount");
  return { host, player };
}

function createAudioIframe() {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const audio = iframe.contentDocument?.createElement("audio");
  expect(audio).toBeDefined();
  iframe.contentDocument?.body.appendChild(audio!);
  return { audio: audio!, iframe };
}

describe("preview errors", () => {
  it("reads the player probe error for the visible retry state", () => {
    expect(
      readPreviewErrorMessage(
        new CustomEvent("error", {
          detail: { message: "Composition timeline not found after 8s" },
        }),
      ),
    ).toBe("Composition timeline not found after 8s");
  });

  it("falls back when the player emits an unstructured error", () => {
    expect(readPreviewErrorMessage(new Event("error"))).toBe(
      "The composition preview did not become ready.",
    );
  });

  it("unmounts cleanly when the player element is already detached", async () => {
    const { player } = await mountPlayer();

    // A container re-render, a crossfade swap, or a page-translation extension
    // can detach the element before React tears the Player down. Cleanup must
    // not throw NotFoundError — the error boundary turns that into a
    // full-screen "Something went wrong".
    player.remove();

    expect(() => act(() => root?.unmount())).not.toThrow();
    root = null;
  });

  it("attaches lifecycle listeners before navigating the player", async () => {
    await mountPlayer();
    const srcIndex = lifecycleLog.indexOf("src");

    expect(srcIndex).toBeGreaterThan(-1);
    for (const listener of [
      "iframe:load",
      "player:click",
      "player:shadertransitionstate",
      "player:ready",
      "player:error",
    ]) {
      expect(lifecycleLog.indexOf(listener)).toBeGreaterThan(-1);
      expect(lifecycleLog.indexOf(listener)).toBeLessThan(srcIndex);
    }
  });

  it("retries a failed preview with a fresh player URL", async () => {
    const { host, player } = await mountPlayer();

    act(() => {
      player.dispatchEvent(
        new CustomEvent("error", {
          detail: { message: "Composition timeline not found after 8s" },
        }),
      );
    });

    expect(host.querySelector('[data-testid="composition-preview-error"]')).not.toBeNull();
    const retry = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry preview",
    );
    if (!retry) throw new Error("retry action did not render");

    act(() => retry.click());

    const retryUrl = new URL(player.getAttribute("src") ?? "", window.location.origin);
    expect(retryUrl.searchParams.get("_hfStudioRetry")).toBe("1");
    expect(host.querySelector('[data-testid="composition-preview-error"]')).toBeNull();
  });
});

describe("composition loading overlay", () => {
  it("shows while the composition is loading", () => {
    expect(shouldShowCompositionLoadingOverlay(true)).toBe(true);
  });

  it("hides after the composition is ready", () => {
    expect(shouldShowCompositionLoadingOverlay(false)).toBe(false);
  });

  it("keeps the asset overlay up while media is still buffering", () => {
    const { audio, iframe } = createAudioIframe();
    Object.defineProperty(audio, "readyState", {
      value: 0,
      configurable: true,
    });
    Object.defineProperty(audio, "networkState", {
      value: 2,
      configurable: true,
    });

    expect(hasUnloadedAssets(iframe, false)).toBe(true);

    iframe.remove();
  });

  it("does not keep the asset overlay stuck on failed media sources", () => {
    const { audio, iframe } = createAudioIframe();
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

    expect(hasUnloadedAssets(iframe, false)).toBe(false);

    iframe.remove();
  });
});
