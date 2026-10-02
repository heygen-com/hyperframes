import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const fixtureTiers: Record<string, string> = {
  "claude-code": "max",
  codex: "plus",
  grok: "SuperGrok",
};

it.each(
  [
    {
      harness: "claude-code",
      path: ".credentials.json",
      auth: {
        claudeAiOauth: {
          accessToken: "fixture-token",
          subscriptionType: "max",
          scopes: ["user:profile"],
        },
      },
      url: "https://api.anthropic.com/api/oauth/usage",
      response: { five_hour: { utilization: 90 }, seven_day: { utilization: 20 } },
    },
    {
      harness: "codex",
      path: "auth.json",
      auth: { tokens: { access_token: "fixture-token", account_id: "fixture-account" } },
      url: "https://chatgpt.com/backend-api/wham/usage",
      response: {
        plan_type: "plus",
        rate_limit: {
          primary_window: { used_percent: 90, limit_window_seconds: 18000 },
          secondary_window: { used_percent: 20, limit_window_seconds: 604800 },
        },
      },
    },
    {
      harness: "grok",
      path: "auth.json",
      auth: {
        fixture: { key: "fixture-token", auth_mode: "oidc", oidc_issuer: "https://auth.x.ai" },
      },
      url: "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
      response: {
        config: {
          currentPeriod: {
            type: "USAGE_PERIOD_TYPE_WEEKLY",
            start: "2026-10-01T00:00:00Z",
            end: "2026-10-08T00:00:00Z",
          },
          creditUsagePercent: 90,
        },
      },
    },
  ].flatMap((fixture) => {
    if (fixture.harness === "grok")
      return [
        { ...fixture, settingsFail: false, missingTier: false },
        { ...fixture, settingsFail: true, missingTier: false },
      ];
    if (fixture.harness === "claude-code")
      return [
        { ...fixture, settingsFail: false, missingTier: false },
        {
          ...fixture,
          settingsFail: false,
          missingTier: true,
          auth: {
            claudeAiOauth: {
              accessToken: "fixture-token",
              subscriptionType: null,
              scopes: ["user:profile"],
            },
          },
        },
      ];
    return [{ ...fixture, settingsFail: false, missingTier: false }];
  }),
)(
  "prints the real $harness CLI usage and subscription tier without exposing tokens",
  ({ harness, path, auth, url, response, settingsFail, missingTier }) => {
    const profile = mkdtempSync(join(tmpdir(), "hf-usage-"));
    try {
      const originalAuth = JSON.stringify(auth);
      writeFileSync(join(profile, path), originalAuth);
      const requests = join(profile, "requests.jsonl");
      const preload = join(profile, "transport.mjs");
      writeFileSync(
        preload,
        `
import { appendFileSync } from "node:fs";
globalThis.fetch = async (url, options) => {
  appendFileSync(${JSON.stringify(requests)}, JSON.stringify(String(url)) + "\\n");
  const settings = ${JSON.stringify(harness)} === "grok" && String(url) === "https://cli-chat-proxy.grok.com/v1/settings";
  if (String(url) !== ${JSON.stringify(url)} && !settings) throw new Error("unexpected network request");
  if (options.headers.Authorization !== "Bearer fixture-token") throw new Error("wrong credential");
  if (${JSON.stringify(harness)} === "codex" && options.headers["ChatGPT-Account-Id"] !== "fixture-account") throw new Error("missing account header");
  if (${JSON.stringify(harness)} === "grok" && options.headers["X-XAI-Token-Auth"] !== "xai-grok-cli") throw new Error("missing Grok header");
  if (settings && ${JSON.stringify(settingsFail)}) return new Response("unavailable", {status:503});
  return new Response(settings ? JSON.stringify({subscription_tier_display:"SuperGrok"}) : ${JSON.stringify(JSON.stringify(response))});
};
`,
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        CLAUDE_CONFIG_DIR: profile,
        CODEX_HOME: profile,
        GROK_AUTH_PATH: join(profile, path),
      };
      for (const key of [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "CLAUDE_CODE_CUSTOM_OAUTH_URL",
        "USE_LOCAL_OAUTH",
        "USE_STAGING_OAUTH",
      ])
        delete env[key];
      const stdout = execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--import",
          pathToFileURL(preload).href,
          resolve("src/cli.ts"),
          "usage",
          "--harness",
          harness,
          "--json",
        ],
        {
          cwd: resolve("."),
          env,
          encoding: "utf8",
          timeout: 15000,
        },
      );
      expect(JSON.parse(stdout)).toMatchObject({
        status: "known",
        planTier: settingsFail || missingTier ? null : fixtureTiers[harness],
        weekly: {
          usedPercent: harness === "grok" ? 90 : 20,
          remainingPercent: harness === "grok" ? 10 : 80,
        },
      });
      expect(stdout).not.toContain("fixture-token");
      expect(readFileSync(join(profile, path), "utf8")).toBe(originalAuth);
      const expectedRequests = [url];
      if (harness === "grok") expectedRequests.push("https://cli-chat-proxy.grok.com/v1/settings");
      expect(readFileSync(requests, "utf8").trim().split("\n")).toEqual(
        expectedRequests.map((request) => JSON.stringify(request)),
      );
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  },
);

it.each([
  {
    harness: "codex",
    auth: { tokens: { access_token: "fixture.eyJleHAiOjF9.signature" } },
    reason: "expired_login",
  },
  {
    harness: "grok",
    auth: {
      fixture: {
        key: "fixture-token",
        auth_mode: "oidc",
        oidc_issuer: "https://auth.x.ai",
        expires_at: "2000-01-01T00:00:00Z",
      },
    },
    reason: "expired_login",
  },
  {
    harness: "grok",
    auth: { fixture: { key: "fixture-token", auth_mode: "api_key" } },
    reason: "unsupported_auth",
  },
  {
    harness: "grok",
    auth: {
      a: { key: "fixture-token", auth_mode: "oidc", oidc_issuer: "https://auth.x.ai" },
      b: { key: "fixture-token-2", auth_mode: "oidc", oidc_issuer: "https://auth.x.ai" },
    },
    reason: "ambiguous_login",
  },
])(
  "keeps $harness $reason unknown without requests or auth writes",
  ({ harness, auth, reason }) => {
    const profile = mkdtempSync(join(tmpdir(), "hf-usage-"));
    try {
      const authFile = join(profile, "auth.json");
      const originalAuth = JSON.stringify(auth);
      writeFileSync(authFile, originalAuth);
      const preload = join(profile, "transport.mjs");
      const requests = join(profile, "requests.jsonl");
      writeFileSync(
        preload,
        `import {writeFileSync} from "node:fs"; globalThis.fetch = async () => {writeFileSync(${JSON.stringify(requests)}, "unexpected"); throw new Error("unexpected network request");};`,
      );
      const stdout = execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--import",
          pathToFileURL(preload).href,
          resolve("src/cli.ts"),
          "usage",
          "--harness",
          harness,
          "--json",
        ],
        {
          env: { ...process.env, CODEX_HOME: profile, GROK_AUTH_PATH: authFile },
          encoding: "utf8",
          timeout: 15000,
        },
      );
      expect(JSON.parse(stdout)).toEqual({
        status: "unknown",
        reason,
      });
      expect(stdout).not.toContain("fixture-token");
      expect(readFileSync(authFile, "utf8")).toBe(originalAuth);
      expect(existsSync(requests)).toBe(false);
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  },
);
