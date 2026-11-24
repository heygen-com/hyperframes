#!/usr/bin/env node
import "./lib/windows-exe-search.mjs";
import { spawnSync } from "node:child_process";
import { resolveNpxInvocation } from "./lib/npx-sync.mjs";

// Legacy shim: runs only the CLI the plugin launcher (or the person, by HYPERFRAMES_CLI_ENTRY) hands over. It never
// runs a packages/cli found beside its own folder: in a project-scope install that folder is the project's.
try {
  const invocation = resolveNpxInvocation(
    ["hyperframes", "media-use", "resolve", ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  const result = spawnSync(invocation.cmd, invocation.args, invocation.opts);
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
