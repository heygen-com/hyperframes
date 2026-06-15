/**
 * Unit tests for createHttpAdapter.
 *
 * Mocks global `fetch` to verify URL construction, method/headers, error routing,
 * and flush semantics without a real server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHttpAdapter } from "./http.js";

const BASE = "/api/projects/proj-abc";

// ── fetch mock helpers ────────────────────────────────────────────────────────

function stubFetch(
  handler: (url: string, init?: RequestInit) => { ok: boolean; status?: number; body?: unknown },
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const r = handler(url, init);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.body ?? {},
    };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  stubFetch(() => ({ ok: true, body: { content: "" } }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── read() ────────────────────────────────────────────────────────────────────

describe("read()", () => {
  it("fetches the correct URL with ?optional=1", async () => {
    const mock = stubFetch(() => ({ ok: true, body: { content: "<html/>" } }));
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    await adapter.read("comp.html");
    expect(mock).toHaveBeenCalledWith(
      `${BASE}/files/${encodeURIComponent("comp.html")}?optional=1`,
    );
  });

  it("returns content on success", async () => {
    stubFetch(() => ({ ok: true, body: { content: "<html>hello</html>" } }));
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    expect(await adapter.read("comp.html")).toBe("<html>hello</html>");
  });

  it("returns undefined when response body lacks content field", async () => {
    stubFetch(() => ({ ok: true, body: {} }));
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    expect(await adapter.read("missing.html")).toBeUndefined();
  });

  it("returns undefined on 404 response", async () => {
    stubFetch(() => ({ ok: false, status: 404 }));
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    expect(await adapter.read("gone.html")).toBeUndefined();
  });

  it("throws on 5xx server error", async () => {
    stubFetch(() => ({ ok: false, status: 503 }));
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    await expect(adapter.read("comp.html")).rejects.toThrow("HTTP 503");
  });
});

// ── write() ───────────────────────────────────────────────────────────────────

describe("write()", () => {
  it("PUTs to the correct URL with text/plain body", async () => {
    const mock = stubFetch(() => ({ ok: true }));
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    await adapter.write("comp.html", "<html>new</html>");
    expect(mock).toHaveBeenCalledWith(
      `${BASE}/files/${encodeURIComponent("comp.html")}`,
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ "Content-Type": "text/plain" }),
        body: "<html>new</html>",
      }),
    );
  });

  it("fires persist:error on non-ok response without throwing", async () => {
    stubFetch(() => ({ ok: false, status: 503 }));
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    const onError = vi.fn();
    adapter.on("persist:error", onError);
    await expect(adapter.write("comp.html", "x")).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ message: "HTTP 503" }) }),
    );
  });

  it("fires persist:error on network error without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    const onError = vi.fn();
    adapter.on("persist:error", onError);
    await expect(adapter.write("comp.html", "x")).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: expect.stringContaining("network down") }),
      }),
    );
  });

  it("does not fire persist:error on success", async () => {
    stubFetch(() => ({ ok: true }));
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    const onError = vi.fn();
    adapter.on("persist:error", onError);
    await adapter.write("comp.html", "x");
    expect(onError).not.toHaveBeenCalled();
  });
});

// ── flush() ───────────────────────────────────────────────────────────────────

describe("flush()", () => {
  it("resolves immediately when no writes are in flight", async () => {
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    await expect(adapter.flush()).resolves.toBeUndefined();
  });

  it("waits for an in-flight write before resolving", async () => {
    let resolveFetch!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          await new Promise<void>((r) => {
            resolveFetch = r;
          });
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    void adapter.write("comp.html", "x"); // intentionally not awaited
    let flushed = false;
    const flushDone = adapter.flush().then(() => {
      flushed = true;
    });
    expect(flushed).toBe(false);
    resolveFetch();
    await flushDone;
    expect(flushed).toBe(true);
  });
});

// ── listVersions() / loadFrom() ───────────────────────────────────────────────

describe("listVersions()", () => {
  it("returns empty array (server versioning not exposed by this adapter)", async () => {
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    expect(await adapter.listVersions("comp.html")).toEqual([]);
  });
});

describe("loadFrom()", () => {
  it("returns undefined (server versioning not exposed by this adapter)", async () => {
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    expect(await adapter.loadFrom("comp.html", "v1")).toBeUndefined();
  });
});

// ── on() / unsubscribe ────────────────────────────────────────────────────────

describe("on() / unsubscribe", () => {
  it("unsubscribe removes the listener", async () => {
    stubFetch(() => ({ ok: false, status: 500 }));
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    const onError = vi.fn();
    const unsub = adapter.on("persist:error", onError);
    unsub();
    await adapter.write("comp.html", "x");
    expect(onError).not.toHaveBeenCalled();
  });

  it("multiple listeners all fire", async () => {
    stubFetch(() => ({ ok: false, status: 500 }));
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    const a = vi.fn();
    const b = vi.fn();
    adapter.on("persist:error", a);
    adapter.on("persist:error", b);
    await adapter.write("comp.html", "x");
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });
});
