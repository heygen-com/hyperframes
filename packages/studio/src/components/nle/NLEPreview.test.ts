// @vitest-environment happy-dom

import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NLEPreview, getPreviewPlayerKey } from "./NLEPreview";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../player", async () => {
  const React = await import("react");

  return {
    Player: React.forwardRef(function MockPlayer(
      props: {
        onLoad?: () => void;
        style?: React.CSSProperties;
      },
      ref: React.ForwardedRef<HTMLIFrameElement>,
    ) {
      React.useEffect(() => {
        props.onLoad?.();
      }, [props]);

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

class MockResizeObserver {
  observe() {}
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
  it("keeps the same player identity when only refreshKey changes", () => {
    expect(
      getPreviewPlayerKey({
        projectId: "timeline-edit-playground",
        refreshKey: 1,
      }),
    ).toBe(
      getPreviewPlayerKey({
        projectId: "timeline-edit-playground",
        refreshKey: 2,
      }),
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

    expect(view.stage.style.transform).toContain("translate(48px, 40px)");
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

    expect(view.stage.style.transform).toContain("translate(30px, -24px)");
    view.cleanup();
  });
});
