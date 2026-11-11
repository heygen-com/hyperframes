#!/usr/bin/env node
// Run from the user's project; locate the release from this installed file.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/main-module.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifests = [
  "plugin.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  "gemini-extension.json",
];

export function pluginVersion(pluginRoot = root) {
  for (const path of manifests) {
    const file = join(pluginRoot, path);
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    if (
      manifest.name !== "hyperframes" ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")
    ) {
      throw new Error(`Invalid HyperFrames plugin release: ${file}`);
    }
    return manifest.version;
  }
  throw new Error(
    "No HyperFrames plugin manifest found. This is a standalone skill install; run `npx hyperframes` directly.",
  );
}

// npm takes the package, bin links and .npmrc from the folder it starts in, so npx starts
// in the home folder and the CLI moves into the project before it runs a command. A shared
// folder such as the temp folder is no substitute, so there is no fallback.
export function npmFolder(home = homedir(), pathExists = existsSync) {
  if (home && pathExists(home)) return home;
  throw new Error("Cannot find your home folder. Set HOME (USERPROFILE on Windows) and retry.");
}

export function invocation(
  args,
  {
    version = pluginVersion(),
    env = process.env,
    platform = process.platform,
    node = process.execPath,
    pathExists = existsSync,
    cwd = process.cwd(),
    npmCwd,
    launcher = fileURLToPath(import.meta.url),
  } = {},
) {
  if (args[0] === "skills")
    throw new Error(
      "Bundled skills are release-managed; the person updates HyperFrames through their agent's plugin manager.",
    );
  const childEnv = {
    ...env,
    HYPERFRAMES_SKIP_SKILLS: "1",
    HYPERFRAMES_SKILL_PKG_VERSION: version,
    HYPERFRAMES_PLUGIN_VERSION: version,
    HYPERFRAMES_NO_UPDATE_CHECK: "1",
  };
  if (args[0] === "--script") {
    if (!args[1]) throw new Error("--script requires a Node script path.");
    // Helpers that call the CLI run it through this launcher, never a `hyperframes` from the project.
    const env = { ...childEnv, HYPERFRAMES_CLI_ENTRY: launcher };
    return { command: node, args: args.slice(1), env, cwd };
  }
  const cliArgs = ["--yes", `hyperframes@${version}`, ...args];
  const cliEnv = { ...childEnv, HYPERFRAMES_PLUGIN_CWD: cwd };
  const npxCwd = npmCwd ?? npmFolder();
  if (platform !== "win32") return { command: "npx", args: cliArgs, env: cliEnv, cwd: npxCwd };
  const candidates = [
    env.npm_execpath && win32.join(win32.dirname(env.npm_execpath), "npx-cli.js"),
    win32.join(win32.dirname(node), "node_modules", "npm", "bin", "npx-cli.js"),
  ].filter(Boolean);
  const npx = candidates.find(pathExists);
  if (!npx)
    throw new Error(
      "Cannot find npx-cli.js. Install Node.js with npm or run from an npm environment.",
    );
  return { command: node, args: [npx, ...cliArgs], env: cliEnv, cwd: npxCwd };
}

if (isMainModule(import.meta.url)) {
  try {
    const command = invocation(process.argv.slice(2));
    const result = spawnSync(command.command, command.args, {
      cwd: command.cwd,
      env: command.env,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
