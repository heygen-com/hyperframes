// @vitest-environment happy-dom

import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NLEPreview, getPreviewPlayerKey, resolvePreviewStageSize } from "./NLEPreview";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../player", async () => {
  const React = await import("react");

  return {
    Player: React.forwardRef(function MockPlayer(
      props: {
        onLoad?: () => void | Promise<void>;
        style?: React.CSSProperties;
      },
      ref: React.ForwardedRef<HTMLIFrameElement>,
    ) {
      const { onLoad, style } = props;
      React.useEffect(() => {
        onLoad?.();
      }, [onLoad]);

      return React.createElement("div", {
        ref: ref as React.ForwardedRef<HTMLDivElement>,
        "data-testid": "mock-player",
        style,
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

function renderPreview() {
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

  it("keeps the previous preview visible until the incoming iframe is ready", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const iframeRef = createRef<HTMLIFrameElement>();
    let loadCount = 0;
    let resolveIncoming: (() => void) | undefined;
    const incomingReady = new Promise<void>((resolve) => {
      resolveIncoming = resolve;
    });
    const onIframeLoad = vi.fn(() => {
      loadCount += 1;
      return loadCount === 1 ? Promise.resolve() : incomingReady;
    });

    await act(async () => {
      root.render(
        React.createElement(NLEPreview, {
          projectId: "timeline-edit-playground",
          iframeRef,
          onIframeLoad,
        }),
      );
    });

    expect(host.querySelectorAll('[data-testid="mock-player"]')).toHaveLength(1);

    await act(async () => {
      root.render(
        React.createElement(NLEPreview, {
          projectId: "timeline-edit-playground",
          iframeRef,
          onIframeLoad,
          directUrl: "/api/projects/timeline-edit-playground/preview/comp/compositions/card.html",
        }),
      );
    });

    const duringHandoff = Array.from(
      host.querySelectorAll('[data-testid="mock-player"]'),
    ) as HTMLDivElement[];
    expect(duringHandoff).toHaveLength(2);
    expect(duringHandoff[0].style.pointerEvents).toBe("none");
    expect(duringHandoff[1].style.opacity).toBe("0");

    await act(async () => {
      resolveIncoming?.();
      await incomingReady;
    });

    const afterHandoff = Array.from(
      host.querySelectorAll('[data-testid="mock-player"]'),
    ) as HTMLDivElement[];
    expect(afterHandoff).toHaveLength(1);
    expect(afterHandoff[0].style.opacity).toBe("1");

    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
