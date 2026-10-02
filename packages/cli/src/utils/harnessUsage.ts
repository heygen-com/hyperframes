import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Ajv from "ajv/dist/jtd.js";
import type { JTDDataType } from "ajv/dist/jtd.js";
import {
  parseHarnessUsage,
  parseCodexUsage,
  parseGrokUsage,
  unknownUsage,
  type HarnessUsage,
} from "./usageBudget.js";

const credentialSchema = {
  properties: {
    claudeAiOauth: {
      properties: { accessToken: { type: "string" } },
      optionalProperties: {
        expiresAt: { type: "float64" },
        scopes: { elements: { type: "string" } },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
} as const;
const parseCredentials = new Ajv().compileParser<JTDDataType<typeof credentialSchema>>(
  credentialSchema,
);
const exec = promisify(execFile);

type Harness = "claude-code" | "codex" | "grok";
type Credential = { token: string; headers: Record<string, string>; expiresAt?: number };
type Login =
  | { status: "ready"; credential: Credential }
  | { status: "unavailable"; reason: string };

export async function readHarnessUsage(harness: string): Promise<HarnessUsage> {
  switch (harness) {
    case "claude-code":
      return readClaudeUsage();
    case "codex":
    case "grok":
      return readOtherHarness(harness);
    default:
      return unknownUsage("unsupported_harness");
  }
}

async function readClaudeUsage(): Promise<HarnessUsage> {
  if (
    [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CODE_CUSTOM_OAUTH_URL",
      "USE_LOCAL_OAUTH",
      "USE_STAGING_OAUTH",
    ].some((key) => process.env[key])
  )
    return unknownUsage("unsupported_auth");
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  const candidates: string[] = [];
  if (process.platform === "darwin") {
    let service = "Claude Code-credentials";
    if (configDir)
      service += `-${createHash("sha256").update(configDir.normalize("NFC")).digest("hex").slice(0, 8)}`;
    try {
      const { stdout } = await exec(
        "/usr/bin/security",
        ["find-generic-password", "-s", service, "-w"],
        {
          timeout: 2000,
          maxBuffer: 1024 * 1024,
        },
      );
      candidates.push(stdout);
    } catch {
      // An unavailable keychain leaves the credential file as the read-only fallback.
    }
  }
  try {
    candidates.push(
      await readFile(join(configDir ?? join(homedir(), ".claude"), ".credentials.json"), "utf8"),
    );
  } catch {
    // No login file is normal for API-key and unsupported harness sessions.
  }
  let reason = "no_subscription_login";
  for (const text of candidates) {
    const login = claudeLogin(text);
    if (login.status === "unavailable") {
      reason = login.reason;
      continue;
    }
    const usage = await requestUsage("claude-code", login.credential);
    if (usage.status === "unknown" && ["http_401", "http_403"].includes(usage.reason)) {
      reason = usage.reason;
      continue;
    }
    return usage;
  }
  return unknownUsage(reason);
}

const authParser = new Ajv();
const codexAuthSchema = {
  properties: {
    tokens: {
      properties: { access_token: { type: "string" } },
      optionalProperties: { account_id: { type: "string" } },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
} as const;
const grokAuthSchema = {
  values: {
    optionalProperties: {
      key: { type: "string" },
      auth_mode: { type: "string" },
      oidc_issuer: { type: "string" },
      expires_at: { type: "string" },
      expires: { type: "string" },
    },
    additionalProperties: true,
  },
} as const;
const jwtSchema = {
  optionalProperties: { exp: { type: "float64" } },
  additionalProperties: true,
} as const;
const parseCodexAuth =
  authParser.compileParser<JTDDataType<typeof codexAuthSchema>>(codexAuthSchema);
const parseGrokAuth = authParser.compileParser<JTDDataType<typeof grokAuthSchema>>(grokAuthSchema);
const parseJwt = authParser.compileParser<JTDDataType<typeof jwtSchema>>(jwtSchema);

function tokenExpiry(token: string): number | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const expiry = parseJwt(Buffer.from(parts[1], "base64url").toString("utf8"))?.exp;
  return expiry === undefined ? undefined : expiry * 1000;
}

function validLogin(credential: Credential, now: number): Login {
  if (credential.expiresAt !== undefined) {
    if (!Number.isFinite(credential.expiresAt))
      return { status: "unavailable", reason: "invalid_login" };
    if (credential.expiresAt <= now) return { status: "unavailable", reason: "expired_login" };
  }
  return { status: "ready", credential };
}

function claudeLogin(text: string): Login {
  const auth = parseCredentials(text)?.claudeAiOauth;
  if (!auth?.accessToken.trim()) return { status: "unavailable", reason: "no_subscription_login" };
  if (auth.scopes !== undefined && !auth.scopes.includes("user:profile"))
    return { status: "unavailable", reason: "missing_profile_scope" };
  return validLogin(
    {
      token: auth.accessToken.trim(),
      headers: { "anthropic-beta": "oauth-2025-04-20" },
      expiresAt: auth.expiresAt,
    },
    Date.now(),
  );
}

function codexLogin(text: string): Login {
  const auth = parseCodexAuth(text)?.tokens;
  if (!auth?.access_token.trim()) return { status: "unavailable", reason: "no_subscription_login" };
  const token = auth.access_token.trim();
  const headers: Record<string, string> = {};
  if (auth.account_id) headers["ChatGPT-Account-Id"] = auth.account_id;
  return validLogin({ token, headers, expiresAt: tokenExpiry(token) }, Date.now());
}

function grokLogin(text: string): Login {
  const auth = parseGrokAuth(text);
  if (!auth) return { status: "unavailable", reason: "invalid_login" };
  const candidates = Object.values(auth).flatMap((entry) => {
    const token = entry.key?.trim();
    if (
      !token ||
      !["oidc", "external"].includes(entry.auth_mode ?? "") ||
      entry.oidc_issuer !== "https://auth.x.ai"
    )
      return [];
    return [{ entry, token }];
  });
  if (!candidates.length) return { status: "unavailable", reason: "unsupported_auth" };
  if (candidates.length !== 1) return { status: "unavailable", reason: "ambiguous_login" };
  const { entry, token } = candidates[0];
  const storedExpiry = entry.expires_at ?? entry.expires;
  const expiresAt =
    tokenExpiry(token) ?? (storedExpiry === undefined ? undefined : Date.parse(storedExpiry));
  return validLogin(
    { token, headers: { "X-XAI-Token-Auth": "xai-grok-cli" }, expiresAt },
    Date.now(),
  );
}

async function readOtherHarness(harness: "codex" | "grok"): Promise<HarnessUsage> {
  const path =
    harness === "codex"
      ? join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json")
      : process.env.GROK_AUTH_PATH ||
        join(process.env.GROK_HOME || join(homedir(), ".grok"), "auth.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return unknownUsage("no_subscription_login");
  }
  const login = harness === "codex" ? codexLogin(text) : grokLogin(text);
  if (login.status === "unavailable") return unknownUsage(login.reason);
  return requestUsage(harness, login.credential);
}

const providers = {
  "claude-code": { url: "https://api.anthropic.com/api/oauth/usage", parse: parseHarnessUsage },
  codex: { url: "https://chatgpt.com/backend-api/wham/usage", parse: parseCodexUsage },
  grok: { url: "https://cli-chat-proxy.grok.com/v1/billing?format=credits", parse: parseGrokUsage },
} satisfies Record<Harness, { url: string; parse: (text: string) => HarnessUsage }>;

async function requestUsage(harness: Harness, credential: Credential): Promise<HarnessUsage> {
  let response: Response;
  let body: string;
  try {
    response = await fetch(providers[harness].url, {
      headers: {
        Accept: "application/json",
        ...credential.headers,
        Authorization: `Bearer ${credential.token}`,
      },
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    body = await response.text();
  } catch {
    return unknownUsage("usage_request_failed");
  }
  if (!response.ok) {
    if (
      harness === "grok" &&
      response.status === 412 &&
      body.toLowerCase().includes("no personal team")
    )
      return unknownUsage("team_quota_unavailable");
    return unknownUsage(`http_${response.status}`);
  }
  return providers[harness].parse(body);
}
