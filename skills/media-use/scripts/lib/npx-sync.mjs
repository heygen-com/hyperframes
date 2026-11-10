import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

function resolveNpxCliPath(env, pathExists) {
  const npmExecPath = env.npm_execpath;
  const nodeExecPath = env.npm_node_execpath || process.execPath;
  if (npmExecPath) {
    const fileName = npmExecPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase();
    const candidate =
      fileName === "npx-cli.js" ? npmExecPath : join(dirname(npmExecPath), "npx-cli.js");
    if (pathExists(candidate)) return candidate;
  }
  const besideNode = join(dirname(nodeExecPath), "node_modules", "npm", "bin", "npx-cli.js");
  return pathExists(besideNode) ? besideNode : null;
}

// Sync-spawn analog of the audio engine's spawnP, for execFileSync call sites
// that must hard-fail (rather than fall through to another provider) when npx
// cannot be resolved. On Windows a bare "npx" is npx.cmd, which
// execFileSync/spawnSync cannot exec (spawnSync npx ENOENT) —
// resolveSpawnCommand reroutes it through node + npx-cli.js, no shell:true.
//
// `platform`/`env`/`pathExists` params (defaulting to the real values) exist
// so tests can exercise the win32 branch without mocking node:child_process
// (its ESM exports are non-configurable) — same idiom as spawnP and
// localTtsGenerate.
// A HyperFrames CLI that launches this code hands over its own entry file, so `npx hyperframes`
// runs that same build with the same Node instead of whatever npx resolves from the project.
function launchingCliInvocation(argv, opts, env) {
  const entry = env.HYPERFRAMES_CLI_ENTRY;
  if (argv[0] !== "hyperframes" || !entry || !isAbsolute(entry)) return null;
  return {
    cmd: process.execPath,
    args: [entry, ...argv.slice(1).map((arg) => String(arg))],
    opts: { stdio: "ignore", windowsHide: true, ...opts },
  };
}

export function resolveNpxInvocation(
  argv,
  opts,
  platform = process.platform,
  env = process.env,
  pathExists = existsSync,
) {
  const resolved =
    launchingCliInvocation(argv, opts, env) ??
    (platform !== "win32"
      ? { cmd: "npx", args: argv, opts: { stdio: "ignore", ...opts } }
      : (() => {
          const nodeExecPath = env.npm_node_execpath || process.execPath;
          const npxCliPath = resolveNpxCliPath(env, pathExists);
          return npxCliPath
            ? {
                cmd: nodeExecPath,
                args: [npxCliPath, ...argv.map((arg) => String(arg))],
                opts: { stdio: "ignore", windowsHide: true, ...opts },
              }
            : null;
        })());
  if (!resolved) {
    // npx-on-win32 with no resolvable npx-cli.js — same terminal condition
    // spawnP warns about, surfaced as a throw for callers with no fallback.
    throw new Error(
      "cannot run npx on Windows: npm's npx-cli.js was not found " +
        "(install npm with Node, or run via npx/npm run so npm_execpath is set)",
    );
  }
  return resolved;
}
