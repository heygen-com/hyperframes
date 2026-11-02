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
