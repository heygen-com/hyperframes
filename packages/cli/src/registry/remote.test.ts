import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The cache lives under homedir(), so the whole suite runs against a scratch
// home rather than the developer's own ~/.hyperframes.
const scratchHome = mkdtempSync(join(tmpdir(), "hf-remote-"));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => scratchHome,
}));

const {
  assetSourceUrl,
  describeCauseChain,
  fetchItemFile,
  fetchItemManifest,
  fetchRegistryManifest,
  DEFAULT_REGISTRY_URL,
} = await import("./remote.js");

const MANIFEST = {
  name: "hyperframes",
  homepage: "https://hyperframes.heygen.com",
  items: [{ name: "count-up", type: "hyperframes:component" }],
};
const ITEM = {
  name: "count-up",
  type: "hyperframes:component",
  title: "Count up",
  description: "Counter",
  files: [{ path: "count.html", target: "count.html", type: "hyperframes:snippet" }],
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body));
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
  it("rejects poisoned stale cache data instead of returning it on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok(MANIFEST));
    await fetchRegistryManifest(DEFAULT_REGISTRY_URL);
    const cache = join(scratchHome, ".hyperframes/cache");
    const file = readdirSync(cache)[0]!;
    writeFileSync(
      join(cache, file),
      JSON.stringify({
        fetchedAt: 0,
        data: { ...MANIFEST, items: [{ name: "../../outside", type: "hyperframes:component" }] },
      }),
    );
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(fetchRegistryManifest(DEFAULT_REGISTRY_URL)).resolves.toBeUndefined();
  });
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

    const fresher = {
      ...MANIFEST,
      items: [
        { name: "count-up", type: "hyperframes:component" },
        { name: "push-in", type: "hyperframes:component" },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(fresher));

    await expect(fetchRegistryManifest(DEFAULT_REGISTRY_URL, { skipCache: true })).resolves.toEqual(
      fresher,
    );
  });
});

