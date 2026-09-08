// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLintModal } from "./useLintModal";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function mountLintModal(projectId: string | null) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let current: ReturnType<typeof useLintModal> | null = null;

  function Harness() {
    current = useLintModal(projectId);
    return null;
  }

  act(() => root.render(React.createElement(Harness)));
  return {
    read: () => {
      if (!current) throw new Error("useLintModal did not render");
      return current;
    },
    unmount: () => act(() => root.unmount()),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useLintModal", () => {
  it("clears the in-progress flag after a lint run succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          findings: [{ severity: "error", message: "missing clip", elementId: "hf-1" }],
        }),
      })),
    );
    const harness = mountLintModal("demo");

    await act(async () => {
      harness.read().handleLint();
    });

    expect(harness.read().linting).toBe(false);
    expect(harness.read().lintModal).toEqual([
      {
        severity: "error",
        message: "missing clip",
        file: undefined,
        fixHint: undefined,
        elementId: "hf-1",
      },
    ]);
    harness.unmount();
  });

  it("clears the in-progress flag and reports the failure when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const harness = mountLintModal("demo");

    await act(async () => {
      harness.read().handleLint();
    });

    // The teardown the removed `finally` clause used to own: a failed run must
    // not leave the button spinning.
    expect(harness.read().linting).toBe(false);
    expect(harness.read().lintModal).toEqual([
      { severity: "error", message: "Failed to run lint: network down" },
    ]);
    harness.unmount();
  });

  it("leaves the flag alone for a background run and does not open the modal", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ findings: [{ severity: "warning", message: "slow clip" }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const harness = mountLintModal("demo");

    // Mounting fires the automatic background run.
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(harness.read().linting).toBe(false);
    expect(harness.read().lintModal).toBeNull();
    expect(harness.read().backgroundFindings).toHaveLength(1);
    harness.unmount();
  });
});
