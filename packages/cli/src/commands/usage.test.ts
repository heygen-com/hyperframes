import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("prints the real CLI plan while keeping usage out of telemetry and other network requests", () => {
  const profile = mkdtempSync(join(tmpdir(), "hf-usage-"));
  try {
    writeFileSync(
      join(profile, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: { accessToken: "fixture-token", scopes: ["user:profile"] },
      }),
    );
    const requests = join(profile, "requests.jsonl");
    const preload = join(profile, "transport.mjs");
    writeFileSync(
      preload,
      `
import { appendFileSync } from "node:fs";
globalThis.fetch = async (url, options) => {
  appendFileSync(${JSON.stringify(requests)}, JSON.stringify(String(url)) + "\\n");
  if (String(url) !== "https://api.anthropic.com/api/oauth/usage") throw new Error("unexpected network request");
  if (options.headers.Authorization !== "Bearer fixture-token") throw new Error("wrong credential");
  return new Response(JSON.stringify({five_hour:{utilization:90},seven_day:{utilization:20}}));
};
`,
    );
    const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: profile };
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
        preload,
        resolve("src/cli.ts"),
        "usage",
        "--harness",
        "claude-code",
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
      remainingPercent: 10,
      plan: "first-cut-first",
    });
    expect(stdout).not.toContain("fixture-token");
    expect(readFileSync(requests, "utf8").trim().split("\n")).toEqual([
      '"https://api.anthropic.com/api/oauth/usage"',
    ]);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});
