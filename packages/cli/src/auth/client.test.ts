import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AuthClient,
  HEYGEN_CLI_SOURCE,
  HEYGEN_CLI_SOURCE_HEADER,
  HEYGEN_CLIENT_SOURCE,
  HEYGEN_CLIENT_SOURCE_HEADER,
  apiBaseUrl,
  buildAuthHeaders,
} from "./client.js";
import { isAuthError } from "./errors.js";
import type { ResolvedCredential } from "./resolver.js";

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function textFetch(body: string, status: number): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

function apiKeyCred(): ResolvedCredential {
  return { type: "api_key", key: "hg_x", source: "env" };
}

function makeClient(fetchImpl: typeof fetch): AuthClient {
  return new AuthClient({ baseUrl: "https://api.test.example", fetchImpl });
}

// getCurrentUser is expected to reject with a specific auth-error code.
async function expectAuthCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (err) => isAuthError(err) && (err as { code: string }).code === code,
  );
}

// getCurrentUser is expected to reject; assertMessage inspects the scrubbed message.
async function expectRejectionMessage(
  client: AuthClient,
  assertMessage: (msg: string) => void,
): Promise<void> {
  try {
    await client.getCurrentUser(apiKeyCred());
  } catch (err) {
    assertMessage((err as Error).message);
    return;
  }
  throw new Error("expected rejection");
}

