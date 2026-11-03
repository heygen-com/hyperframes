import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempAuthEnv } from "../auth/_test-utils.js";
import { persistFreshOAuth } from "../auth/oauth.js";
import { resolveCredential } from "../auth/resolver.js";
import { forceRefreshCredentials, refreshIfNeeded, resolveCloudAuthHeaders } from "./auth.js";

const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({ access_token: "refreshed", refresh_token: "rotated", expires_in: 3600 }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("cloud auth: login vs HEYGEN_API_KEY", () => {
  let fixture: Awaited<ReturnType<typeof setupTempAuthEnv>>;
  beforeEach(async () => {
    fixture = await setupTempAuthEnv("hf-cloud-auth-");
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await fixture.restore();
  });

  it("signs with the login when HEYGEN_API_KEY is also set", async () => {
    await persistFreshOAuth({ access_token: "login-at", refresh_token: "rt" });
    process.env["HEYGEN_API_KEY"] = "env-key";
    const headers = await resolveCloudAuthHeaders();
    expect(headers["authorization"]).toBe("Bearer login-at");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("signs with HEYGEN_API_KEY when no login is stored", async () => {
    process.env["HEYGEN_API_KEY"] = "env-key";
    const headers = await resolveCloudAuthHeaders();
    expect(headers["x-api-key"]).toBe("env-key");
    expect(headers["authorization"]).toBeUndefined();
  });

  it("refreshes an expired login instead of using HEYGEN_API_KEY", async () => {
    await persistFreshOAuth({
      access_token: "stale",
      refresh_token: "rt",
      expires_at: anHourAgo(),
    });
    process.env["HEYGEN_API_KEY"] = "env-key";
    const fetchMock = vi.fn(async () => tokenResponse());
    vi.stubGlobal("fetch", fetchMock);
    const headers = await resolveCloudAuthHeaders();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(headers["authorization"]).toBe("Bearer refreshed");
  });

  it("falls back to HEYGEN_API_KEY when the refresh fails, and does not retry it", async () => {
    await persistFreshOAuth({
      access_token: "stale",
      refresh_token: "rt",
      expires_at: anHourAgo(),
    });
    process.env["HEYGEN_API_KEY"] = "env-key";
    const fetchMock = vi.fn(async () => new Response("invalid_grant", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await resolveCloudAuthHeaders())["x-api-key"]).toBe("env-key");
    expect((await resolveCloudAuthHeaders())["x-api-key"]).toBe("env-key");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps the login through a server error, and refreshes again on the next call", async () => {
    await persistFreshOAuth({
      access_token: "stale",
      refresh_token: "rt",
      expires_at: anHourAgo(),
    });
    process.env["HEYGEN_API_KEY"] = "env-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(tokenResponse());
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveCloudAuthHeaders()).rejects.toMatchObject({ code: "API_ERROR" });
    expect((await resolveCloudAuthHeaders())["authorization"]).toBe("Bearer refreshed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the login through a reply it cannot read", async () => {
    await persistFreshOAuth({
      access_token: "stale",
      refresh_token: "rt",
      expires_at: anHourAgo(),
    });
    process.env["HEYGEN_API_KEY"] = "env-key";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ token_type: "Bearer" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(tokenResponse()),
    );
    await expect(resolveCloudAuthHeaders()).rejects.toMatchObject({ code: "REFRESH_FAILED" });
    expect((await resolveCloudAuthHeaders())["authorization"]).toBe("Bearer refreshed");
  });

  it("keeps the login through a network error", async () => {
    await persistFreshOAuth({
      access_token: "stale",
      refresh_token: "rt",
      expires_at: anHourAgo(),
    });
    process.env["HEYGEN_API_KEY"] = "env-key";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(tokenResponse()),
    );
    await expect(resolveCloudAuthHeaders()).rejects.toThrow("fetch failed");
    expect((await resolveCloudAuthHeaders())["authorization"]).toBe("Bearer refreshed");
  });

  it("sends one refresh for requests that overlap, and signs both with the login", async () => {
    await persistFreshOAuth({
      access_token: "stale",
      refresh_token: "rt",
      expires_at: anHourAgo(),
    });
    process.env["HEYGEN_API_KEY"] = "env-key";
    // The server rotates the token, so a second refresh with "rt" would be refused.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValue(new Response("invalid_grant", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const both = await Promise.all([resolveCloudAuthHeaders(), resolveCloudAuthHeaders()]);
    expect(both.map((headers) => headers["authorization"])).toEqual([
      "Bearer refreshed",
      "Bearer refreshed",
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await resolveCloudAuthHeaders())["authorization"]).toBe("Bearer refreshed");
  });

  it("uses the login another process stored instead of the env key", async () => {
    await persistFreshOAuth({
      access_token: "stale",
      refresh_token: "rt",
      expires_at: anHourAgo(),
    });
    process.env["HEYGEN_API_KEY"] = "env-key";
    const fetchMock = vi.fn(async () => new Response("invalid_grant", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const credential = await resolveCredential();
    await persistFreshOAuth({ access_token: "other-process", refresh_token: "rt2" });
    expect(await refreshIfNeeded(credential)).toMatchObject({
      type: "oauth",
      access_token: "other-process",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await resolveCloudAuthHeaders())["authorization"]).toBe("Bearer other-process");
  });

  it("surfaces the refresh error when no env key is set", async () => {
    await persistFreshOAuth({
      access_token: "stale",
      refresh_token: "rt",
      expires_at: anHourAgo(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid_grant", { status: 400 })),
    );
    await expect(resolveCloudAuthHeaders()).rejects.toMatchObject({ code: "REFRESH_FAILED" });
  });

  it("does not fall back when the caller opts out", async () => {
    await persistFreshOAuth({
      access_token: "stale",
      refresh_token: "rt",
      expires_at: anHourAgo(),
    });
    process.env["HEYGEN_API_KEY"] = "env-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid_grant", { status: 400 })),
    );
    const credential = await resolveCredential();
    await expect(refreshIfNeeded(credential, { envFallback: false })).rejects.toMatchObject({
      code: "REFRESH_FAILED",
    });
  });

  it("switches to HEYGEN_API_KEY after the server refuses a login that cannot refresh", async () => {
    await persistFreshOAuth({ access_token: "revoked", refresh_token: "rt" });
    process.env["HEYGEN_API_KEY"] = "env-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid_grant", { status: 400 })),
    );
    expect((await resolveCloudAuthHeaders())["authorization"]).toBe("Bearer revoked");
    await forceRefreshCredentials();
    expect((await resolveCloudAuthHeaders())["x-api-key"]).toBe("env-key");
  });
});
