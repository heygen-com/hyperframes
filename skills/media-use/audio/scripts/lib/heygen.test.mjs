import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heygenAuthHeaders, heygenAuthHeadersWithRefresh, heygenAuthMethod } from "./heygen.mjs";

function withCleanHeygenEnv(fn) {
  const previousApiKey = process.env.HEYGEN_API_KEY;
  const previousHyperframesApiKey = process.env.HYPERFRAMES_API_KEY;
  const previousConfigDir = process.env.HEYGEN_CONFIG_DIR;
  try {
    delete process.env.HEYGEN_API_KEY;
    delete process.env.HYPERFRAMES_API_KEY;
    delete process.env.HEYGEN_CONFIG_DIR;
    return fn();
  } finally {
    if (previousApiKey === undefined) delete process.env.HEYGEN_API_KEY;
    else process.env.HEYGEN_API_KEY = previousApiKey;
    if (previousHyperframesApiKey === undefined) delete process.env.HYPERFRAMES_API_KEY;
    else process.env.HYPERFRAMES_API_KEY = previousHyperframesApiKey;
    if (previousConfigDir === undefined) delete process.env.HEYGEN_CONFIG_DIR;
    else process.env.HEYGEN_CONFIG_DIR = previousConfigDir;
  }
}

async function withCleanHeygenEnvAsync(fn) {
  const previousApiKey = process.env.HEYGEN_API_KEY;
  const previousHyperframesApiKey = process.env.HYPERFRAMES_API_KEY;
  const previousConfigDir = process.env.HEYGEN_CONFIG_DIR;
  try {
    delete process.env.HEYGEN_API_KEY;
    delete process.env.HYPERFRAMES_API_KEY;
    delete process.env.HEYGEN_CONFIG_DIR;
    return await fn();
  } finally {
    if (previousApiKey === undefined) delete process.env.HEYGEN_API_KEY;
    else process.env.HEYGEN_API_KEY = previousApiKey;
    if (previousHyperframesApiKey === undefined) delete process.env.HYPERFRAMES_API_KEY;
    else process.env.HYPERFRAMES_API_KEY = previousHyperframesApiKey;
    if (previousConfigDir === undefined) delete process.env.HEYGEN_CONFIG_DIR;
    else process.env.HEYGEN_CONFIG_DIR = previousConfigDir;
  }
}

test("heygenAuthHeaders does not tag API-key requests as CLI traffic, but still carries the media-use tool tag", () => {
  withCleanHeygenEnv(() => {
    process.env.HEYGEN_API_KEY = "hg_test";
    // API-key requests use normal billing; the backend ignores the cli-source
    // header for them, so it's not sent. The tool-attribution header IS sent on
    // every media-use call (any auth type) so the backend can isolate media-use.
    assert.deepEqual(heygenAuthHeaders(), {
      "X-Api-Key": "hg_test",
      "X-HeyGen-Client-Source": "media-use",
    });
  });
});

