import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { ShareService, ShareState } from "../share/service.js";
import { mountShareRoutes } from "./shareRoutes.js";
import { createShareCsrf, localShareRequestAllowed } from "./shareBoundary.js";

const state: ShareState = {
  share: null,
  version: { last: null, source: "none", exporting: null, failure: null },
  pending: null,
  state: "not_shared",
  ready: false,
  url: null,
  previousUrl: null,
  manageUrl: "https://hyperframes.dev/shares",
};
function fixture() {
  const service: ShareService = {
    status: vi.fn(async () => state),
    run: vi.fn(async () => state),
    spaces: vi.fn(async () => []),
    capabilities: vi.fn(async () => ({ versionSharing: true, shareFiles: false })),
    setAccess: vi.fn(async () => state),
    linkOff: vi.fn(async () => state),
    linkOn: vi.fn(async () => state),
  };
  const app = new Hono();
  const create = vi.fn(async () => service);
  mountShareRoutes(app, "/fixed/project", create);
  return { app, service, create };
}
const headers = {
  host: "localhost:3000",
  origin: "http://localhost:3000",
  "sec-fetch-site": "same-origin",
};
async function token(app: Hono) {
  const response = await app.request("/api/share/bootstrap", { headers });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("csrf" in body) || typeof body.csrf !== "string")
    throw new Error("missing token");
  return body.csrf;
}
function request(app: Hono, path: string, csrf: string, body?: unknown) {
  return app.request(`/api/share/${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...headers, "x-hyperframes-share-csrf": csrf, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
describe("local share boundary", () => {
  it.each([
    { ...headers, host: "evil.example" },
    { ...headers, origin: "https://evil.example" },
    { ...headers, "sec-fetch-site": "cross-site" },
    { ...headers, "sec-fetch-site": "none" },
    { host: headers.host },
    { ...headers, host: "192.168.1.2:3000", origin: "http://192.168.1.2:3000" },
    { ...headers, host: "localhost:3000@evil.example" },
  ])("denies foreign, LAN and missing-origin requests before authentication %j", async (input) => {
    const { app, create } = fixture();
    expect((await app.request("/api/share/bootstrap", { headers: input })).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
  it("allows same-origin browser GET Referer and IPv6 loopback", () => {
    expect(
      localShareRequestAllowed(
        new Request("http://localhost:3000/api/share/bootstrap", {
          headers: {
            host: headers.host,
            referer: "http://localhost:3000/?project=x",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    ).toBe(true);
    expect(
      localShareRequestAllowed(
        new Request("http://[::1]:3000/api/share/bootstrap", {
          headers: {
            host: "[::1]:3000",
            origin: "http://[::1]:3000",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    ).toBe(true);
  });
  it("guards reads and mutations with a separate token for each server", async () => {
    const one = fixture(),
      two = fixture();
    const csrf = await token(one.app);
    for (const [path, body] of [
      ["snapshot", undefined],
      ["jobs/x", undefined],
      ["actions", { action: "off" }],
    ] as const) {
      expect((await request(one.app, path, "", body)).status).toBe(403);
      expect((await request(two.app, path, csrf, body)).status).toBe(403);
    }
    expect((await request(one.app, "snapshot", csrf)).status).toBe(200);
    expect(one.create).toHaveBeenCalledWith("/fixed/project", expect.any(Function));
    expect(two.create).not.toHaveBeenCalled();
    const guard = createShareCsrf();
    expect(guard.accepts("💜".repeat(43))).toBe(false);
  });
});
it("requires explicit first audience and refuses arbitrary project paths", async () => {
  const { app, service } = fixture();
  const csrf = await token(app);
  for (const body of [
    { action: "share" },
    { action: "share", audience: "public", projectPath: "/other" },
    { action: "share", audience: "public", space: "../other" },
    { action: "remove" },
  ]) {
    expect((await request(app, "actions", csrf, body)).status).toBe(400);
  }
  expect(service.run).not.toHaveBeenCalled();
});
it("keeps one server job alive after the request completes and recovers it on reopening", async () => {
  const { app, service } = fixture();
  const csrf = await token(app);
  let finish: (value: ShareState) => void = () => {};
  vi.mocked(service.run).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const response = await request(app, "actions", csrf, {
    action: "share",
    audience: "private",
    space: "team1",
  });
  expect(response.status).toBe(202);
  const started = await response.json();
  expect(started.state).toBe("running");
  expect((await request(app, "actions", csrf, { action: "update" })).status).toBe(409);
  expect((await (await request(app, "snapshot", csrf)).json()).job.id).toBe(started.id);
  finish(state);
  await vi.waitFor(async () =>
    expect((await (await request(app, `jobs/${started.id}`, csrf)).json()).state).toBe("done"),
  );
  expect(service.run).toHaveBeenCalledOnce();
  expect(service.run).toHaveBeenCalledWith({
    action: "share",
    audience: "private",
    space: "team1",
  });
});
it("returns failed jobs without changing access or retrying automatically", async () => {
  const { app, service } = fixture();
  const csrf = await token(app);
  vi.mocked(service.run).mockRejectedValue(new Error("Render failed"));
  await request(app, "actions", csrf, { action: "update" });
  await vi.waitFor(async () =>
    expect((await (await request(app, "snapshot", csrf)).json()).job.error.message).toBe(
      "Render failed",
    ),
  );
  expect(service.linkOn).not.toHaveBeenCalled();
  expect(service.setAccess).not.toHaveBeenCalled();
});
it.each(["off", "on", "access"] as const)(
  "routes explicit %s management without starting an upload",
  async (action) => {
    const { app, service } = fixture();
    const csrf = await token(app);
    await request(app, "actions", csrf, {
      action,
      ...(action === "access" ? { audience: "invite" } : {}),
    });
    await vi.waitFor(() =>
      expect(
        action === "off" ? service.linkOff : action === "on" ? service.linkOn : service.setAccess,
      ).toHaveBeenCalledOnce(),
    );
    expect(service.run).not.toHaveBeenCalled();
  },
);
