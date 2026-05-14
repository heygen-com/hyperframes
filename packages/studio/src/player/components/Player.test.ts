// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { Player, hasUnloadedAssets, shouldShowCompositionLoadingOverlay } from "./Player";

// React 19 warns unless the test environment opts into act().
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@hyperframes/player", () => ({}));

interface StubHyperframesPlayerElement extends HTMLElement {
  iframeElement: HTMLIFrameElement;
}

function installHyperframesPlayerStub(): {
  iframes: HTMLIFrameElement[];
  restore: () => void;
} {
  const originalCreateElement = document.createElement.bind(document);
  const iframes: HTMLIFrameElement[] = [];

  vi.spyOn(document, "createElement").mockImplementation(
    (tagName: string, options?: ElementCreationOptions) => {
      if (tagName !== "hyperframes-player") {
        return originalCreateElement(tagName, options);
      }

      const player = originalCreateElement("div") as StubHyperframesPlayerElement;
      const iframe = originalCreateElement("iframe");
      Object.defineProperty(player, "iframeElement", {
        configurable: true,
        value: iframe,
      });
      iframes.push(iframe);
      return player;
    },
  );

  return {
    iframes,
    restore: () => vi.mocked(document.createElement).mockRestore(),
  };
}

function renderPlayer({
  key,
  ref,
  onLoad = () => {},
}: {
  key: string;
  ref?: React.Ref<HTMLIFrameElement>;
  onLoad?: () => void;
}) {
  return React.createElement(Player, {
    key,
    ref,
    projectId: "timeline-edit-playground",
    onLoad,
  });
}

async function flushMountedPlayer(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderWithAct(root: Root, node: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
  await flushMountedPlayer();
}

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

describe("Player forwarded iframe ref", () => {
  it("preserves a shared object ref when a retiring Player unmounts after a new Player claims it", async () => {
    const { iframes, restore } = installHyperframesPlayerStub();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const iframeRef = React.createRef<HTMLIFrameElement>();

    try {
      await renderWithAct(root, renderPlayer({ key: "old", ref: iframeRef }));
      const oldIframe = iframes[0];
      expect(iframeRef.current).toBe(oldIframe);

      await renderWithAct(
        root,
        React.createElement(
          React.Fragment,
          null,
          renderPlayer({ key: "old" }),
          renderPlayer({ key: "new", ref: iframeRef }),
        ),
      );
      const newIframe = iframes[1];
      expect(iframeRef.current).toBe(newIframe);

      await renderWithAct(root, renderPlayer({ key: "new", ref: iframeRef }));

      expect(iframeRef.current).toBe(newIframe);
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
      restore();
    }
  });

  it("clears the object ref when the unmounting Player still owns it", async () => {
    const { iframes, restore } = installHyperframesPlayerStub();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const iframeRef = React.createRef<HTMLIFrameElement>();

    try {
      await renderWithAct(root, renderPlayer({ key: "only", ref: iframeRef }));
      expect(iframeRef.current).toBe(iframes[0]);

      await act(async () => {
        root.unmount();
      });

      expect(iframeRef.current).toBeNull();
    } finally {
      host.remove();
      restore();
    }
  });
});
