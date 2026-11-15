import { describe, expect, it, vi } from "vitest";

const started = vi.hoisted(() => ({ count: 0 }));

vi.mock("./services/renderOrchestrator.js", () => {
  class RenderCancelledError extends Error {}

  return {
    RenderCancelledError,
    createRenderJob: (config: Record<string, unknown>) => ({
      config,
      progress: 0,
      currentStage: "queued",
      framesRendered: 0,
      totalFrames: 0,
      warnings: [],
    }),
    executeRenderJob: async (job: Record<string, unknown>) => {
      started.count += 1;
      job.outcome = "completed";
    },
  };
});

import { createProducerApp, type HandlerOptions } from "./server.js";

function postRender(headers: Record<string, string>, options: HandlerOptions = {}) {
  return createProducerApp(options).request("http://localhost:9847/render", {
    method: "POST",
    headers: { host: "localhost:9847", ...headers },
    body: JSON.stringify({ html: "<html><body></body></html>" }),
  });
}

describe("createProducerApp: cross-origin browser requests", () => {
  it("refuses a page on another origin, even as a text/plain simple request", async () => {
    const before = started.count;
    const res = await postRender({ origin: "https://example.com", "content-type": "text/plain" });
    expect(res.status).toBe(403);
    expect(started.count).toBe(before);
  });

  it("refuses a malformed origin", async () => {
    expect((await postRender({ origin: "null" })).status).toBe(403);
  });

  it.each(["cross-site", "same-site"])(
    "refuses a page the browser marks %s, even when Origin matches Host",
    async (fetchSite) => {
      const res = await postRender({
        origin: "http://localhost:9847",
        "sec-fetch-site": fetchSite,
      });
      expect(res.status).toBe(403);
    },
  );

  it.each([
    ["no Origin (curl, server-to-server)", {}],
    ["a same-origin page", { origin: "http://localhost:9847" }],
  ])("renders for %s", async (_label, headers) => {
    const res = await postRender({ "content-type": "application/json", ...headers });
    expect(res.status).toBe(200);
  });

  it("renders for a same-origin page behind a proxy that rewrites Host once its name is allowed", async () => {
    const headers = {
      "content-type": "application/json",
      origin: "https://render.example.com",
      "sec-fetch-site": "same-origin",
    };
    expect((await postRender(headers)).status).toBe(403);
    expect((await postRender(headers, { allowedHosts: ["render.example.com"] })).status).toBe(200);
  });
});

describe("createProducerApp: browser requests under a rebound host name", () => {
  const rebound = { host: "attacker.example:9847", origin: "http://attacker.example:9847" };

  function request(path: string, headers: Record<string, string>, options: HandlerOptions = {}) {
    const method = path === "/render" ? "POST" : "GET";
    return createProducerApp(options).request(`http://localhost:9847${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: method === "POST" ? JSON.stringify({ html: "<html><body></body></html>" }) : undefined,
    });
  }

  it.each([
    ["with Sec-Fetch-Site: same-origin", { ...rebound, "sec-fetch-site": "same-origin" }],
    ["without Sec-Fetch-Site", rebound],
  ])("refuses a render %s and starts nothing", async (_label, headers) => {
    const before = started.count;
    const res = await request("/render", headers);
    expect(res.status).toBe(403);
    expect(started.count).toBe(before);
  });

  it("refuses an output download and a queue read the same way", async () => {
    const headers = { ...rebound, "sec-fetch-site": "same-origin" };
    expect((await request("/outputs/some-token", headers)).status).toBe(403);
    expect((await request("/render/queue", headers)).status).toBe(403);
  });

  it("refuses a page whose own origin is a rebindable name even when Host is loopback", async () => {
    const res = await request("/render", {
      host: "localhost:9847",
      origin: "http://attacker.example:9847",
      "sec-fetch-site": "same-origin",
    });
    expect(res.status).toBe(403);
  });

  it.each([
    ["127.0.0.1", "127.0.0.1:9847"],
    ["a LAN address", "192.168.1.20:9847"],
    ["IPv6 loopback", "[::1]:9847"],
    ["a *.localhost name", "studio.localhost:9847"],
  ])("serves a same-origin page on %s", async (_label, host) => {
    const res = await request("/render", {
      host,
      origin: `http://${host}`,
      "sec-fetch-site": "same-origin",
    });
    expect(res.status).toBe(200);
  });

  it("serves a listed name, from options or PRODUCER_ALLOWED_HOSTS, matched without port or case", async () => {
    const headers = { ...rebound, "sec-fetch-site": "same-origin" };
    expect((await request("/render", headers, { allowedHosts: ["Attacker.Example"] })).status).toBe(
      200,
    );
    vi.stubEnv("PRODUCER_ALLOWED_HOSTS", " other.example , attacker.example:443");
    try {
      expect((await request("/render", headers)).status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("leaves non-browser callers alone whatever Host they send", async () => {
    const res = await request("/render", { host: "producer.internal:9847" });
    expect(res.status).toBe(200);
  });
});
