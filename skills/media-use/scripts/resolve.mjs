#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNpxInvocation } from "./lib/npx-sync.mjs";

// Installed plugins have no monorepo packages/ tree. The plugin launcher passes
// the release version and suppression environment through to this legacy shim.
const pluginVersion = process.env.HYPERFRAMES_PLUGIN_VERSION;
if (pluginVersion) {
  const invocation = resolveNpxInvocation(
    ["--yes", `hyperframes@${pluginVersion}`, "media-use", "resolve", ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  const result = spawnSync(invocation.cmd, invocation.args, invocation.opts);
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
const root = join(fileURLToPath(new URL("../../../", import.meta.url)));
const dist = join(root, "packages/cli/dist/cli.js");
const result = existsSync(dist)
  ? spawnSync(process.execPath, [dist, "media-use", "resolve", ...process.argv.slice(2)], {
      stdio: "inherit",
    })
  : spawnSync(
      "bun",
      [join(root, "packages/cli/src/cli.ts"), "media-use", "resolve", ...process.argv.slice(2)],
      { stdio: "inherit" },
    );
process.exit(result.status ?? 1);
