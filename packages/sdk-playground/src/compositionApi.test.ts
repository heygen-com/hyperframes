import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { PersistAdapter } from "@hyperframes/sdk";
import { describe, expect, it, vi } from "vitest";
import { createCompositionApi } from "./compositionApi";

function fakeAdapter() {
  return {
    read: vi.fn(() => Promise.resolve<string | undefined>("<main>saved</main>")),
    write: vi.fn(() => Promise.resolve()),
    flush: vi.fn(() => Promise.resolve()),
    listVersions: vi.fn(() => Promise.resolve([{ key: "v1", content: "", timestamp: 1 }])),
    loadFrom: vi.fn(() => Promise.resolve<string | undefined>(undefined)),
    on: vi.fn(() => () => {}),
  } satisfies PersistAdapter;
}

function request(
  method: string,
  headers: Record<string, string>,
  body: Buffer[] = [],
): { req: IncomingMessage; res: ServerResponse; sent: () => string } {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.url = "/";
  req.headers = headers;
  for (const chunk of body) req.push(chunk);
  req.push(null);
  const res = new ServerResponse(req);
  const end = vi.spyOn(res, "end");
  return { req, res, sent: () => String(end.mock.calls[0]?.[0] ?? "") };
}

const LOCAL = { host: "localhost:5173" };

describe("composition API", () => {
  it("serves and saves for the hosts Vite serves the page on", async () => {
    const adapter = fakeAdapter();
    const api = createCompositionApi(adapter);
    for (const host of ["localhost:5173", "127.0.0.1:5173", "[::1]:5173", "app.localhost:5173"]) {
      const get = request("GET", { host });
      await api.composition(get.req, get.res);
      expect(get.sent()).toBe("<main>saved</main>");
    }
    const put = request(
      "PUT",
      { ...LOCAL, origin: "http://localhost:5173", "sec-fetch-site": "same-origin" },
      [Buffer.from("<main>new</main>")],
    );
    await api.composition(put.req, put.res);
    expect(put.res.statusCode).toBe(204);
    expect(adapter.write).toHaveBeenCalledWith("composition.html", "<main>new</main>");
  });

  it("refuses another host name before reading or writing anything", async () => {
    const adapter = fakeAdapter();
    const api = createCompositionApi(adapter, { host: "playground.test" });
    for (const handler of [api.composition, api.versions]) {
      const get = request("GET", { host: "rebound.example:5173" });
      await handler(get.req, get.res);
      expect(get.res.statusCode).toBe(403);
    }
    const put = request("PUT", { host: "rebound.example:5173" }, [Buffer.from("<main />")]);
    await api.composition(put.req, put.res);
    expect(put.res.statusCode).toBe(403);
    const missing = request("GET", {});
    await api.composition(missing.req, missing.res);
    expect(missing.res.statusCode).toBe(403);
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.listVersions).not.toHaveBeenCalled();
    expect(adapter.write).not.toHaveBeenCalled();

    const configured = request("GET", { host: "playground.test:5173" });
    await api.composition(configured.req, configured.res);
    expect(configured.sent()).toBe("<main>saved</main>");
  });

  it("serves the hosts Vite's server options allow, and any host when Vite checks none", async () => {
    const adapter = fakeAdapter();
    const configured = createCompositionApi(adapter, {
      allowedHosts: ["tunnel.example", ".team.example"],
      origin: "https://origin.example:8443",
      hmr: { host: "hmr.example" },
    });
    for (const host of [
      "tunnel.example",
      "team.example:443",
      "me.team.example",
      "origin.example",
      "hmr.example:24678",
    ]) {
      const get = request("GET", { host });
      await configured.composition(get.req, get.res);
      expect(get.sent()).toBe("<main>saved</main>");
    }
    for (const host of ["other.example", "tunnel.example.evil", "notteam.example"]) {
      const get = request("GET", { host });
      await configured.composition(get.req, get.res);
      expect(get.res.statusCode).toBe(403);
    }
    for (const server of [{ allowedHosts: true as const }, { https: {} }]) {
      const get = request("GET", { host: "anything.example" });
      await createCompositionApi(adapter, server).composition(get.req, get.res);
      expect(get.sent()).toBe("<main>saved</main>");
    }
  });

  it("serves the composition as inert text that no page can render or frame", async () => {
    const api = createCompositionApi(fakeAdapter());
    const get = request("GET", LOCAL);
    await api.composition(get.req, get.res);
    expect(get.res.getHeader("content-type")).toBe("text/plain; charset=utf-8");
    expect(get.res.getHeader("x-content-type-options")).toBe("nosniff");
    expect(get.res.getHeader("x-frame-options")).toBe("DENY");
    expect(get.res.getHeader("content-security-policy")).toBe(
      "sandbox; default-src 'none'; frame-ancestors 'none'",
    );
  });

  it("answers a save whose client disconnects before the body ends", async () => {
    const adapter = fakeAdapter();
    const api = createCompositionApi(adapter);
    const req = new IncomingMessage(new Socket());
    req.method = "PUT";
    req.url = "/";
    req.headers = LOCAL;
    req.push(Buffer.from("<main>"));
    const res = new ServerResponse(req);
    const handled = api.composition(req, res);
    req.destroy();
    await handled;
    expect(res.statusCode).toBe(400);
    expect(adapter.write).not.toHaveBeenCalled();
  }, 1000);

  it("refuses a save that another site started", async () => {
    const adapter = fakeAdapter();
    const api = createCompositionApi(adapter);
    for (const headers of [
      { ...LOCAL, origin: "https://elsewhere.example" },
      { ...LOCAL, origin: "http://localhost:3000" },
      { ...LOCAL, origin: "null" },
      { ...LOCAL, "sec-fetch-site": "cross-site" },
      { ...LOCAL, "sec-fetch-site": "same-site" },
    ]) {
      const put = request("PUT", headers, [Buffer.from("<main />")]);
      await api.composition(put.req, put.res);
      expect(put.res.statusCode).toBe(403);
    }
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("refuses a composition body over the size limit", async () => {
    const adapter = fakeAdapter();
    const api = createCompositionApi(adapter);
    const half = Buffer.alloc(16 * 1024 * 1024 + 1, "a");
    const put = request("PUT", LOCAL, [half, half]);
    await api.composition(put.req, put.res);
    expect(put.res.statusCode).toBe(413);
    expect(adapter.write).not.toHaveBeenCalled();
  });
});
