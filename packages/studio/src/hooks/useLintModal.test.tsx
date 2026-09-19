// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLintModal } from "./useLintModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let latest: ReturnType<typeof useLintModal> | null = null;

function Probe() {
  latest = useLintModal("demo");
  return null;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  latest = null;
  vi.unstubAllGlobals();
});

async function mountWithLint(response: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(response));
  root = createRoot(document.createElement("div"));
  await act(async () => root?.render(<Probe />));
  await act(async () => {
    await latest?.handleLint();
  });
}

const lintResponse = (findings: Array<{ severity: string; message: string }>) => async () => ({
  json: async () => ({ findings }),
});

describe("useLintModal hasLintError", () => {
  it("is true when a finding is an error and false for warnings only", async () => {
    await mountWithLint(lintResponse([{ severity: "error", message: "nested" }]));
    expect(latest?.hasLintError).toBe(true);
    act(() => root?.unmount());
    root = null;
    await mountWithLint(lintResponse([{ severity: "warning", message: "soft" }]));
    expect(latest?.hasLintError).toBe(false);
  });

  it("is true when the manual lint itself fails, matching the badge count", async () => {
    await mountWithLint(async () => {
      throw new Error("offline");
    });
    expect(latest?.lintModal).toHaveLength(1);
    expect(latest?.hasLintError).toBe(true);
  });
});
