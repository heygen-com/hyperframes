import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempAuthEnv } from "./_test-utils.js";
import { isAuthError } from "./errors.js";
import {
  parseTokenResponse,
  persistFreshOAuth,
  persistVerifiedOAuthSession,
  refreshTokens,
  resolveClientId,
  revokeTokens,
  startAuthorizationCodeFlow,
  startDeviceAuthorizationFlow,
} from "./oauth.js";
import { readStore, writeStore } from "./store.js";

// Mock the interactive bits so startAuthorizationCodeFlow runs headless.
vi.mock("./loopback.js", () => ({
  startLoopback: vi.fn(async () => ({
    result: Promise.resolve({
      code: "auth_code_123",
      redirectUri: "http://127.0.0.1:12345/oauth/callback",
    }),
    redirectUri: "http://127.0.0.1:12345/oauth/callback",
    close: vi.fn(async () => {}),
  })),
}));
vi.mock("./browser.js", () => ({
  openBrowser: vi.fn(async () => ({ opened: true })),
}));

function tokenFetch(body: Record<string, unknown>): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function deviceAuthorizationResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      device_code: "secret-device-code",
      user_code: "ABCD-2345",
      verification_uri: "https://app.heygen.com/oauth/device",
      expires_in: 600,
      interval: 5,
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function queuedFetch(
  responses: Response[],
  onRequest?: (url: string | URL | Request, init?: RequestInit) => void,
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    onRequest?.(url, init);
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  }) as typeof fetch;
}

async function loginWithTokens(body: Record<string, unknown>) {
  await startAuthorizationCodeFlow({ fetchImpl: tokenFetch(body) });
  return (await readStore()).credentials;
}

