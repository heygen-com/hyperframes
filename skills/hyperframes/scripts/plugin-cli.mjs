#!/usr/bin/env node
// Every skill starts the CLI through this file, from the user's project. A plugin install pins the
// release in its manifest; a standalone skill install takes the newest release from npm.
import "./lib/windows-exe-search.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
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

// The oldest release this launcher starts, for a plugin pin or any standalone selection. It matches
// the oldest release the HyperFrames Desktop app ships, which has every protection for projects
// received from someone else, so a pin copied from a project never runs a CLI without them.
// Desktop's release checks read this line from the published package, so it stays a string literal.
const CLI_FLOOR = "0.9.65";
export const STANDALONE_CLI = `hyperframes@>=${CLI_FLOOR}`;

const realOrResolved = (path) => {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
};

const isOutside = (from, to) => {
  const path = relative(from, to);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
};

// Plugin managers keep bundles in their own folders, such as ~/.claude/plugins or ~/.gemini/extensions.
// Skills in a dot folder (.agents, .claude) or in the working folder's own tree are project content.
function isPluginBundle(pluginRoot, workDir) {
  const bundle = realOrResolved(pluginRoot);
  const work = realOrResolved(workDir);
  if (basename(bundle).startsWith(".") || !isOutside(bundle, work)) return false;
  if (isOutside(work, bundle)) return true;
  return relative(work, bundle)
    .split(sep)
    .some((segment) => segment.startsWith("."));
}

function isBelowFloor(version) {
  const parts = (text) => text.split(/[-+]/, 1)[0].split(".").map(Number);
  const [have, floor] = [parts(version), parts(CLI_FLOOR)];
  const at = have.findIndex((part, index) => part !== floor[index]);
  return at === -1 ? version.split("+", 1)[0].includes("-") : have[at] < floor[at];
}

function isExactRelease(value) {
  const match =
    typeof value === "string" &&
    value.length <= 256 &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      value,
    );
  return Boolean(
    match &&
    !match[4]?.split(".").some((id) => /^0\d+$/.test(id)) &&
    match.slice(1, 4).every((part) => Number.isSafeInteger(Number(part))),
  );
}

function standaloneRelease(value) {
  if (value === "latest") return value;
  if (!isExactRelease(value)) {
    throw new Error("--cli-version requires latest or an exact HyperFrames version.");
  }
  if (isBelowFloor(value))
    throw new Error(
      `HyperFrames ${value} lacks protections for received projects; this launcher runs ${CLI_FLOOR} or newer. Use --cli-version latest or ${CLI_FLOOR} or newer.`,
    );
  return value;
}

export function pluginVersion(pluginRoot = root, workDir = process.cwd()) {
  if (!isPluginBundle(pluginRoot, workDir)) return undefined;
  for (const path of manifests) {
    const file = join(pluginRoot, path);
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    if (manifest.name !== "hyperframes" || !isExactRelease(manifest.version)) {
      throw new Error(`Invalid HyperFrames plugin release: ${file}`);
    }
    if (isBelowFloor(manifest.version))
      throw new Error(
        `${file} pins HyperFrames ${manifest.version}; this launcher runs ${CLI_FLOOR} or newer.`,
      );
    return manifest.version;
  }
  return undefined;
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
    cwd = process.cwd(),
    version = pluginVersion(root, cwd),
    env = process.env,
    platform = process.platform,
    node = process.execPath,
    pathExists = existsSync,
    npmCwd,
    launcher = fileURLToPath(import.meta.url),
  } = {},
) {
  let release = version;
  if (args[0] === "--cli-version") {
    if (version) throw new Error("The plugin manager selects this plugin's CLI version.");
    release = standaloneRelease(args[1]);
    args = args.slice(2);
  } else if (!version && env.HYPERFRAMES_STANDALONE_CLI_VERSION !== undefined) {
    release = standaloneRelease(env.HYPERFRAMES_STANDALONE_CLI_VERSION);
  }
  if (version && args[0] === "skills")
    throw new Error(
      "Bundled skills are release-managed; the person updates HyperFrames through their agent's plugin manager.",
    );
  const childEnv = version
    ? {
        ...env,
        HYPERFRAMES_SKIP_SKILLS: "1",
        HYPERFRAMES_SKILL_PKG_VERSION: version,
        HYPERFRAMES_PLUGIN_VERSION: version,
        HYPERFRAMES_NO_UPDATE_CHECK: "1",
      }
    : { ...env };
  if (args[0] === "--script") {
    if (!args[1]) throw new Error("--script requires a Node script path.");
    // Helpers that call the CLI run it through this launcher, never a `hyperframes` from the project.
    const env = { ...childEnv, HYPERFRAMES_CLI_ENTRY: launcher };
    if (!version && release) env.HYPERFRAMES_STANDALONE_CLI_VERSION = release;
    return { command: node, args: args.slice(1), env, cwd };
  }
  const cliArgs = ["--yes", release ? `hyperframes@${release}` : STANDALONE_CLI, ...args];
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
