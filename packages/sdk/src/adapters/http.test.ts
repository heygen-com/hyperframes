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

  it("returns undefined on non-ok response", async () => {
    stubFetch(() => ({ ok: false, status: 404 }));
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    expect(await adapter.read("gone.html")).toBeUndefined();
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

// ── headers option ───────────────────────────────────────────────────────────

describe("headers option", () => {
  it("merges static headers into every PUT request", async () => {
    const mock = stubFetch(() => ({ ok: true }));
    const adapter = createHttpAdapter({
      projectFilesUrl: BASE,
      headers: { Authorization: "Bearer tok" },
    });
    await adapter.write("comp.html", "x");
    expect(mock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
  });

  it("calls a headers function lazily on each write", async () => {
    const mock = stubFetch(() => ({ ok: true }));
    let n = 0;
    const adapter = createHttpAdapter({
      projectFilesUrl: BASE,
      headers: () => ({ Authorization: `Bearer tok${++n}` }),
    });
    await adapter.write("comp.html", "a");
    await adapter.write("comp.html", "b");
    const calls = mock.mock.calls.filter((c) => c[1]?.method === "PUT");
    expect((calls[0][1]?.headers as Record<string, string>)?.["Authorization"]).toBe("Bearer tok1");
    expect((calls[1][1]?.headers as Record<string, string>)?.["Authorization"]).toBe("Bearer tok2");
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
    await Promise.resolve(); // let path-queue microtask fire so doWrite starts
    let flushed = false;
    const flushDone = adapter.flush().then(() => {
      flushed = true;
    });
    expect(flushed).toBe(false);
    resolveFetch();
    await flushDone;
    expect(flushed).toBe(true);
  });

  it("waits for two concurrent in-flight writes before resolving", async () => {
    const resolvers: Array<() => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          await new Promise<void>((r) => resolvers.push(r));
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    void adapter.write("a.html", "1");
    void adapter.write("b.html", "2");
    await Promise.resolve(); // let both start
    await Promise.resolve();
    let flushed = false;
    const flushDone = adapter.flush().then(() => {
      flushed = true;
    });
    expect(flushed).toBe(false);
    resolvers[0]();
    await Promise.resolve();
    expect(flushed).toBe(false); // still waiting for second write
    resolvers[1]();
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

// ── write() — per-path serialization ─────────────────────────────────────────

describe("write() — per-path serialization", () => {
  it("serializes concurrent writes to the same path (second waits for first)", async () => {
    const starts: number[] = [];
    let resolveFirst!: () => void;
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          const n = ++callCount;
          starts.push(n);
          if (n === 1) await new Promise<void>((r) => (resolveFirst = r));
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    const write1 = adapter.write("comp.html", "v1");
    await Promise.resolve(); // let write1 start
    const write2 = adapter.write("comp.html", "v2");
    await Promise.resolve(); // let write2 attempt to start
    expect(starts).toEqual([1]); // write2 has NOT started yet
    resolveFirst();
    await write1;
    await write2;
    expect(starts).toEqual([1, 2]); // write2 started only after write1 finished
  });

  it("does not block writes to different paths", async () => {
    const starts: string[] = [];
    let resolveFirst!: () => void;
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          const n = ++callCount;
          starts.push(`${n}:${url.split("/").pop()}`);
          if (n === 1) await new Promise<void>((r) => (resolveFirst = r));
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const adapter = createHttpAdapter({ projectFilesUrl: BASE });
    const write1 = adapter.write("a.html", "v1");
    await Promise.resolve();
    void adapter.write("b.html", "v2"); // different path — must not wait for write1
    await Promise.resolve();
    expect(starts.length).toBe(2); // both started concurrently
    resolveFirst();
    await write1;
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
