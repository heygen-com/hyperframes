import { spawnSync } from "node:child_process";
import dns from "node:dns";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { fetchPublicHttpsText } from "./urlDownloader.js";

const FIXTURE = fileURLToPath(new URL("./__fixtures__/downloadPrivateAnswer.mjs", import.meta.url));
const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NODE_USE_ENV_PROXY"];

function envWithoutProxy(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of PROXY_VARS) delete env[name];
  return env;
}

describe("a name that resolves to a private address is refused on every runtime", () => {
  it("under Node", async () => {
    const lookup = vi
      .spyOn(dns, "lookup")
      .mockImplementation(((
        _host: string,
        _options: unknown,
        callback: (e: null, a: unknown) => void,
      ) => callback(null, [{ address: "10.1.2.3", family: 4 }])) as never);
    try {
      await expect(
        fetchPublicHttpsText("https://assets.example.test/x.html", { maxBytes: 1024 }),
      ).rejects.toMatchObject({ kind: "http_rejected" });
      expect(lookup).toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
    }
  });

  it("under Bun, which the Cloud Run image runs", () => {
    const run = spawnSync("bun", [FIXTURE], {
      encoding: "utf8",
      env: envWithoutProxy(),
      timeout: 60_000,
    });
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "{}");
    expect(result.outcome).toBe("http_rejected");
    expect(result.lookups).toBeGreaterThan(0);
  });
});