test("heygenAuthHeaders tags OAuth requests as CLI traffic and with the media-use tool tag", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      process.env.HEYGEN_CONFIG_DIR = dir;
      writeFileSync(
        join(dir, "credentials"),
        JSON.stringify({
          oauth: {
            access_token: "at_test",
            expires_at: "2099-01-01T00:00:00Z",
          },
        }),
      );
      assert.deepEqual(heygenAuthHeaders(), {
        Authorization: "Bearer at_test",
        "X-HeyGen-Source": "cli",
        "X-HeyGen-Client-Source": "media-use",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("heygenAuthMethod returns api_key for an env API key, without tagging headers", () => {
  withCleanHeygenEnv(() => {
    process.env.HEYGEN_API_KEY = "hg_test";
    assert.equal(heygenAuthMethod(), "api_key");
  });
});

test("heygenAuthMethod returns oauth for a live OAuth credential", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      process.env.HEYGEN_CONFIG_DIR = dir;
      writeFileSync(
        join(dir, "credentials"),
        JSON.stringify({
          oauth: {
            access_token: "at_test",
            expires_at: "2099-01-01T00:00:00Z",
          },
        }),
      );
      assert.equal(heygenAuthMethod(), "oauth");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("heygenAuthMethod returns oauth for a refreshable expired credential", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      process.env.HEYGEN_CONFIG_DIR = dir;
      writeFileSync(
        join(dir, "credentials"),
        JSON.stringify({
          oauth: {
            refresh_token: "current-refresh",
            expires_at: "2000-01-01T00:00:00Z",
          },
        }),
      );
      assert.equal(heygenAuthMethod(), "oauth");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("heygenAuthMethod returns null with no credential at all", () => {
  withCleanHeygenEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      process.env.HEYGEN_CONFIG_DIR = dir; // no credentials file written
      assert.equal(heygenAuthMethod(), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("heygenAuthHeadersWithRefresh silently renews an expired OAuth credential", async () => {
  await withCleanHeygenEnvAsync(async () => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      process.env.HEYGEN_CONFIG_DIR = dir;
      const credentialsPath = join(dir, "credentials");
      writeFileSync(
        credentialsPath,
        JSON.stringify({
          api_key: "preserved-api-key",
          oauth: {
            access_token: "expired-access",
            refresh_token: "current-refresh",
            expires_at: "2000-01-01T00:00:00Z",
            scope: "openid profile",
          },
          user: { email: "person@example.com" },
        }),
      );

      let request;
      const headers = await heygenAuthHeadersWithRefresh(async (url, options) => {
        request = { url, options };
        return new Response(
          JSON.stringify({
            access_token: "renewed-access",
            refresh_token: "rotated-refresh",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

      assert.equal(request.url, "https://api2.heygen.com/v1/oauth/token");
      assert.equal(request.options.method, "POST");
      assert.match(request.options.body, /grant_type=refresh_token/);
      assert.match(request.options.body, /refresh_token=current-refresh/);
      assert.deepEqual(headers, {
        Authorization: "Bearer renewed-access",
        "X-HeyGen-Source": "cli",
        "X-HeyGen-Client-Source": "media-use",
      });

      const saved = JSON.parse(readFileSync(credentialsPath, "utf8"));
      assert.equal(saved.api_key, "preserved-api-key");
      assert.deepEqual(saved.user, { email: "person@example.com" });
      assert.equal(saved.oauth.access_token, "renewed-access");
      assert.equal(saved.oauth.refresh_token, "rotated-refresh");
      assert.equal(saved.oauth.scope, "openid profile");
      assert.ok(new Date(saved.oauth.expires_at).getTime() > Date.now());
      assert.equal(statSync(credentialsPath).mode & 0o777, 0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("heygenAuthHeadersWithRefresh renews a credential with only a refresh token", async () => {
  await withCleanHeygenEnvAsync(async () => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      process.env.HEYGEN_CONFIG_DIR = dir;
      writeFileSync(
        join(dir, "credentials"),
        JSON.stringify({ oauth: { refresh_token: "current-refresh" } }),
      );

      const headers = await heygenAuthHeadersWithRefresh(
        async () =>
          new Response(JSON.stringify({ access_token: "renewed-access", expires_in: 3600 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );

      assert.equal(headers.Authorization, "Bearer renewed-access");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("concurrent OAuth refreshes share the credential rotation", async () => {
  await withCleanHeygenEnvAsync(async () => {
    const dir = mkdtempSync(join(tmpdir(), "heygen-cred-"));
    try {
      process.env.HEYGEN_CONFIG_DIR = dir;
      writeFileSync(
        join(dir, "credentials"),
        JSON.stringify({
          oauth: {
            access_token: "expired-access",
            refresh_token: "current-refresh",
            expires_at: "2000-01-01T00:00:00Z",
          },
        }),
      );

      let requests = 0;
      const fetchImpl = async () => {
        requests += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(
          JSON.stringify({
            access_token: "renewed-access",
            refresh_token: "rotated-refresh",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };

      const [first, second] = await Promise.all([
        heygenAuthHeadersWithRefresh(fetchImpl),
        heygenAuthHeadersWithRefresh(fetchImpl),
      ]);

      assert.equal(requests, 1);
      assert.deepEqual(second, first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
