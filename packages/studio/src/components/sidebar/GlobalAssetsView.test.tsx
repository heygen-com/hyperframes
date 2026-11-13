// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { GlobalAssetsView } from "./GlobalAssetsView";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const EMPTY_CACHE = "No assets in the global cache yet";
const FAILURE = "Couldn't load the global asset cache";
const LOADING = "Loading global assets";
const LOGO = { id: "logo", type: "image", description: "Brand logo" };

let fetchMock: Mock<typeof fetch>;
let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function show(searchQuery: string): Promise<void> {
  await act(async () => root?.render(<GlobalAssetsView searchQuery={searchQuery} />));
  await settle();
}

async function mount(searchQuery = ""): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await show(searchQuery);
}

function tryAgainButton(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again");
}

describe("GlobalAssetsView", () => {
  it.each([
    ["an error status", () => fetchMock.mockResolvedValueOnce(respond(500, { error: "boom" }))],
    ["a rejected request", () => fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))],
  ])("reports %s as a failure instead of an empty cache", async (_case, failOnce) => {
    failOnce();
    await mount();

    expect(host.textContent).toContain(FAILURE);
    expect(host.textContent).not.toContain(EMPTY_CACHE);
    expect(tryAgainButton()).toBeDefined();
  });

  it("keeps the empty-cache guidance for a successful empty response", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { assets: [] }));
    await mount();

    expect(host.textContent).toContain(EMPTY_CACHE);
    expect(host.textContent).not.toContain(FAILURE);
  });

  it("says a search matched nothing, and restores the rows without refetching when it clears", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { assets: [LOGO] }));
    await mount("zzz");

    expect(host.textContent).toContain("No global assets match");
    expect(host.textContent).not.toContain(EMPTY_CACHE);

    await show("");

    expect(host.textContent).toContain("Brand logo");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the cached assets", { assets: [LOGO] }, "Brand logo"],
    ["the empty-cache guidance", { assets: [] }, EMPTY_CACHE],
  ])("retries a failed request only on request, then shows %s", async (_case, body, expected) => {
    let answerRetry: (response: Response) => void = () => {};
    fetchMock.mockResolvedValueOnce(respond(503, {})).mockReturnValueOnce(
      new Promise((resolve) => {
        answerRetry = resolve;
      }),
    );
    await mount();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => tryAgainButton()?.click());

    expect(host.textContent).toContain(LOADING);

    await act(async () => answerRetry(respond(200, body)));
    await settle();

    expect(host.textContent).toContain(expected);
    expect(tryAgainButton()).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
