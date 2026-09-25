// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SpeedMenu } from "./SpeedMenu";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(): HTMLButtonElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(<SpeedMenu playbackRate={1} setPlaybackRate={() => {}} disabled={false} />);
  });
  return document.querySelector<HTMLButtonElement>('[aria-label="Playback speed"]')!;
}

describe("SpeedMenu", () => {
  it("uses the transport readout color and portals the menu above the viewport edge", () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.getAttribute("aria-label") === "Playback speed" || this.querySelector('[aria-label="Playback speed"]')) {
        return { top: 740, bottom: 768, left: 948, right: 980, width: 32, height: 28, x: 948, y: 740, toJSON: () => ({}) };
      }
      if (this.getAttribute("role") === "menu") {
        return { top: 0, bottom: 142, left: 0, right: 56, width: 56, height: 142, x: 0, y: 0, toJSON: () => ({}) };
      }
      return originalRect.call(this);
    };

    try {
      const trigger = render();
      expect(trigger.className).toContain("text-neutral-400");
      act(() => trigger.click());

      const menu = document.querySelector<HTMLElement>('[role="menu"]');
      expect(menu?.parentElement).toBe(document.body);
      expect(menu?.className).toContain("fixed");
      expect(menu?.style.top).toBe("592px");
      expect(menu?.style.left).toBe("924px");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });
});
