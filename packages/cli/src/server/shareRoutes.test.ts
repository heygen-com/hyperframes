import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { ShareService, ShareState } from "../share/service.js";
import { mountShareRoutes } from "./shareRoutes.js";
import { ReviewFailed } from "@hyperframes/share";
import { AuthError } from "../auth/errors.js";
import { createShareCsrf, localShareRequestAllowed } from "./shareBoundary.js";

const state: ShareState = {
  upToDate: false,
  source: { at: "not_checked" },
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
    checkSession: vi.fn(async () => ({
      token: "secret",
      owner: "owner",
      heygen: "https://heygen.com",
      heygenApi: "https://api.heygen.com",
    })),
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
  const login = vi.fn(async () => {});
  const track = vi.fn();
  mountShareRoutes(app, "/fixed/project", create, login, track);
  return { app, service, create, login, track };
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
    videoOnly: undefined,
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
    videoOnly: undefined,
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

it("runs one browser sign-in job without returning credentials and verifies identity afterward", async () => {
  const { app, service, login, create } = fixture();
  const csrf = await token(app);
  vi.mocked(service.status).mockRejectedValue(new AuthError("UNAUTHENTICATED", "Sign in first"));
  let finish = () => {};
  login.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const started = await (await request(app, "actions", csrf, { action: "login" })).json();
  expect(started.step).toBe("signing_in");
  expect((await request(app, "actions", csrf, { action: "login" })).status).toBe(409);
  const reopening = await (await request(app, "snapshot", csrf)).json();
  expect(reopening.code).toBe("unauthenticated");
  expect(reopening.job.id).toBe(started.id);
  vi.mocked(service.status).mockResolvedValue(state);
  finish();
  await vi.waitFor(async () =>
    expect((await (await request(app, `jobs/${started.id}`, csrf)).json()).state).toBe("done"),
  );
  expect(login).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledTimes(2);
  const complete = await (await request(app, "snapshot", csrf)).json();
  expect(JSON.stringify(complete)).not.toMatch(/access_token|refresh_token|authorize_url/);
  expect(service.run).not.toHaveBeenCalled();
});
it("passes explicit video-only recovery and rejects nonboolean bypass values", async () => {
  const { app, service } = fixture();
  const csrf = await token(app);
  expect(
    (await request(app, "actions", csrf, { action: "update", videoOnly: "true" })).status,
  ).toBe(400);
  await request(app, "actions", csrf, { action: "update", videoOnly: true });
  await vi.waitFor(() =>
    expect(service.run).toHaveBeenCalledWith({
      action: "update",
      audience: undefined,
      space: undefined,
      videoOnly: true,
    }),
  );
});

it("requires the same boundary for events and never forwards arbitrary properties", async () => {
  const { app, track } = fixture();
  const csrf = await token(app);
  expect((await request(app, "events", "", { event: "share_opened", link: "live" })).status).toBe(
    403,
  );
  expect(
    (await request(app, "events", csrf, { event: "share_opened", link: "live", url: "secret" }))
      .status,
  ).toBe(400);
  expect(
    (await request(app, "events", csrf, { event: "share_link_copied", via: "update" })).status,
  ).toBe(400);
  expect(
    (await request(app, "events", csrf, { event: "share_opened", link: "changed" })).status,
  ).toBe(204);
  expect(track).toHaveBeenCalledExactlyOnceWith(
    { event: "share_opened", link: "changed" },
    "local_studio",
  );
});

it("rejects stale actions and job reads after logout without returning the previous result", async () => {
  const { app, service } = fixture();
  const csrf = await token(app);
  const started = await (await request(app, "actions", csrf, { action: "update" })).json();
  await vi.waitFor(async () =>
    expect((await (await request(app, `jobs/${started.id}`, csrf)).json()).state).toBe("done"),
  );
  const signedOut = new AuthError("UNAUTHENTICATED", "Sign in first");
  vi.mocked(service.checkSession).mockRejectedValue(signedOut);
  vi.mocked(service.status).mockRejectedValue(signedOut);
  for (const [path, action] of [
    [`jobs/${started.id}`, undefined],
    ["snapshot", undefined],
    ["actions", { action: "off" }],
  ] as const) {
    const response = await request(app, path, csrf, action);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("unauthenticated");
    expect(body.result).toBeUndefined();
    expect(body.job ?? null).toBeNull();
  }
  expect(service.linkOff).not.toHaveBeenCalled();
});

it("does not reveal another account's completed job to a newly opened panel", async () => {
  const { app, service } = fixture();
  const first = await token(app);
  const started = await (await request(app, "actions", first, { action: "update" })).json();
  await vi.waitFor(async () =>
    expect((await (await request(app, `jobs/${started.id}`, first)).json()).state).toBe("done"),
  );
  vi.mocked(service.checkSession).mockResolvedValue({
    token: "other-secret",
    owner: "other",
    heygen: "https://heygen.com",
    heygenApi: "https://api.heygen.com",
  });
  const second = await token(app);
  expect(second).not.toBe(first);
  expect((await request(app, `jobs/${started.id}`, second)).status).toBe(404);
  expect((await (await request(app, "snapshot", second)).json()).job).toBeNull();
});

it("serializes actions even when concurrent requests await identity verification", async () => {
  const { app, service } = fixture();
  const csrf = await token(app);
  let verify = () => {};
  const barrier = new Promise<void>((resolve) => {
    verify = resolve;
  });
  vi.mocked(service.checkSession).mockImplementation(async () => {
    await barrier;
    return {
      token: "secret",
      owner: "owner",
      heygen: "https://heygen.com",
      heygenApi: "https://api.heygen.com",
    };
  });
  let finish = () => {};
  vi.mocked(service.run).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(state);
      }),
  );
  const requests = [
    request(app, "actions", csrf, { action: "update" }),
    request(app, "actions", csrf, { action: "update" }),
  ];
  await vi.waitFor(() => expect(service.checkSession).toHaveBeenCalledTimes(2));
  verify();
  expect((await Promise.all(requests)).map((response) => response.status).sort()).toEqual([
    202, 409,
  ]);
  expect(service.run).toHaveBeenCalledOnce();
  finish();
});

