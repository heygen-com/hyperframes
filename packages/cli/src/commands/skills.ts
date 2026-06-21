import { defineCommand } from "citty";
import { execFileSync, spawn } from "node:child_process";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { buildNpxCommand } from "../utils/npxCommand.js";

function hasNpx(): boolean {
  const npx = buildNpxCommand(["--version"]);
  try {
    execFileSync(npx.command, npx.args, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function runSkillsAdd(repo: string): Promise<void> {
  const npx = buildNpxCommand(["skills", "add", repo, "--all"]);
  return new Promise((resolve, reject) => {
    const child = spawn(npx.command, npx.args, {
      stdio: "inherit",
      timeout: 120_000,
      // GH #316 — the upstream `skills` CLI shells out to `git clone`.
      // When Git's clone-hook protection is active (shipped on by
      // default in 2.45.1, reverted in 2.45.2, still present on many
      // corporate and CI setups), any globally-registered
      // `git lfs install` post-checkout hook aborts the clone. The
      // `repo` reaching this function is hardcoded in SOURCES below
      // — no user input reaches the spawn — so opting out here is safe.
      env: { ...process.env, GIT_CLONE_PROTECTION_ACTIVE: "0" },
    });
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else if (signal === "SIGINT" || code === 130) process.exit(0);
      else reject(new Error(`npx skills add exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

const SOURCES = [{ name: "HyperFrames", repo: "heygen-com/hyperframes" }];

export default defineCommand({
  meta: {
    name: "skills",
    description: "Install HyperFrames skills for AI coding tools",
  },
  args: {},
  async run() {
    if (!hasNpx()) {
      clack.log.error(c.error("npx not found. Install Node.js and retry."));
      return;
    }

    for (const source of SOURCES) {
      console.log();
      console.log(c.bold(`Installing ${source.name} skills...`));
      console.log();
      try {
        await runSkillsAdd(source.repo);
      } catch {
        console.log(c.dim(`${source.name} skills skipped`));
      }
    }
  },
});
