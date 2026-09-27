// Loaded before any CLI test module: the cache, config and state paths the CLI builds from the home
// folder, or from these variables, land in a temp dir removed on exit, never in the user's own.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "hf-test-home-"));
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
process.env.HOME = process.env.USERPROFILE = home;
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
