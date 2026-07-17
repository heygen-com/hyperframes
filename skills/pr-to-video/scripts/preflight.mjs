#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function hasCliCommand(helpText, command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s+${escaped}(?:\\s+|$)`, "m").test(String(helpText));
}

export function runCliPreflight({ command = "check", spawn = spawnSync } = {}) {
  const result = spawn("npx", ["hyperframes", "--help"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`unable to inspect HyperFrames CLI capabilities\n${output.trim()}`);
  }
  if (!hasCliCommand(output, command)) {
    throw new Error(
      `the installed HyperFrames CLI does not provide \`${command}\`, but the current pr-to-video skill requires it. Upgrade the CLI before starting frame work.`,
    );
  }
  return true;
}

function main() {
  try {
    runCliPreflight();
    console.log("✓ pr-to-video preflight: required CLI capabilities are available");
  } catch (error) {
    console.error(`✗ pr-to-video preflight: ${error.message}`);
    process.exit(1);
  }
}

// realpath both sides: on macOS /tmp → /private/tmp, and node resolves the main
// module's symlinks in import.meta.url while argv[1] keeps the invoked spelling —
// a raw compare silently skips main() when invoked through any symlinked path.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) main();
