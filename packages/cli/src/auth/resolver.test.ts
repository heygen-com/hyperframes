import { oauthIdentity } from "./config.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempAuthEnv } from "./_test-utils.js";
import { ErrApi, ErrLoginChanged, ErrRefreshFailed, isAuthError } from "./errors.js";
import { afterRefreshFailure, resolveCredential, tryResolveCredential } from "./resolver.js";
import { writeStore as writeUnboundStore, type Credentials } from "./store.js";

async function writeStore(credentials: Credentials): Promise<void> {
  await writeUnboundStore({
    ...credentials,
    ...(credentials.oauth ? { oauth: { ...oauthIdentity(), ...credentials.oauth } } : {}),
  });
}

describe("auth/resolver", () => {
  let fixture: Awaited<ReturnType<typeof setupTempAuthEnv>>;
  let dir: string;

  beforeEach(async () => {
    fixture = await setupTempAuthEnv("hf-auth-resolve-");
    dir = fixture.dir;
  });

  afterEach(async () => {
    await fixture.restore();
  });

  const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

  it("prefers a signed-in login over HEYGEN_API_KEY", async () => {
    process.env["HEYGEN_API_KEY"] = "env-key";
    process.env["HYPERFRAMES_API_KEY"] = "alias-key";
    await writeStore({
      api_key: "file-key",
      oauth: { access_token: "fresh-at", refresh_token: "rt", expires_at: inOneHour() },
    });
    const r = await resolveCredential();
    expect(r).toMatchObject({ type: "oauth", access_token: "fresh-at", source: "file_json" });
  });

  it("prefers an expired login that can refresh over HEYGEN_API_KEY", async () => {
    process.env["HEYGEN_API_KEY"] = "env-key";
    await writeStore({
      oauth: { access_token: "stale-at", refresh_token: "rt", expires_at: anHourAgo() },
    });
    const r = await resolveCredential();
    expect(r).toMatchObject({ type: "oauth", access_token: "stale-at", refreshable: true });
  });

  it("uses HEYGEN_API_KEY when the login expired and cannot refresh", async () => {
    process.env["HEYGEN_API_KEY"] = "env-key";
    await writeStore({ oauth: { access_token: "stale-at", expires_at: anHourAgo() } });
    expect(await resolveCredential()).toEqual({ type: "api_key", key: "env-key", source: "env" });
  });

  it("uses HEYGEN_API_KEY over a login from another OAuth client", async () => {
    process.env["HEYGEN_API_KEY"] = "env-key";
    await writeStore({ oauth: { access_token: "foreign", client_id: "shared-heygen-cli" } });
    expect(await resolveCredential()).toEqual({ type: "api_key", key: "env-key", source: "env" });
  });

  it("uses HEYGEN_API_KEY when the credentials file is broken", async () => {
    process.env["HEYGEN_API_KEY"] = "env-key";
    await fs.writeFile(join(dir, "credentials"), "{not valid", { mode: 0o600 });
    expect(await resolveCredential()).toEqual({ type: "api_key", key: "env-key", source: "env" });
  });

  it("keeps the env key first when HEYGEN_API_URL names a host app's gateway", async () => {
    process.env["HEYGEN_API_KEY"] = "gateway-token";
    process.env["HEYGEN_API_URL"] = "http://127.0.0.1:4100";
    await writeStore({ oauth: { access_token: "fresh-at", expires_at: inOneHour() } });
    expect(await resolveCredential()).toEqual({
      type: "api_key",
      key: "gateway-token",
      source: "env",
    });
    process.env["HEYGEN_API_URL"] = "https://api.dev.heygen.com";
    expect(await resolveCredential()).toMatchObject({ type: "oauth", access_token: "fresh-at" });
    process.env["HEYGEN_API_BASE"] = "https://gateway.example";
    expect(await resolveCredential()).toMatchObject({ type: "api_key", key: "gateway-token" });
  });

  it("uses the env key for the rest of the process once HeyGen refuses to refresh the login", async () => {
    await writeStore({
      oauth: { access_token: "at", refresh_token: "rt", expires_at: anHourAgo() },
    });
    const refused = ErrRefreshFailed("invalid_grant", { refused: true });
    await expect(afterRefreshFailure(refused, "rt")).rejects.toMatchObject({
      code: "REFRESH_FAILED",
    });
    expect(await resolveCredential()).toMatchObject({ type: "oauth", refreshable: true });

    process.env["HEYGEN_API_KEY"] = "env-key";
    // A server error or a login another process is changing says nothing about the grant.
    await expect(afterRefreshFailure(ErrApi(503, "down"), "rt")).rejects.toMatchObject({
      code: "API_ERROR",
    });
    await expect(afterRefreshFailure(ErrLoginChanged(), "rt")).rejects.toMatchObject({
      code: "LOGIN_CHANGED",
    });
    // Nor does a reply the CLI couldn't read.
    await expect(
      afterRefreshFailure(ErrRefreshFailed("no access_token"), "rt"),
    ).rejects.toMatchObject({ code: "REFRESH_FAILED" });
    expect(await resolveCredential()).toMatchObject({ type: "oauth", refreshable: true });

    const fallback = { type: "api_key", key: "env-key", source: "env" };
    expect(await afterRefreshFailure(refused, "rt")).toEqual(fallback);
    expect(await resolveCredential()).toEqual(fallback);
  });

  it("prefers a host app's HEYGEN_ACCESS_TOKEN over the login and env keys", async () => {
    process.env["HEYGEN_ACCESS_TOKEN"] = "host-token";
    process.env["HEYGEN_API_KEY"] = "env-key";
    await writeStore({ oauth: { access_token: "fresh-at", expires_at: inOneHour() } });
    expect(await resolveCredential()).toMatchObject({
      type: "oauth",
      access_token: "host-token",
      source: "env_oauth",
    });
  });

  it("prefers HEYGEN_API_KEY over HYPERFRAMES_API_KEY and a saved API key", async () => {
    process.env["HEYGEN_API_KEY"] = "env-key";
    process.env["HYPERFRAMES_API_KEY"] = "alias-key";
    await writeStore({ api_key: "file-key" });
    const r = await resolveCredential();
    expect(r).toEqual({ type: "api_key", key: "env-key", source: "env" });
  });

  it("falls through to HYPERFRAMES_API_KEY", async () => {
    process.env["HYPERFRAMES_API_KEY"] = "alias-key";
    await writeStore({ api_key: "file-key" });
    const r = await resolveCredential();
    expect(r).toEqual({ type: "api_key", key: "alias-key", source: "env_alias" });
  });

  it("accepts host-managed OAuth without a credential file or a refresh token", async () => {
    process.env["HEYGEN_ACCESS_TOKEN"] = "host-token";
    expect(await resolveCredential()).toEqual({
      type: "oauth",
      access_token: "host-token",
      source: "env_oauth",
      refreshable: false,
    });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("rejects an unsafe host token without exposing it", async () => {
    process.env["HEYGEN_ACCESS_TOKEN"] = "secret\r\nInjected: value";
    await expect(resolveCredential()).rejects.toMatchObject({ code: "INVALID_STORE" });
    await expect(resolveCredential()).rejects.not.toThrow("secret");
  });

  it("treats an empty host token as absent", async () => {
    process.env["HEYGEN_ACCESS_TOKEN"] = "";
    expect(await tryResolveCredential()).toBeNull();
  });

  it("returns file api_key when no env is set", async () => {
    await writeStore({ api_key: "file-key" });
    const r = await resolveCredential();
    expect(r.type).toBe("api_key");
    if (r.type === "api_key") {
      expect(r.key).toBe("file-key");
      expect(r.source).toBe("file_json");
    }
  });

  it("prefers fresh oauth over api_key", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await writeStore({
      api_key: "file-key",
      oauth: { access_token: "fresh-at", refresh_token: "rt", expires_at: future },
    });
    const r = await resolveCredential();
    expect(r.type).toBe("oauth");
    if (r.type === "oauth") {
      expect(r.access_token).toBe("fresh-at");
      // Fresh access_token does NOT need refresh, even with refresh_token present.
      expect(r.refreshable).toBe(false);
    }
  });

  it("oauth without expires_at is treated as fresh (refreshable=false)", async () => {
    await writeStore({
      oauth: { access_token: "at", refresh_token: "rt" },
    });
    const r = await resolveCredential();
    expect(r.type).toBe("oauth");
    if (r.type === "oauth") expect(r.refreshable).toBe(false);
  });

  it("marks expired-but-refreshable oauth as refreshable", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeStore({
      oauth: { access_token: "stale-at", refresh_token: "rt", expires_at: past },
    });
    const r = await resolveCredential();
    expect(r.type).toBe("oauth");
    if (r.type === "oauth") expect(r.refreshable).toBe(true);
  });

  it("refuses an expired OAuth login without switching to the stored API wallet", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeStore({
      api_key: "fallback",
      oauth: { access_token: "stale-at", expires_at: past },
    });
    await expect(resolveCredential()).rejects.toMatchObject({ code: "LOGIN_EXPIRED" });
  });

  it("requires a new login for an unbound or foreign OAuth credential", async () => {
    await writeUnboundStore({ api_key: "fallback", oauth: { access_token: "legacy" } });
    await expect(resolveCredential()).rejects.toMatchObject({ code: "LOGIN_EXPIRED" });
    await writeStore({ oauth: { access_token: "foreign", client_id: "shared-heygen-cli" } });
    await expect(resolveCredential()).rejects.toMatchObject({ code: "LOGIN_EXPIRED" });
  });

  it("reports an expired login with no refresh token as expired, not as never signed in", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeStore({ oauth: { access_token: "stale-at", expires_at: past } });
    await expect(tryResolveCredential()).rejects.toSatisfy((err) => {
      return isAuthError(err) && (err as { code: string }).code === "LOGIN_EXPIRED";
    });
  });

  it("rejects HEYGEN_API_KEY containing CRLF (header-injection guard)", async () => {
    process.env["HEYGEN_API_KEY"] = "hg_x\r\nX-Evil: 1";
    await expect(resolveCredential()).rejects.toSatisfy((err) => {
      return isAuthError(err) && (err as { code: string }).code === "INVALID_STORE";
    });
  });

  it("throws ErrNotConfigured when nothing is configured", async () => {
    await expect(resolveCredential()).rejects.toSatisfy((err) => {
      return isAuthError(err) && (err as { code: string }).code === "NOT_CONFIGURED";
    });
  });

  it("identifies legacy plaintext file source", async () => {
    const path = join(dir, "credentials");
    await fs.writeFile(path, "hg_legacy_key", { mode: 0o600 });
    const r = await resolveCredential();
    expect(r.type).toBe("api_key");
    if (r.type === "api_key") {
      expect(r.key).toBe("hg_legacy_key");
      expect(r.source).toBe("file_legacy");
    }
  });

  it("tryResolveCredential returns null when not configured", async () => {
    expect(await tryResolveCredential()).toBeNull();
  });

  it("tryResolveCredential surfaces broken-file errors", async () => {
    const path = join(dir, "credentials");
    await fs.writeFile(path, "{not valid", { mode: 0o600 });
    await expect(tryResolveCredential()).rejects.toSatisfy((err) => isAuthError(err));
  });

  it("uses injected now() for expiry decisions", async () => {
    // expires_at is one hour ago in real time. Injecting `now` two
    // hours in the past makes the token appear fresh (still valid for
    // another hour), so the resolver should NOT mark it refreshable.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeStore({
      oauth: { access_token: "at", refresh_token: "rt", expires_at: oneHourAgo },
    });
    const r = await resolveCredential({
      now: () => new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    expect(r.type).toBe("oauth");
    if (r.type === "oauth") {
      expect(r.access_token).toBe("at");
      expect(r.refreshable).toBe(false);
    }
  });
});
