// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Catalog = Awaited<ReturnType<typeof loadHook>>;

/**
 * The catalog is cached in module scope, so each case needs its own module
 * instance or the second one reads the first one's answer.
 */
async function loadHook() {
  vi.resetModules();
  const { useBlockCatalog } = await import("./useBlockCatalog");
  return useBlockCatalog;
}

/** One snapshot per render, so the assertions read a list instead of a mutated binding. */
const states: { loading: boolean; error: string | null; blocks: unknown[] }[] = [];

async function render(useBlockCatalog: Catalog) {
  function Probe() {
    const { blocks, loading, error } = useBlockCatalog();
    states.push({ loading, error, blocks });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<Probe />);
  });
  return () => act(() => root.unmount());
}

beforeEach(() => {
  states.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useBlockCatalog", () => {
  it("ends loading with the fetched blocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [{ title: "Fade", description: "", tags: ["transition"] }],
      })),
    );

    const unmount = await render(await loadHook());

    const last = states[states.length - 1]!;
    expect(last.loading).toBe(false);
    expect(last.error).toBeNull();
    expect(last.blocks).toHaveLength(1);
    unmount();
  });

  it("ends loading with the failure message when the catalog request rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    const unmount = await render(await loadHook());

    const last = states[states.length - 1]!;
    expect(last.loading).toBe(false);
    expect(last.error).toBe("offline");
    expect(last.blocks).toEqual([]);
    unmount();
  });

  it("ends loading with a message when the catalog responds not-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => [] })),
    );

    const unmount = await render(await loadHook());

    const last = states[states.length - 1]!;
    expect(last.loading).toBe(false);
    expect(last.error).toBe("Failed to load catalog");
    unmount();
  });
});
