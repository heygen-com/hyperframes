import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readConfig = vi.fn();
const writeConfig = vi.fn();
const tryResolveCredential = vi.fn();

vi.mock("../telemetry/config.js", () => ({
  readConfig: () => readConfig(),
  writeConfig: (c: unknown) => writeConfig(c),
}));
vi.mock("../auth/resolver.js", () => ({
  tryResolveCredential: () => tryResolveCredential(),
}));
vi.mock("../auth/client.js", () => ({
  apiBaseUrl: () => "https://miguel.heygendev.com",
  buildAuthHeaders: () => ({ authorization: "Bearer test" }),
}));

const {
  describeOutcome,
  SMART_SEARCH_MODES,
  parseSearchResponse,
  recordSmartSearchConsent,
  smartSearch,
  smartSearchConsent,
} = await import("./smartSearch.js");

const OAUTH = { type: "oauth", access_token: "test" };

function payload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      mode: "hybrid",
      catalog_version: "a".repeat(64),
      results: [{ name: "number-wheel", description: "what: a rolling counter" }],
      ...overrides,
    },
  };
}

function respondWith(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

beforeEach(() => {
  readConfig.mockReturnValue({ smartSearchEnabled: true });
  tryResolveCredential.mockResolvedValue(OAUTH);
  writeConfig.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("consent", () => {
  it("treats never-asked as not consented", () => {
    readConfig.mockReturnValue({});
    expect(smartSearchConsent()).toBeUndefined();
  });

  it("never sends a query when the caller did not consent", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await smartSearch("anything", { consented: false })).toEqual({ status: "declined" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends when the caller consents even if nothing is stored yet", async () => {
    // This is the --smart override. Re-deriving consent inside the request
    // made the flag a no-op until a preference happened to be recorded.
    readConfig.mockReturnValue({});
    respondWith(payload());
    expect((await smartSearch("counter", { consented: true })).status).toBe("ok");
  });

  it("reports a refused preference through the caller's decision", () => {
    readConfig.mockReturnValue({ smartSearchEnabled: false });
    expect(smartSearchConsent()).toBe(false);
  });

  it("persists the answer so it is asked once", () => {
    readConfig.mockReturnValue({ telemetryEnabled: true });
    recordSmartSearchConsent(true);
    expect(writeConfig).toHaveBeenCalledWith(expect.objectContaining({ smartSearchEnabled: true }));
  });
});

describe("request", () => {
  it("sends the query and limit to the configured base url", async () => {
    respondWith(payload());
    await smartSearch("counter settling", { limit: 5, consented: true });
    const url = new URL(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]));
    expect(url.origin).toBe("https://miguel.heygendev.com");
    expect(url.pathname).toBe("/v3/hyperframes/catalog/search");
    expect(url.searchParams.get("query")).toBe("counter settling");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("returns the ranked matches", async () => {
    respondWith(payload());
    const outcome = await smartSearch("counter", { consented: true });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.result.mode).toBe("hybrid");
      expect(outcome.result.matches[0]?.name).toBe("number-wheel");
    }
  });

  it("reports an empty query as unavailable without calling out", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await smartSearch("   ", { consented: true })).status).toBe("unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("degradation", () => {
  it("reports missing credentials rather than calling out", async () => {
    tryResolveCredential.mockResolvedValue(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await smartSearch("counter", { consented: true })).status).toBe("unauthenticated");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats a rejected credential as unauthenticated", async () => {
    respondWith({}, 401);
    expect((await smartSearch("counter", { consented: true })).status).toBe("unauthenticated");
  });

  it("treats a server error as unavailable", async () => {
    respondWith({}, 500);
    const outcome = await smartSearch("counter", { consented: true });
    expect(outcome).toEqual({ status: "unavailable", reason: "HTTP 500" });
  });

  it("treats a network failure as unavailable rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const outcome = await smartSearch("counter", { consented: true });
    expect(outcome.status).toBe("unavailable");
  });

  it("surfaces a remote lexical fallback as such", async () => {
    respondWith(payload({ mode: "lexical_fallback" }));
    const outcome = await smartSearch("counter", { consented: true });
    expect(outcome.status === "ok" && outcome.result.mode).toBe("lexical_fallback");

    // Every mode the server enum can emit must parse. This is the contract that
    // broke in real use while the mocked tests stayed green: the server started
    // returning "semantic" and the client rejected it as a bad response, so a
    // successful smart search silently degraded to word matching.
    // Spelled out on purpose rather than looped over SMART_SEARCH_MODES:
    // deriving the expectation from the value under test would pass no matter
    // what that value shrank to, which is exactly the drift this guards.
    for (const mode of ["semantic", "hybrid", "lexical_fallback"]) {
      expect(parseSearchResponse({ mode, results: [] }).mode).toBe(mode);
    }
    expect([...SMART_SEARCH_MODES].sort()).toEqual(["hybrid", "lexical_fallback", "semantic"]);
  });
});

describe("response parsing", () => {
  it("accepts the payload under data or at the top level", () => {
    const inner = { mode: "hybrid", catalog_version: "x", results: [] };
    expect(parseSearchResponse({ data: inner }).mode).toBe("hybrid");
    expect(parseSearchResponse(inner).mode).toBe("hybrid");
  });

  it("refuses to invent a mode", () => {
    // Defaulting to hybrid would report a ranking that never happened.
    expect(() => parseSearchResponse({ data: { results: [] } })).toThrow(/no usable mode/);
    expect(() => parseSearchResponse({ data: { mode: "guess", results: [] } })).toThrow(
      /no usable mode/,
    );
  });

  it("drops malformed entries rather than failing the whole response", () => {
    const result = parseSearchResponse({
      data: { mode: "hybrid", results: [{ name: "ok" }, { noname: true }, "junk"] },
    });
    expect(result.matches.map((m) => m.name)).toEqual(["ok"]);
  });

  it("rejects a response with no payload", () => {
    expect(() => parseSearchResponse(null)).toThrow(/no payload/);
  });
});

describe("what the user is told", () => {
  it("names every outcome distinctly", () => {
    const lines = [
      describeOutcome({
        status: "ok",
        result: { mode: "hybrid", catalogVersion: "", matches: [] },
      }),
      describeOutcome({
        status: "ok",
        result: { mode: "lexical_fallback", catalogVersion: "", matches: [] },
      }),
      describeOutcome({ status: "declined" }),
      describeOutcome({ status: "unauthenticated" }),
      describeOutcome({ status: "unavailable", reason: "HTTP 500" }),
    ];
    expect(new Set(lines).size).toBe(lines.length);
    // A degraded result must never read like a full one.
    expect(lines[1]).not.toBe(lines[0]);
    expect(lines[1]).toMatch(/degraded/);
  });
});
