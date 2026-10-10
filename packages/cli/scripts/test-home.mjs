// Loaded before any CLI test module: the cache, config and state paths the CLI builds from the home
// folder, or from these variables, land in a temp dir removed on exit, never in the user's own.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "hf-test-home-"));
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
process.env.HOME = process.env.USERPROFILE = home;
// bun keeps its transpiler cache under HOME, so each run would rewrite it cold from every spawned CLI; on a
// congested Windows system disk that write burst held CLI spawns past their timeout. Transpile in memory.
process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = "0";
for (const name of [
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "XDG_DATA_HOME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "HEYGEN_CONFIG_DIR",
  "HYPERFRAMES_CATALOG_ARTIFACT_DIR",
  "HYPERFRAMES_MEDIA_HOME",
  "HF_HOME",
  "HUGGINGFACE_HUB_CACHE",
]) {
  delete process.env[name];
}