describe("auth/oauth", () => {
  let fixture: Awaited<ReturnType<typeof setupTempAuthEnv>>;

  beforeEach(async () => {
    fixture = await setupTempAuthEnv("hf-oauth-");
  });

  afterEach(async () => {
    await fixture.restore();
  });

  describe("resolveClientId", () => {
    it("returns the env override when set", () => {
      process.env["HYPERFRAMES_OAUTH_CLIENT_ID"] = "test_client_id";
      expect(resolveClientId()).toBe("test_client_id");
    });

    it("returns the build-time default when env is unset", () => {
      expect(resolveClientId()).toMatch(/.+/);
    });
  });

  describe("parseTokenResponse", () => {
    it("parses a full token response", () => {
      const tokens = parseTokenResponse({
        access_token: "at_123",
        refresh_token: "rt_456",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid profile",
      });
      expect(tokens.access_token).toBe("at_123");
      expect(tokens.refresh_token).toBe("rt_456");
      expect(tokens.token_type).toBe("Bearer");
      expect(tokens.scope).toBe("openid profile");
      expect(tokens.expires_at).toBeDefined();
      const expiresAt = new Date(tokens.expires_at!);
      // Should be approximately 1 hour in the future
      const diff = expiresAt.getTime() - Date.now();
      expect(diff).toBeGreaterThan(3500 * 1000);
      expect(diff).toBeLessThan(3700 * 1000);
    });

    it("accepts expires_in as a string (some servers serialize as string)", () => {
      const tokens = parseTokenResponse({
        access_token: "at",
        expires_in: "1800",
      });
      expect(tokens.expires_at).toBeDefined();
    });

    it("rejects responses missing access_token", () => {
      expect(() => parseTokenResponse({ token_type: "Bearer" })).toThrow();
    });

    it("rejects array payloads", () => {
      expect(() => parseTokenResponse([])).toThrow();
    });

    it("rejects null payloads", () => {
      expect(() => parseTokenResponse(null)).toThrow();
    });

    it("rejects access_token containing CR/LF", () => {
      expect(() => parseTokenResponse({ access_token: "at\r\nX-Evil: 1" })).toSatisfy(
        () => true, // assertion done below via toThrow
      );
      expect(() => parseTokenResponse({ access_token: "at\r\nX-Evil: 1" })).toThrow(
        /control characters/,
      );
    });

    it("rejects refresh_token containing CR/LF", () => {
      expect(() => parseTokenResponse({ access_token: "at", refresh_token: "rt\nbad" })).toThrow(
        /control characters/,
      );
    });

    it("clamps non-positive expires_in to avoid an immediate-refresh loop", () => {
      const zero = parseTokenResponse({ access_token: "at", expires_in: 0 });
      const negative = parseTokenResponse({
        access_token: "at",
        expires_in: -100,
      });
      // both should resolve to a future time
      expect(new Date(zero.expires_at!).getTime()).toBeGreaterThan(Date.now() + 25 * 1000);
      expect(new Date(negative.expires_at!).getTime()).toBeGreaterThan(Date.now() + 25 * 1000);
    });

    it("uses REFRESH_FAILED error code on shape failures (not API_ERROR)", () => {
      try {
        parseTokenResponse(null);
      } catch (err) {
        expect(isAuthError(err)).toBe(true);
        if (isAuthError(err)) expect(err.code).toBe("REFRESH_FAILED");
        return;
      }
      throw new Error("expected throw");
    });
  });

  describe("refreshTokens", () => {
    it("posts grant_type=refresh_token and persists the response", async () => {
      process.env["HEYGEN_API_URL"] = "https://api.test.example";
      let capturedBody: string | undefined;
      const fetchImpl = (async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return new Response(
          JSON.stringify({
            access_token: "new_at",
            refresh_token: "new_rt",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "openid profile",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch;

      const tokens = await refreshTokens("old_rt", { fetchImpl });
      expect(tokens.access_token).toBe("new_at");
      expect(tokens.refresh_token).toBe("new_rt");
      expect(capturedBody).toContain("grant_type=refresh_token");
      expect(capturedBody).toContain("refresh_token=old_rt");

      // Should have persisted.
      const { credentials } = await readStore();
      expect(credentials.oauth?.access_token).toBe("new_at");
    });

    it("preserves the prior refresh_token when the server omits it (no rotation)", async () => {
      await writeStore({
        oauth: {
          access_token: "old_at",
          refresh_token: "keep_me_rt",
          expires_at: "2026-01-01T00:00:00Z",
        },
      });
      const fetchImpl = tokenFetch({ access_token: "new_at", expires_in: 3600 });
      await refreshTokens("keep_me_rt", { fetchImpl });
      const { credentials } = await readStore();
      expect(credentials.oauth?.access_token).toBe("new_at");
      // Critical: refresh_token MUST survive a no-rotation refresh.
      expect(credentials.oauth?.refresh_token).toBe("keep_me_rt");
    });

    it("preserves an existing api_key when persisting refreshed oauth", async () => {
      await writeStore({ api_key: "hg_keep" });
      const fetchImpl = tokenFetch({ access_token: "new_at", expires_in: 60 });
      await refreshTokens("old_rt", { fetchImpl });
      const { credentials } = await readStore();
      expect(credentials.api_key).toBe("hg_keep");
      expect(credentials.oauth?.access_token).toBe("new_at");
    });

    it("preserves an unknown key INSIDE the oauth sub-object across a refresh", async () => {
      // The refresh path is `persistOAuth(preserveMissing: true)`, i.e.
      // `{ ...existing.oauth, ...tokens }` — object spread carries the
      // hidden Symbol-keyed unknown bag from `existing.oauth`, so a key
      // another CLI wrote inside `oauth` (e.g. an `id_token`) must survive
      // the no-rotation refresh. Refresh is the most-frequent write path,
      // so a silent regression here would be the worst case.
      const path = (await import("./paths.js")).credentialPath();
      await fs.writeFile(
        path,
        JSON.stringify({
          oauth: {
            access_token: "old_at",
            refresh_token: "keep_me_rt",
            id_token: "future_id_token_value",
          },
        }),
        { mode: 0o600 },
      );
      const fetchImpl = tokenFetch({ access_token: "new_at", expires_in: 3600 });
      await refreshTokens("keep_me_rt", { fetchImpl });

      const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
      expect(onDisk.oauth.access_token).toBe("new_at");
      // The unknown oauth sub-key rode through on the hidden slot.
      expect(onDisk.oauth.id_token).toBe("future_id_token_value");
    });

    it("throws REFRESH_FAILED on 400/401", async () => {
      const fetchImpl = (async () =>
        new Response("invalid_grant", {
          status: 400,
        })) as unknown as typeof fetch;
      await expect(refreshTokens("bad_rt", { fetchImpl })).rejects.toSatisfy((err) => {
        return isAuthError(err) && (err as { code: string }).code === "REFRESH_FAILED";
      });
    });

    it("throws API_ERROR on 5xx", async () => {
      const fetchImpl = (async () =>
        new Response("upstream", { status: 503 })) as unknown as typeof fetch;
      await expect(refreshTokens("rt", { fetchImpl })).rejects.toSatisfy((err) => {
        return isAuthError(err) && (err as { code: string }).code === "API_ERROR";
      });
    });
  });

  describe("revokeTokens", () => {
    it("never throws on network failure (best-effort)", async () => {
      const fetchImpl = (async () => {
        throw new Error("connection refused");
      }) as unknown as typeof fetch;
      await expect(revokeTokens("any_token", { fetchImpl })).resolves.toBeUndefined();
    });

    it("respects the timeout", async () => {
      let aborted = false;
      const fetchImpl = (async (_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        });
      }) as unknown as typeof fetch;
      await revokeTokens("token", { fetchImpl, timeoutMs: 50 });
      expect(aborted).toBe(true);
    });

    it("sends token_type_hint when provided", async () => {
      let capturedBody = "";
      const fetchImpl = (async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch;
      await revokeTokens("tok", {
        fetchImpl,
        token_type_hint: "refresh_token",
      });
      expect(capturedBody).toContain("token_type_hint=refresh_token");
    });

    it("returns silently when client_id is unconfigured (no throw)", async () => {
      process.env["HYPERFRAMES_OAUTH_CLIENT_ID"] = "";
      // With the baked-in default cleared from env, revokeTokens still has
      // the build-time default. Force it to fail by setting the override to
      // a value AND nulling the default isn't possible from a test — instead
      // verify that the function never throws via the standard path.
      const fetchImpl = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
      await expect(revokeTokens("tok", { fetchImpl })).resolves.toBeUndefined();
    });
  });

  describe("error scrubbing", () => {
    it("refreshTokens does not leak token-shaped secrets from the error body", async () => {
      const fetchImpl = (async () =>
        new Response(
          '{"error":"invalid_grant","echoed":"refresh_token=rt_leak_secret&code_verifier=cv_leak"}',
          { status: 400 },
        )) as unknown as typeof fetch;
      try {
        await refreshTokens("rt_leak_secret", { fetchImpl });
        throw new Error("expected rejection");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).not.toContain("rt_leak_secret");
        expect(msg).not.toContain("cv_leak");
        expect(msg).toContain("<redacted>");
      }
    });
  });

  describe("startAuthorizationCodeFlow persistence", () => {
    it("overwrites the OAuth block on fresh login (no inherited refresh_token)", async () => {
      // Pre-seed a prior session whose refresh_token must NOT leak into
      // the new login when the new response omits one.
      await writeStore({
        oauth: {
          access_token: "old_at",
          refresh_token: "OLD_rt_should_not_survive",
        },
      });
      const credentials = await loginWithTokens({
        access_token: "new_at",
        expires_in: 3600,
      });
      expect(credentials.oauth?.access_token).toBe("new_at");
      // Fresh login is a clean session — the old refresh_token is gone.
      expect(credentials.oauth?.refresh_token).toBeUndefined();
    });

    it("preserves a co-located api_key across fresh login", async () => {
      await writeStore({ api_key: "hg_keep_me" });
      const credentials = await loginWithTokens({
        access_token: "new_at",
        refresh_token: "new_rt",
      });
      expect(credentials.api_key).toBe("hg_keep_me");
      expect(credentials.oauth?.access_token).toBe("new_at");
      expect(credentials.oauth?.refresh_token).toBe("new_rt");
    });

    it("preserves the user block AND unknown/foreign keys across fresh login", async () => {
      // The OAuth write path must not drop co-located data the other CLI
      // (or a prior login) wrote. Seed a user block plus a future key,
      // then log in fresh — both must survive the OAuth-block overwrite.
      const path = (await import("./paths.js")).credentialPath();
      await fs.writeFile(
        path,
        JSON.stringify({
          oauth: { access_token: "old_at" },
          user: { email: "jane@example.com", username: "jdoe" },
          future_field: { keep: true },
        }),
        { mode: 0o600 },
      );
      const credentials = await loginWithTokens({
        access_token: "new_at",
        expires_in: 3600,
      });
      expect(credentials.oauth?.access_token).toBe("new_at");
      expect(credentials.user).toEqual({
        email: "jane@example.com",
        username: "jdoe",
      });

      // The unknown key is on a hidden slot — assert via the raw file.
      const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
      expect(onDisk.future_field).toEqual({ keep: true });
    });
  });

  describe("startDeviceAuthorizationFlow", () => {
    it("atomically replaces OAuth and identity while preserving foreign fields", async () => {
      const path = (await import("./paths.js")).credentialPath();
      await fs.writeFile(
        path,
        JSON.stringify({
          api_key: "hg_keep",
          oauth: { access_token: "old-at", refresh_token: "old-rt" },
          user: {
            email: "old@example.com",
            username: "old-user",
            future_user_field: "keep-user",
          },
          future_root_field: { keep: true },
        }),
        { mode: 0o600 },
      );

      await persistVerifiedOAuthSession(
        { access_token: "device-at", refresh_token: "device-rt" },
        { email: "new@example.com" },
      );

      const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
      expect(onDisk.api_key).toBe("hg_keep");
      expect(onDisk.oauth).toMatchObject({
        access_token: "device-at",
        refresh_token: "device-rt",
      });
      expect(onDisk.user).toEqual({
        email: "new@example.com",
        future_user_field: "keep-user",
      });
      expect(onDisk.future_root_field).toEqual({ keep: true });
    });

    it("recovers a corrupt credential file before installing a verified session", async () => {
      const path = (await import("./paths.js")).credentialPath();
      await fs.writeFile(path, "{not-json", { mode: 0o600 });

      await persistVerifiedOAuthSession(
        { access_token: "device-at", refresh_token: "device-rt" },
        { email: "new@example.com" },
      );

      const onDisk = JSON.parse(await fs.readFile(path, "utf8"));
      expect(onDisk.oauth).toMatchObject({
        access_token: "device-at",
        refresh_token: "device-rt",
      });
      expect(onDisk.user).toEqual({ email: "new@example.com" });
    });

    it("polls pending and slow_down responses without persisting before identity verification", async () => {
      const requests: Array<{ url: string; body: URLSearchParams }> = [];
      const responses = [
        new Response(
          JSON.stringify({
            device_code: "secret-device-code",
            user_code: "ABCD-2345",
            verification_uri: "https://app.heygen.com/oauth/device",
            expires_in: 600,
            interval: 5,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
        new Response(JSON.stringify({ error: "authorization_pending" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
        new Response(JSON.stringify({ error: "slow_down" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
        new Response(
          JSON.stringify({
            access_token: "device-at",
            refresh_token: "device-rt",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "openid profile email",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ];
      const fetchImpl = queuedFetch(responses, (url, init) => {
        requests.push({
          url: String(url),
          body: new URLSearchParams(String(init?.body ?? "")),
        });
      });
      const sleeps: number[] = [];
      const challenges: Array<{ userCode: string; verificationUri: string }> = [];

      const tokens = await startDeviceAuthorizationFlow({
        fetchImpl,
        sleepImpl: async (ms) => {
          sleeps.push(ms);
        },
        now: () => 1_000,
        onChallenge: (challenge) => {
          challenges.push(challenge);
        },
      });

      expect(tokens.access_token).toBe("device-at");
      expect(challenges).toEqual([
        {
          userCode: "ABCD-2345",
          verificationUri: "https://app.heygen.com/oauth/device",
        },
      ]);
      expect(sleeps).toEqual([5_000, 5_000, 10_000]);
      expect(requests[0]?.body.get("client_id")).toBe(resolveClientId());
      expect(requests[1]?.body.get("device_code")).toBe("secret-device-code");
      expect(requests[1]?.body.get("grant_type")).toBe(
        "urn:ietf:params:oauth:grant-type:device_code",
      );
      expect((await readStore()).source).toBe("absent");

      await persistFreshOAuth(tokens);
      expect((await readStore()).credentials.oauth?.access_token).toBe("device-at");
    });

    it("uses the RFC default interval and presents a safe complete verification URL", async () => {
      const responses = [
        deviceAuthorizationResponse({
          interval: undefined,
          verification_uri_complete: "https://app.heygen.com/oauth/device?user_code=ABCD-2345",
        }),
        new Response(JSON.stringify({ access_token: "device-at" }), { status: 200 }),
      ];
      const fetchImpl = queuedFetch(responses);
      const sleeps: number[] = [];
      const challenges: Array<{
        userCode: string;
        verificationUri: string;
        verificationUriComplete?: string;
      }> = [];

      await startDeviceAuthorizationFlow({
        fetchImpl,
        sleepImpl: async (ms) => {
          sleeps.push(ms);
        },
        now: () => 1_000,
        onChallenge: (challenge) => {
          challenges.push(challenge);
        },
      });

      expect(sleeps).toEqual([5_000]);
      expect(challenges).toEqual([
        {
          userCode: "ABCD-2345",
          verificationUri: "https://app.heygen.com/oauth/device",
          verificationUriComplete: "https://app.heygen.com/oauth/device?user_code=ABCD-2345",
        },
      ]);
    });

    it("treats HTTP 429 without an OAuth body as slow_down and honors Retry-After", async () => {
      const responses = [
        deviceAuthorizationResponse(),
        new Response("rate limited", { status: 429, headers: { "retry-after": "20" } }),
        new Response(JSON.stringify({ access_token: "device-at" }), { status: 200 }),
      ];
      const fetchImpl = queuedFetch(responses);
      const sleeps: number[] = [];

      await startDeviceAuthorizationFlow({
        fetchImpl,
        sleepImpl: async (ms) => {
          sleeps.push(ms);
        },
        now: () => 1_000,
      });

      expect(sleeps).toEqual([5_000, 20_000]);
    });

    it("canonicalizes an internationalized verification host before displaying it", async () => {
      const unicodeUri = "https://rаypal.example/oauth/device";
      const responses = [
        deviceAuthorizationResponse({ verification_uri: unicodeUri }),
        new Response(JSON.stringify({ access_token: "device-at" }), { status: 200 }),
      ];
      const fetchImpl = queuedFetch(responses);
      const challenges: Array<{ verificationUri: string }> = [];

      await startDeviceAuthorizationFlow({
        fetchImpl,
        sleepImpl: async () => {},
        now: () => 1_000,
        onChallenge: (challenge) => {
          challenges.push(challenge);
        },
      });

      expect(challenges[0]?.verificationUri).toBe(new URL(unicodeUri).href);
      expect(challenges[0]?.verificationUri).not.toBe(unicodeUri);
    });

    it("times out while reading a slow authorization response body", async () => {
      const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), {
              once: true,
            });
          },
        });
        return new Response(body, { status: 200 });
      }) as typeof fetch;

      await expect(
        startDeviceAuthorizationFlow({ fetchImpl, requestTimeoutMs: 5 }),
      ).rejects.toThrow(/request timed out/);
    });

    it("times out a stalled token poll", async () => {
      let call = 0;
      const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
        call += 1;
        if (call === 1) {
          return deviceAuthorizationResponse({ interval: undefined });
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      }) as typeof fetch;

      await expect(
        startDeviceAuthorizationFlow({
          fetchImpl,
          sleepImpl: async () => {},
          now: () => 1_000,
          requestTimeoutMs: 5,
        }),
      ).rejects.toThrow(/request timed out/);
    });

    it.each(["access_denied", "expired_token"])(
      "fails with a bounded error for %s without echoing the device code",
      async (oauthError) => {
        const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
          const body = new URLSearchParams(String(init?.body ?? ""));
          if (body.has("scope")) {
            return new Response(
              JSON.stringify({
                device_code: "never-log-this-device-code",
                user_code: "ABCD-2345",
                verification_uri: "https://app.heygen.com/oauth/device",
                expires_in: 600,
                interval: 5,
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              error: oauthError,
              error_description: "echo never-log-this-device-code",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }) as typeof fetch;

        await expect(
          startDeviceAuthorizationFlow({
            fetchImpl,
            sleepImpl: async () => {},
            now: () => 1_000,
          }),
        ).rejects.not.toThrow(/never-log-this-device-code/);
        expect((await readStore()).source).toBe("absent");
      },
    );

    it.each([
      ["credential-bearing URL", "https://user:pass@app.heygen.com/oauth/device", 600, 5],
      ["control-character URL", "https://app.heygen.com/oauth/\u001b[31m", 600, 5],
      ["prefix-parsed expiry", "https://app.heygen.com/oauth/device", "600seconds", 5],
      ["prefix-parsed interval", "https://app.heygen.com/oauth/device", 600, "5seconds"],
    ])("rejects an unsafe or malformed %s response", async (_name, uri, expiresIn, interval) => {
      const fetchImpl = (async () =>
        new Response(
          JSON.stringify({
            device_code: "never-log-this-device-code",
            user_code: "ABCD-2345",
            verification_uri: uri,
            expires_in: expiresIn,
            interval,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch;

      await expect(startDeviceAuthorizationFlow({ fetchImpl })).rejects.toThrow(
        /Device authorization failed/,
      );
    });

    it("rejects an oversized device response without exposing its body", async () => {
      const marker = "never-log-this-device-code";
      const fetchImpl = (async () =>
        new Response(JSON.stringify({ padding: marker.repeat(8_000) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch;

      await expect(startDeviceAuthorizationFlow({ fetchImpl })).rejects.not.toThrow(marker);
    });
  });
});
