// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupFindings, useLintModal } from "./useLintModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const requested: string[] = [];

function findingsFor(projectId: string) {
  return [
    { severity: "error", message: `${projectId} one`, elementId: "el-1", file: "index.html" },
    { severity: "warning", message: `${projectId} two`, elementId: "el-1", file: "index.html" },
    { severity: "warning", message: `${projectId} three`, elementId: "el-2", file: "other.html" },
  ];
}

beforeEach(() => {
  requested.length = 0;
  vi.stubGlobal("fetch", (url: string) => {
    requested.push(url);
    const projectId = /projects\/([^/]+)\/lint/.exec(url)?.[1] ?? "";
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ findings: findingsFor(projectId) }),
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("groupFindings", () => {
  it("groups by key and keeps every message", () => {
    const grouped = groupFindings(
      findingsFor("p").map((f) => ({ ...f, severity: "warning" as const })),
      (f) => f.elementId,
    );
    expect([...grouped.keys()]).toEqual(["el-1", "el-2"]);
    expect(grouped.get("el-1")).toEqual({ count: 2, messages: ["p one", "p two"] });
  });

  it("skips findings whose key is undefined", () => {
    const grouped = groupFindings(
      [{ severity: "warning" as const, message: "no id" }],
      (f) => f.elementId,
    );
    expect(grouped.size).toBe(0);
  });
});

describe("useLintModal", () => {
  /**
   * Retention regression. A `useCallback` keyed on `projectId` is rebuilt on
   * every project switch, and the stale one is stored into the new render's
   * scope — chaining each render scope to the previous one so every switch
   * pins a whole lint result (~240 findings) forever. Stable identities are
   * the observable form of "the previous scope was released".
   */
  it("keeps callback identities across project switches while still linting the new project", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let current: ReturnType<typeof useLintModal> | null = null;

    function Harness({ projectId }: { projectId: string }) {
      current = useLintModal(projectId);
      return null;
    }

    await act(async () => {
      root.render(React.createElement(Harness, { projectId: "alpha" }));
    });
    const first = current!;
    expect(requested).toEqual(["/api/projects/alpha/lint"]);
    expect(first.backgroundFindings.map((f) => f.message)).toEqual([
      "alpha one",
      "alpha two",
      "alpha three",
    ]);
    expect([...first.findingsByElement.keys()]).toEqual(["el-1", "el-2"]);

    await act(async () => {
      root.render(React.createElement(Harness, { projectId: "beta" }));
    });
    const second = current!;

    expect(second.handleLint).toBe(first.handleLint);
    expect(second.closeLintModal).toBe(first.closeLintModal);
    // The ref-read project id has to be the CURRENT one, or a stable callback
    // would keep linting the project the user left.
    expect(requested).toEqual(["/api/projects/alpha/lint", "/api/projects/beta/lint"]);
    expect(second.backgroundFindings.map((f) => f.message)).toEqual([
      "beta one",
      "beta two",
      "beta three",
    ]);

    await act(async () => {
      root.unmount();
    });
  });
});
