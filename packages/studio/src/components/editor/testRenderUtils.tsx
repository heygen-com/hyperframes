import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach } from "vitest";

/**
 * Marks the current environment as React-act-aware and registers the shared
 * per-test DOM cleanup. Call once per test file, at module scope, before any
 * `describe`/`it` blocks run.
 */
export function setupReactActEnvironment(): void {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  afterEach(() => {
    document.body.innerHTML = "";
  });
}

export function renderInto(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return { host, root };
}
