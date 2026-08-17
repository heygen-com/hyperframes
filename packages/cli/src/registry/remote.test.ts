import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The cache lives under homedir(), so the whole suite runs against a scratch
// home rather than the developer's own ~/.hyperframes.
const scratchHome = mkdtempSync(join(tmpdir(), "hf-remote-"));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => scratchHome,
}));

const { fetchItemManifest, fetchRegistryManifest, DEFAULT_REGISTRY_URL } =
  await import("./remote.js");

const MANIFEST = { name: "hyperframes", items: [{ name: "count-up" }] };
const ITEM = { name: "count-up", type: "hyperframes:component", files: [] };

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/**
 * Prime the cache with one good fetch, then jump past the 24h TTL with every
 * later fetch failing: the exact shape of "the registry host stopped answering
 * and the copy on disk is a day old". Returns the failing spy so a caller can
 * assert the network was actually attempted — without that the fallback
 * assertions pass even if the clock never moved.
 */
async function staleAfterPriming(
  body: unknown,
  prime: () => Promise<unknown>,
): Promise<MockInstance<typeof fetch>> {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok(body));
  await prime();

  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(Date.now() + ONE_DAY_MS + 60_000));
  return vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("The operation was aborted"));
}

beforeEach(() => {
  rmSync(join(scratchHome, ".hyperframes"), { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  rmSync(scratchHome, { recursive: true, force: true });
});

describe("fetchRegistryManifest", () => {
  it("serves a fresh cache without touching the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(MANIFEST));
    await fetchRegistryManifest(DEFAULT_REGISTRY_URL);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await fetchRegistryManifest(DEFAULT_REGISTRY_URL);

    expect(second).toEqual(MANIFEST);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("serves the expired cache when the registry host times out", async () => {
    // The failure this exists for: raw.githubusercontent.com stops answering,
    // the entry is a day and a bit old, and before this fix the caller was
    // told the whole catalog was unreachable while a usable copy sat on disk.
    const fetchSpy = await staleAfterPriming(MANIFEST, () =>
      fetchRegistryManifest(DEFAULT_REGISTRY_URL),
    );

    await expect(fetchRegistryManifest(DEFAULT_REGISTRY_URL)).resolves.toEqual(MANIFEST);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("treats an empty cached payload as a miss rather than an answer", async () => {
    // The callers test the entry, not the payload, so a file carrying a valid
    // fetchedAt and a null body would otherwise short-circuit the fetch and be
    // handed back as a manifest.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok(null));
    await fetchRegistryManifest(DEFAULT_REGISTRY_URL);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(MANIFEST));

    await expect(fetchRegistryManifest(DEFAULT_REGISTRY_URL)).resolves.toEqual(MANIFEST);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("still reports unreachable when the network fails and nothing was cached", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

    await expect(fetchRegistryManifest(DEFAULT_REGISTRY_URL)).resolves.toBeUndefined();
  });

  it("falls back to the stale copy under skipCache too", async () => {
    // skipCache asks for something newer. It has never meant "rather have
    // nothing than this", so a failed revalidation must not empty the result.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok(MANIFEST));
    await fetchRegistryManifest(DEFAULT_REGISTRY_URL);

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("HTTP 503"));

    await expect(fetchRegistryManifest(DEFAULT_REGISTRY_URL, { skipCache: true })).resolves.toEqual(
      MANIFEST,
    );
  });

  it("prefers a successful refetch over the cached copy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok(MANIFEST));
    await fetchRegistryManifest(DEFAULT_REGISTRY_URL);

    const fresher = { ...MANIFEST, items: [{ name: "count-up" }, { name: "push-in" }] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(fresher));

    await expect(fetchRegistryManifest(DEFAULT_REGISTRY_URL, { skipCache: true })).resolves.toEqual(
      fresher,
    );
  });
});

describe("fetchItemManifest", () => {
  it("serves the expired cache when the item fetch fails", async () => {
    const fetchSpy = await staleAfterPriming(ITEM, () =>
      fetchItemManifest("count-up", "hyperframes:component", DEFAULT_REGISTRY_URL),
    );

    await expect(
      fetchItemManifest("count-up", "hyperframes:component", DEFAULT_REGISTRY_URL),
    ).resolves.toEqual(ITEM);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("still throws when the item fetch fails and nothing was cached", async () => {
    // The documented contract for a genuinely unknown item, unchanged: callers
    // that install by name have to be able to tell "offline" from "no such item".
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("The operation was aborted"));

    await expect(
      fetchItemManifest("never-fetched", "hyperframes:component", DEFAULT_REGISTRY_URL),
    ).rejects.toThrow("The operation was aborted");
  });

  it("surfaces an HTTP error for an item that does not exist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as unknown as Response);

    await expect(
      fetchItemManifest("no-such-move", "hyperframes:component", DEFAULT_REGISTRY_URL),
    ).rejects.toThrow("HTTP 404");
  });
});
