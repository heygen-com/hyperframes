import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { registerVstRoutes } from "./vst";

function makeApi(adapter: Record<string, unknown>): Hono {
  const api = new Hono();
  registerVstRoutes(api, adapter as never);
  return api;
}

describe("vst routes", () => {
  it("POST /vst/start returns the sidecar port and token", async () => {
    const api = makeApi({
      startVstSidecar: () => Promise.resolve({ port: 9555, token: "secret-token" }),
      getVstSidecarStatus: () => ({ running: true, port: 9555 }),
    });
    const res = await api.request("/vst/start", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ port: 9555, token: "secret-token" });
  });

  it("POST /vst/start returns 503 with install hint when unsupported", async () => {
    const api = makeApi({});
    const res = await api.request("/vst/start", { method: "POST" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.installHint).toContain("uv tool install");
  });

  it("GET /vst/status reflects adapter state", async () => {
    const api = makeApi({ getVstSidecarStatus: () => ({ running: false, port: null }) });
    const res = await api.request("/vst/status");
    expect(await res.json()).toEqual({ running: false, port: null });
  });
});
