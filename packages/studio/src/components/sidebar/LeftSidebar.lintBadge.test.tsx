// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeftSidebar } from "./LeftSidebar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
(
  window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }
).happyDOM.settings.disableIframePageLoading = true;

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function renderBadge(lintHasError: boolean): HTMLElement | null {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <LeftSidebar
        projectId="demo"
        compositions={["index.html"]}
        assets={[]}
        fileTree={["index.html"]}
        activeComposition={null}
        onSelectComposition={vi.fn()}
        onLint={vi.fn()}
        lintFindingCount={2}
        lintHasError={lintHasError}
      />,
    );
  });
  return host.querySelector<HTMLElement>("[data-lint-badge]");
}

describe("LeftSidebar lint badge", () => {
  it("pulses, and stops for reduced motion, while an error finding exists", () => {
    const badge = renderBadge(true);
    expect(badge?.dataset.lintBadge).toBe("error");
    expect(badge?.className).toContain("animate-pulse");
    expect(badge?.className).toContain("motion-reduce:animate-none");
  });

  it("stays still when the findings are warnings only", () => {
    const badge = renderBadge(false);
    expect(badge?.dataset.lintBadge).toBe("warning");
    expect(badge?.className).not.toContain("animate-pulse");
  });
});
