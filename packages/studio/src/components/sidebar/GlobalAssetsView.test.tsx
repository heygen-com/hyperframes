// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalAssetsView } from "./GlobalAssetsView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderGlobalAssets(searchQuery = ""): Promise<HTMLDivElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<GlobalAssetsView searchQuery={searchQuery} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

describe("GlobalAssetsView", () => {
  it("shows a request failure instead of empty-cache guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream failed", { status: 503 })),
    );

    const host = await renderGlobalAssets();

    expect(host.textContent).toContain("Unable to load global assets");
    expect(host.textContent).not.toContain("No assets in the global cache yet");
  });

  it("shows empty-cache guidance for a successful empty response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ assets: [] }), { status: 200 })),
    );

    const emptyHost = await renderGlobalAssets();
    expect(emptyHost.textContent).toContain("No assets in the global cache yet");
  });

  it("reports no matches when records exist but the query filters them out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ assets: [{ id: "logo", type: "image", description: "Brand logo" }] }),
            { status: 200 },
          ),
      ),
    );

    const host = await renderGlobalAssets("zzz");

    expect(host.textContent).toContain("No global assets match");
    expect(host.textContent).not.toContain("No assets in the global cache yet");
  });

  it("retries only after the user requests recovery", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream failed", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ assets: [{ id: "logo", type: "image", description: "Brand logo" }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const host = await renderGlobalAssets();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const retry = host.querySelector("button");
    expect(retry?.textContent).toBe("Retry");
    await act(async () => {
      retry?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Brand logo");
  });
});