describe("auth/client", () => {
  const original = process.env["HEYGEN_API_URL"];

  beforeEach(() => {
    delete process.env["HEYGEN_API_URL"];
  });

  afterEach(() => {
    if (original !== undefined) process.env["HEYGEN_API_URL"] = original;
    else delete process.env["HEYGEN_API_URL"];
  });

  it("apiBaseUrl defaults to https://api.heygen.com", () => {
    expect(apiBaseUrl()).toBe("https://api.heygen.com");
  });

  it("apiBaseUrl honors HEYGEN_API_URL and strips trailing slash", () => {
    process.env["HEYGEN_API_URL"] = "https://api.dev.heygen.com/";
    expect(apiBaseUrl()).toBe("https://api.dev.heygen.com");
  });

  it("buildAuthHeaders uses Bearer for oauth", () => {
    const cred: ResolvedCredential = {
      type: "oauth",
      access_token: "at_123",
      source: "file_json",
      refreshable: false,
    };
    expect(buildAuthHeaders(cred)).toEqual({
      authorization: "Bearer at_123",
      [HEYGEN_CLI_SOURCE_HEADER]: HEYGEN_CLI_SOURCE,
      [HEYGEN_CLIENT_SOURCE_HEADER]: HEYGEN_CLIENT_SOURCE,
    });
  });

  it("buildAuthHeaders uses x-api-key for api_key, without the cli-source header but with the tool tag", () => {
    expect(buildAuthHeaders(apiKeyCred())).toEqual({
      "x-api-key": "hg_x",
      [HEYGEN_CLIENT_SOURCE_HEADER]: HEYGEN_CLIENT_SOURCE,
    });
  });

  it("getCurrentUser parses a wrapped {data: {...}} payload", async () => {
    const client = makeClient(
      jsonFetch({
        code: 100,
        message: "ok",
        data: {
          username: "alice",
          email: "alice@example.com",
          billing_type: "subscription",
          subscription: {
            plan: "team",
            credits: {
              premium_credits: { remaining: 4200, resets_at: "2026-12-01T00:00:00Z" },
              add_on_credits: { remaining: 9 },
            },
          },
        },
      }),
    );
    const user = await client.getCurrentUser(apiKeyCred());
    expect(user.username).toBe("alice");
    expect(user.email).toBe("alice@example.com");
    expect(user.subscription?.plan).toBe("team");
    expect(user.subscription?.credits?.premium_credits?.remaining).toBe(4200);
    expect(user.subscription?.credits?.premium_credits?.resets_at).toBe("2026-12-01T00:00:00Z");
    expect(user.subscription?.credits?.add_on_credits?.remaining).toBe(9);
  });

  it("getCurrentUser parses an unwrapped payload", async () => {
    const client = makeClient(jsonFetch({ email: "bob@example.com" }));
    const user = await client.getCurrentUser(apiKeyCred());
    expect(user.email).toBe("bob@example.com");
  });

  it("getCurrentUser throws ErrUnauthenticated on 401", async () => {
    const client = makeClient(textFetch("invalid token", 401));
    await expectAuthCode(client.getCurrentUser(apiKeyCred()), "UNAUTHENTICATED");
  });

  it("getCurrentUser throws ErrApi on 5xx", async () => {
    const client = makeClient(textFetch("upstream", 503));
    await expectAuthCode(client.getCurrentUser(apiKeyCred()), "API_ERROR");
  });

  it("getCurrentUser throws ErrApi when 2xx body is not valid JSON", async () => {
    const fetchImpl = (async () =>
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    const client = makeClient(fetchImpl);
    await expectAuthCode(client.getCurrentUser(apiKeyCred()), "API_ERROR");
  });

  it("getCurrentUser returns empty UserInfo when payload.data is an array", async () => {
    const client = makeClient(jsonFetch({ code: 0, data: [{ email: "x@y" }] }));
    const user = await client.getCurrentUser(apiKeyCred());
    expect(user).toEqual({});
  });

  it("getCurrentUser scrubs hg_ keys and JWTs from 401 detail", async () => {
    const fetchImpl = textFetch(
      'invalid request — got header "x-api-key: hg_supersecret_abc123"',
      401,
    );
    const client = makeClient(fetchImpl);
    await expectRejectionMessage(client, (msg) => {
      expect(msg).not.toContain("hg_supersecret_abc123");
      expect(msg).toContain("<redacted>");
    });
  });

  it("getCurrentUser redacts the full Authorization: Bearer value (not just the scheme)", async () => {
    const fetchImpl = textFetch(
      "rejected — echoed Authorization: Bearer at_opaque_secret_999",
      401,
    );
    const client = makeClient(fetchImpl);
    await expectRejectionMessage(client, (msg) => {
      expect(msg).not.toContain("at_opaque_secret_999");
      expect(msg).not.toContain("Bearer at_opaque_secret_999");
      expect(msg).toContain("<redacted>");
    });
  });

  it("getCurrentUser retries once on 401 when refresh hook is configured for OAuth", async () => {
    let callCount = 0;
    const observed: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      callCount++;
      const headers = (init?.headers as Record<string, string>) ?? {};
      observed.push(headers["authorization"] ?? "");
      if (callCount === 1) return new Response("expired", { status: 401 });
      return new Response(JSON.stringify({ email: "a@b" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new AuthClient({
      baseUrl: "https://api.test.example",
      fetchImpl,
      onUnauthenticatedRefresh: async () => ({
        access_token: "fresh_at",
        refresh_token: "fresh_rt",
      }),
    });
    const user = await client.getCurrentUser({
      type: "oauth",
      access_token: "stale_at",
      refresh_token: "rt",
      source: "file_json",
      refreshable: true,
    });
    expect(user.email).toBe("a@b");
    expect(observed[0]).toBe("Bearer stale_at");
    expect(observed[1]).toBe("Bearer fresh_at");
    expect(callCount).toBe(2);
  });

  it("getCurrentUser hook returns full token set so the retry credential carries any rotated refresh_token", async () => {
    // The hook contract now returns `OAuthTokens` (access_token plus an
    // optional rotated refresh_token), not just an access_token string.
    // For IdPs that rotate refresh_tokens on every exchange, any future
    // retry on the in-memory credential needs the FRESH rt — the in-
    // memory credential must be rebuilt from the hook's return, not
    // re-use the stale rt from the original credential.
    let receivedRt = "";
    const fetchImpl = (async () =>
      new Response("expired", { status: 401 })) as unknown as typeof fetch;
    const client = new AuthClient({
      baseUrl: "https://api.test.example",
      fetchImpl,
      onUnauthenticatedRefresh: async (rt) => {
        receivedRt = rt;
        // Hook MUST be able to return a rotated refresh_token — this
        // would have been impossible with the old `Promise<string>`
        // contract. The type checker fails the build if the shape drifts.
        return { access_token: "fresh_at", refresh_token: "rotated_rt" };
      },
    });
    await expect(
      client.getCurrentUser({
        type: "oauth",
        access_token: "stale_at",
        refresh_token: "ORIGINAL_rt",
        source: "file_json",
        refreshable: true,
      }),
    ).rejects.toSatisfy((err) => isAuthError(err));
    expect(receivedRt).toBe("ORIGINAL_rt");
  });

  it("getCurrentUser does NOT retry on 401 for api_key credentials", async () => {
    let callCount = 0;
    const fetchImpl = (async () => {
      callCount++;
      return new Response("invalid", { status: 401 });
    }) as unknown as typeof fetch;
    const client = new AuthClient({
      baseUrl: "https://api.test.example",
      fetchImpl,
      onUnauthenticatedRefresh: async () => ({ access_token: "fresh" }),
    });
    await expect(client.getCurrentUser(apiKeyCred())).rejects.toSatisfy((err) => {
      return isAuthError(err) && (err as { code: string }).code === "UNAUTHENTICATED";
    });
    expect(callCount).toBe(1);
  });

  it("getCurrentUser surfaces 401 when refresh hook returns null (refresh failed)", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const { ErrRefreshFailed } = await import("./errors.js");
    const client = new AuthClient({
      baseUrl: "https://api.test.example",
      fetchImpl,
      onUnauthenticatedRefresh: async () => {
        throw ErrRefreshFailed("invalid_grant");
      },
    });
    await expect(
      client.getCurrentUser({
        type: "oauth",
        access_token: "stale",
        refresh_token: "rt",
        source: "file_json",
        refreshable: true,
      }),
    ).rejects.toSatisfy((err) => {
      return isAuthError(err) && (err as { code: string }).code === "UNAUTHENTICATED";
    });
  });

  it("getCurrentUser sends the right header for oauth credentials", async () => {
    let captured: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({ email: "alice@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = makeClient(fetchImpl);
    await client.getCurrentUser({
      type: "oauth",
      access_token: "at_xyz",
      source: "file_json",
      refreshable: false,
    });
    expect(captured["authorization"]).toBe("Bearer at_xyz");
  });
});
