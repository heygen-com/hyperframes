import { existsSync } from "node:fs";
import { resolveSpawnCommand } from "../../audio/scripts/lib/tts.mjs";

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
export function resolveNpxInvocation(
  argv,
  opts,
  platform = process.platform,
  env = process.env,
  pathExists = existsSync,
) {
  const resolved = resolveSpawnCommand("npx", argv, opts, platform, env, pathExists);
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
