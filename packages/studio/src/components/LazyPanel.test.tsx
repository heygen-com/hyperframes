// @vitest-environment happy-dom
import { act, lazy, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyPanel } from "./LazyPanel";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  vi.restoreAllMocks();
});

async function render(node: ReactNode): Promise<HTMLDivElement> {
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () => root?.render(node));
  return host;
}

describe("LazyPanel", () => {
  it("keeps the panel slot occupied while a chunk loads", async () => {
    const Pending = lazy(() => new Promise<never>(() => undefined));
    const host = await render(
      <LazyPanel label="source editor">
        <Pending />
      </LazyPanel>,
    );

    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Loading source editor…");
    expect(status?.classList.contains("h-full")).toBe(true);
    expect(status?.classList.contains("flex-1")).toBe(true);
  });

  it("surfaces a rejected chunk load as a visible retry state", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Rejected = lazy(() => Promise.reject(new Error("chunk unavailable")));
    const host = await render(
      <LazyPanel label="source editor">
        <Rejected />
      </LazyPanel>,
    );

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn’t load source editor.");
    expect(alert?.querySelector("button")?.textContent).toBe("Retry");
  });
});