it("withholds an in-flight result when the account changes before completion", async () => {
  const { app, service } = fixture();
  const csrf = await token(app);
  let finish = () => {};
  vi.mocked(service.run).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(state);
      }),
  );
  const started = await (await request(app, "actions", csrf, { action: "update" })).json();
  vi.mocked(service.checkSession).mockRejectedValue(
    new AuthError("LOGIN_CHANGED", "Login changed"),
  );
  finish();
  await vi.waitFor(async () => {
    const response = await request(app, `jobs/${started.id}`, csrf);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "login_changed", message: "Login changed" });
  });
});

it.each(["login_required", "", "invalid_token"])(
  "exposes browser sign-in recovery for a review 401 (%s)",
  async (reason) => {
    const { app, service, login } = fixture();
    const csrf = await token(app);
    vi.mocked(service.status).mockRejectedValue(new ReviewFailed(401, reason));
    vi.mocked(service.checkSession).mockRejectedValueOnce(
      new AuthError("LOGIN_EXPIRED", "Your sign-in has expired. Sign in again."),
    );
    const response = await request(app, "snapshot", csrf);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "login_expired",
      message: expect.stringContaining("Sign in again"),
    });
    expect(login).not.toHaveBeenCalled();
    vi.mocked(service.status).mockResolvedValue(state);
    const started = await (await request(app, "actions", csrf, { action: "login" })).json();
    await vi.waitFor(async () =>
      expect((await (await request(app, `jobs/${started.id}`, csrf)).json()).state).toBe("done"),
    );
    expect(login).toHaveBeenCalledOnce();
  },
);

it("preserves admission failures instead of offering an expired-session retry", async () => {
  const { app, service, login } = fixture();
  const csrf = await token(app);
  vi.mocked(service.status).mockRejectedValue(new ReviewFailed(403, "feature_unavailable"));
  const response = await request(app, "snapshot", csrf);
  expect(await response.json()).toMatchObject({ code: "feature_unavailable" });
  expect(login).not.toHaveBeenCalled();
});

it("distinguishes review admission refusal only after fresh account validation", async () => {
  const { app, service, login } = fixture();
  const csrf = await token(app);
  vi.mocked(service.status).mockRejectedValue(new ReviewFailed(401, "login_required"));
  const response = await request(app, "snapshot", csrf);
  expect(await response.json()).toMatchObject({
    code: "sharing_not_admitted",
    message: expect.stringContaining("You're signed in"),
  });
  expect(service.checkSession).toHaveBeenCalledWith(true);
  expect(login).not.toHaveBeenCalled();
});

it("shows a completed login's admission failure to its initiating panel", async () => {
  const { app, service } = fixture();
  const csrf = await token(app);
  vi.mocked(service.status).mockRejectedValue(new ReviewFailed(401, "login_required"));
  const started = await (await request(app, "actions", csrf, { action: "login" })).json();
  await vi.waitFor(async () => {
    const response = await request(app, `jobs/${started.id}`, csrf);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      state: "failed",
      result: null,
      error: { code: "sharing_not_admitted" },
    });
  });
});

it.each([undefined, true])("forwards only explicit source consent (%s)", async (includeSource) => {
  const { app, service } = fixture();
  const csrf = await token(app);
  const response = await request(app, "actions", csrf, {
    action: "share",
    audience: "public",
    includeSource,
  });
  expect(response.status).toBe(202);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(service.run).toHaveBeenCalledWith(expect.objectContaining({ includeSource }));
});
