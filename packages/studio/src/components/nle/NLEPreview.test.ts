// @vitest-environment happy-dom

import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelinePlayer } from "../../player/hooks/useTimelinePlayer";
import { NLEPreview, getPreviewPlayerKey, resolvePreviewStageSize } from "./NLEPreview";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const playerMounts: string[] = [];

vi.mock("../../player", async () => {
  const React = await import("react");

  return {
    Player: React.forwardRef(function MockPlayer(
      props: {
        onLoad?: () => void;
        suppressLoadingOverlay?: boolean;
        style?: React.CSSProperties;
      },
      ref: React.ForwardedRef<HTMLIFrameElement>,
    ) {
      React.useEffect(() => {
        props.onLoad?.();
      }, [props]);
      React.useState(() => playerMounts.push(props.suppressLoadingOverlay ? "shadow" : "live"));

      return React.createElement("div", {
        ref: ref as React.ForwardedRef<HTMLDivElement>,
        "data-testid": "mock-player",
        style: props.style,
      });
    }),
  };
});

vi.mock("../../utils/studioUiPreferences", () => ({
  readStudioUiPreferences: () => ({}),
  writeStudioUiPreferences: () => {},
}));

let resizeCallbacks: Array<() => void> = [];

class MockResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe() {
    const fire = () => this.cb([], this as unknown as ResizeObserver);
    resizeCallbacks.push(fire);
    fire();
  }
  disconnect() {}
}

const originalResizeObserver = globalThis.ResizeObserver;

function setRect(node: Element, rect: { width: number; height: number }) {
  Object.defineProperty(node, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: rect.width,
      bottom: rect.height,
      width: rect.width,
      height: rect.height,
      toJSON: () => ({}),
    }),
  });
}

function renderPreview(
  previewSlots: Array<{ gen: number; role: "live" | "shadow"; url?: string }> = [
    { gen: 0, role: "live" },
  ],
) {
  resizeCallbacks = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const iframeRef = createRef<HTMLIFrameElement>();

  act(() => {
    root.render(
      React.createElement(NLEPreview, {
        projectId: "timeline-edit-playground",
        iframeRef,
        onIframeLoad: () => {},
        previewSlots,
        onShadowIframeLoad: () => {},
        onShadowReadyChange: () => {},
        onShadowError: () => {},
        setShadowIframeNode: () => {},
        resetPreviewSlots: () => {},
      }),
    );
  });

  const viewport = host.querySelector('[aria-label="Composition preview"]') as HTMLDivElement;
  const stage = host.querySelector('[data-testid="preview-zoom-stage"]') as HTMLDivElement;
  expect(viewport).toBeTruthy();
  expect(stage).toBeTruthy();

  setRect(viewport, { width: 800, height: 600 });
  act(() => {
    for (const fire of resizeCallbacks) fire();
  });

  return {
    host,
    root,
    viewport,
    stage,
    cleanup() {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("getPreviewPlayerKey", () => {
  it("uses projectId as key when no directUrl", () => {
    expect(getPreviewPlayerKey({ projectId: "timeline-edit-playground" })).toBe(
      "timeline-edit-playground",
    );
  });

  it("switches identity when drilling into a different directUrl", () => {
    expect(
      getPreviewPlayerKey({
        projectId: "timeline-edit-playground",
        directUrl: "/api/projects/timeline-edit-playground/preview",
      }),
    ).not.toBe(
      getPreviewPlayerKey({
        projectId: "timeline-edit-playground",
        directUrl: "/api/projects/timeline-edit-playground/preview/comp/compositions/intro.html",
      }),
    );
  });
});

describe("resolvePreviewStageSize", () => {
  it("reserves the ruler gutter on both sides of both axes", () => {
    const wide = { width: 1920, height: 1080 };
    const tall = { width: 1080, height: 1920 };
    expect(resolvePreviewStageSize(512, 402, wide, undefined, 16)).toEqual({
      width: 464,
      height: 261,
    });
    expect(resolvePreviewStageSize(512, 402, tall, undefined, 16)).toEqual({
      width: 199.125,
      height: 354,
    });
  });

  it("fits portrait composition dimensions by height in a narrow viewport", () => {
    expect(resolvePreviewStageSize(512, 402, { width: 1080, height: 1920 }, undefined)).toEqual({
      width: 217.125,
      height: 386,
    });
  });

  it("uses composition dimensions ahead of the legacy portrait fallback", () => {
    expect(resolvePreviewStageSize(512, 402, { width: 1920, height: 1080 }, true)).toEqual({
      width: 496,
      height: 279,
    });
  });
});

describe("NLEPreview", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it("pans the preview with middle mouse drag", () => {
    const view = renderPreview();
    const target = document.createElement("div");
    view.stage.appendChild(target);

    act(() => {
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          button: 1,
          clientX: 240,
          clientY: 180,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          clientX: 300,
          clientY: 220,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
        }),
      );
    });

    expect(view.stage.style.transform).toContain("translate3d(48px, 40px, 0)");
    view.cleanup();
  });

  it("pans the preview with a two-finger wheel gesture", () => {
    const view = renderPreview();
    const target = document.createElement("div");
    view.stage.appendChild(target);

    act(() => {
      target.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 240,
          clientY: 180,
          deltaX: -30,
          deltaY: 24,
        }),
      );
    });

    expect(view.stage.style.transform).toContain("translate3d(30px, -24px, 0)");
    view.cleanup();
  });

  it("clips a shadow reload so its own loading overlay cannot paint over the live frame", () => {
    const view = renderPreview([
      { gen: 0, role: "live" },
      { gen: 1, role: "shadow", url: "/api/projects/p/preview?_t=1" },
    ]);
    const players = [...view.stage.querySelectorAll<HTMLElement>('[data-testid="mock-player"]')];
    expect(players).toHaveLength(2);
    expect(players[0].style.clipPath).toBe("");
    expect(players[1].style.clipPath).toBe("inset(100%)");
    expect(players[1].style.visibility).toBe("hidden");
    view.cleanup();
  });

  it("mounts the live player once when the composition switches", () => {
    playerMounts.length = 0;
    const Harness = ({ projectId }: { projectId: string }) => {
      const api = useTimelinePlayer();
      return React.createElement(NLEPreview, {
        projectId,
        iframeRef: api.iframeRef,
        onIframeLoad: api.onIframeLoad,
        previewSlots: api.previewSlots,
        onShadowIframeLoad: api.onShadowIframeLoad,
        onShadowReadyChange: api.onShadowReadyChange,
        onShadowError: api.onShadowError,
        setShadowIframeNode: api.setShadowIframeNode,
        resetPreviewSlots: api.resetPreviewSlots,
      });
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(React.createElement(Harness, { projectId: "a" })));
    expect(playerMounts).toEqual(["live"]);

    act(() => root.render(React.createElement(Harness, { projectId: "b" })));
    expect(playerMounts).toEqual(["live", "live"]);

    act(() => root.unmount());
    host.remove();
  });
});