describe("fetchItemManifest", () => {
  it("rejects a cache escape name before fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      fetchItemManifest("x/../../../.config/tool", "hyperframes:component"),
    ).rejects.toThrow(/Invalid registry item/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("rejects a response for a different requested item", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(ITEM));
    await expect(fetchItemManifest("other", "hyperframes:component")).rejects.toThrow(
      /Invalid registry manifest/,
    );
  });
  it("cancels oversized manifest responses without materializing their bodies", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { "content-length": "20000000" },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    await expect(fetchItemManifest("count-up", "hyperframes:component")).rejects.toThrow(
      /download limit/,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
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

describe("describeCauseChain", () => {
  it("surfaces the reason undici hides under cause", () => {
    // The reported failure. `fetch failed` alone describes every network
    // problem equally badly; the sentence that tells you what to do is one
    // level down, and it was being dropped.
    const err = new Error("fetch failed", {
      cause: new Error("self-signed certificate in certificate chain"),
    });

    expect(describeCauseChain(err)).toBe(
      "fetch failed (self-signed certificate in certificate chain)",
    );
  });

  it("includes an errno code when the message does not already carry it", () => {
    const inner = Object.assign(new Error("getaddrinfo ENOTFOUND example.invalid"), {
      code: "ENOTFOUND",
    });

    // The code is already in the text, so repeating it would be noise.
    expect(describeCauseChain(new Error("fetch failed", { cause: inner }))).toBe(
      "fetch failed (getaddrinfo ENOTFOUND example.invalid)",
    );
  });

  it("walks more than one level", () => {
    const deep = new Error("a", { cause: new Error("b", { cause: new Error("c") }) });

    expect(describeCauseChain(deep)).toBe("a (b; c)");
  });

  it("survives a cause cycle rather than hanging", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;

    expect(describeCauseChain(a)).toBe("a (b)");
  });

  it("returns the plain message when there is no cause", () => {
    expect(describeCauseChain(new Error("HTTP 404"))).toBe("HTTP 404");
  });
});

describe("assetSourceUrl", () => {
  const item = { name: "carousel-orbit-1", type: "hyperframes:block" } as never;

  it("resolves a plain file against the registry base", () => {
    const file = { path: "carousel-orbit-1.html" } as never;

    expect(assetSourceUrl(item, file, "https://registry.example")).toBe(
      "https://registry.example/blocks/carousel-orbit-1/carousel-orbit-1.html",
    );
  });

  it("fetches a hosted asset from its own URL, not from the registry base", () => {
    // The bug this guards: joining the base to an absolute URL yields
    // "https://registry.example/blocks/…/https://cdn.example/…", which 404s
    // with a message no reader can act on.
    const file = {
      path: "assets/carousel-images/one.jpg",
      url: "https://cdn.example/registry-assets/deadbeefdeadbeef.jpg",
    } as never;

    expect(assetSourceUrl(item, file, "https://registry.example")).toBe(
      "https://cdn.example/registry-assets/deadbeefdeadbeef.jpg",
    );
  });

  it("refuses a url that is not absolute https, rather than silently mis-joining it", () => {
    const file = { path: "assets/one.jpg", url: "http://cdn.example/one.jpg" } as never;

    expect(() => assetSourceUrl(item, file, "https://registry.example")).toThrow(
      /must be an absolute https:\/\/ URL/,
    );
  });
});

describe("bounded registry file downloads", () => {
  it.each([undefined, "1"])(
    "cancels bodies exceeding the shared budget despite length %s",
    async (length) => {
      const cancel = vi.fn();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(4));
            },
            cancel,
          }),
          { headers: length ? { "content-length": length } : {} },
        ),
      );
      const budget = { remainingBytes: 5 };
      await expect(
        fetchItemFile(ITEM as never, ITEM.files[0] as never, DEFAULT_REGISTRY_URL, budget),
      ).rejects.toThrow(/budget/);
      expect(budget.remainingBytes).toBe(0);
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
  it("shares the byte budget across concurrent files", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("12345678"));
    const budget = { remainingBytes: 10 };
    const outcomes = await Promise.allSettled(
      [1, 2].map(() =>
        fetchItemFile(ITEM as never, ITEM.files[0] as never, DEFAULT_REGISTRY_URL, budget),
      ),
    );
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(budget.remainingBytes).toBe(0);
  });
});

describe("fetchItemFile retries", () => {
  const item = { name: "blur-in", type: "hyperframes:component" } as never;
  const file = { path: "blur-in.html", target: "compositions/components/blur-in.html" } as never;

  it("recovers from a transient blip instead of failing the whole install", async () => {
    // Item files are the one uncached path, so a single blip used to kill the
    // command outright. Two cheap retries is a better trade than that.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("fetch failed", { cause: new Error("ECONNRESET") }))
      .mockResolvedValueOnce(new Response("<div>ok</div>"));

    await expect(fetchItemFile(item, file, DEFAULT_REGISTRY_URL)).resolves.toEqual(
      Buffer.from("<div>ok</div>"),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry a certificate failure, which fails identically every time", async () => {
    // The reported case: a private registry with a self-signed certificate.
    // Retrying only makes the user wait three times as long for one answer.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("fetch failed", {
        cause: new Error("self-signed certificate in certificate chain"),
      }),
    );

    await expect(fetchItemFile(item, file, DEFAULT_REGISTRY_URL)).rejects.toThrow(
      /self-signed certificate/,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("names the URL it could not reach", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("fetch failed", { cause: new Error("self-signed certificate in chain") }),
    );

    await expect(fetchItemFile(item, file, "https://private.example/registry")).rejects.toThrow(
      /https:\/\/private\.example\/registry\/components\/blur-in\/blur-in\.html/,
    );
  });

  it("gives up after a bounded number of attempts", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("fetch failed", { cause: new Error("ECONNRESET") }));

    await expect(fetchItemFile(item, file, DEFAULT_REGISTRY_URL)).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
