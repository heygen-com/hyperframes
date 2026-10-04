import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempAuthEnv } from "./_test-utils.js";
import { isAuthError } from "./errors.js";
import { resolveCredential, tryResolveCredential } from "./resolver.js";
import { writeStore } from "./store.js";

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

  it("prefers HEYGEN_API_KEY over everything else", async () => {
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

  it("skips expired non-refreshable oauth and falls through to api_key", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeStore({
      api_key: "fallback",
      oauth: { access_token: "stale-at", expires_at: past },
    });
    const r = await resolveCredential();
    expect(r.type).toBe("api_key");
    if (r.type === "api_key") expect(r.key).toBe("fallback");
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
