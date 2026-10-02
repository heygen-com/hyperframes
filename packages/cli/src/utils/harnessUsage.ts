import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Ajv from "ajv/dist/jtd.js";
import type { JTDDataType } from "ajv/dist/jtd.js";
import { parseHarnessUsage, unknownUsage, type HarnessUsage } from "./usageBudget.js";

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

export async function readHarnessUsage(harness: string): Promise<HarnessUsage> {
  if (harness !== "claude-code") return unknownUsage("unsupported_harness");
  if (
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_BASE_URL ||
    process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL ||
    process.env.USE_LOCAL_OAUTH ||
    process.env.USE_STAGING_OAUTH
  ) {
    return unknownUsage("unsupported_auth");
  }
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  const candidates: string[] = [];
  if (process.platform === "darwin") {
    let service = "Claude Code-credentials";
    if (configDir)
      service += `-${createHash("sha256").update(configDir.normalize("NFC")).digest("hex").slice(0, 8)}`;
    try {
      const { stdout } = await exec("security", ["find-generic-password", "-s", service, "-w"], {
        timeout: 2000,
        maxBuffer: 1024 * 1024,
      });
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
    const credentials = parseCredentials(text)?.claudeAiOauth;
    if (!credentials || !credentials.accessToken.trim()) continue;
    if (credentials.expiresAt !== undefined && credentials.expiresAt <= Date.now()) {
      reason = "expired_login";
      continue;
    }
    if (credentials.scopes !== undefined && !credentials.scopes.includes("user:profile")) {
      reason = "missing_profile_scope";
      continue;
    }
    let response: Response;
    let body: string;
    try {
      response = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: {
          Authorization: `Bearer ${credentials.accessToken.trim()}`,
          Accept: "application/json",
          "anthropic-beta": "oauth-2025-04-20",
        },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (response.status === 401 || response.status === 403) {
        reason = `http_${response.status}`;
        continue;
      }
      if (!response.ok) return unknownUsage(`http_${response.status}`);
      body = await response.text();
    } catch {
      return unknownUsage("usage_request_failed");
    }
    return parseHarnessUsage(body);
  }
  return unknownUsage(reason);
}
