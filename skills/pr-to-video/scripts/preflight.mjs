#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function hasCliCommand(helpText, command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s+${escaped}(?:\\s+|$)`, "m").test(String(helpText));
}

export function runCliPreflight({ command = "check", cliVersion, spawn = spawnSync } = {}) {
  const launcher = fileURLToPath(
    new URL("../../hyperframes/scripts/plugin-cli.mjs", import.meta.url),
  );
  let executable = process.execPath;
  let args = [launcher, "--help"];
  let shell = false;
  if (cliVersion !== undefined) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(cliVersion))
      throw new Error("Standalone preflight requires an exact CLI release, such as 1.2.3.");
    executable = "npx";
    args = ["--yes", `hyperframes@${cliVersion}`, "--help"];
    // Only the validated release and fixed arguments enter the Windows command shim.
    shell = process.platform === "win32";
  } else if (!existsSync(launcher)) {
    throw new Error(
      "Standalone install: run this preflight with the exact CLI release as its argument, or run npx -y hyperframes@<exact-version> --help and confirm it lists check.",
    );
  }
  const result = spawn(executable, args, {
    encoding: "utf8",
    windowsHide: true,
    shell,
  });
  if (result.error) throw result.error;
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
    const [cliVersion, ...extra] = process.argv.slice(2);
    if (extra.length > 0) throw new Error("Usage: preflight.mjs [exact-cli-version]");
    runCliPreflight({ cliVersion });
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
