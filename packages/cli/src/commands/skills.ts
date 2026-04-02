import { defineCommand } from "citty";
import { execFileSync, spawn } from "node:child_process";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";

function hasNpx(): boolean {
  try {
    execFileSync("npx", ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function runSkillsAdd(repo: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["skills", "add", repo, "--all", "-g"], {
      stdio: "ignore",
      timeout: 120_000,
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npx skills add exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

const SOURCES = [
  { name: "HyperFrames", repo: "heygen-com/hyperframes" },
  { name: "GSAP", repo: "greensock/gsap-skills" },
];

export default defineCommand({
  meta: {
    name: "skills",
    description: "Install HyperFrames and GSAP skills for AI coding tools",
  },
  args: {},
  async run() {
    clack.intro(c.bold("hyperframes skills"));

    if (!hasNpx()) {
      clack.log.error(c.error("npx not found. Install Node.js and retry."));
      clack.outro(c.warn("No skills installed."));
      return;
    }

    const installed: string[] = [];
    const skipped: string[] = [];

    for (const source of SOURCES) {
      const spinner = clack.spinner();
      spinner.start(`Installing ${source.name} skills...`);
      try {
        await runSkillsAdd(source.repo);
        installed.push(source.name);
        spinner.stop(c.success(`${source.name} skills installed`));
      } catch {
        skipped.push(source.name);
        spinner.stop(c.dim(`${source.name} skills skipped (unavailable)`));
      }
    }

    if (skipped.length > 0) {
      console.log(`   ${c.dim("Skipped:")}  ${skipped.join(", ")}`);
      console.log();
    }

    if (installed.length > 0) {
      clack.outro(c.success(`${installed.join(" + ")} skills installed.`));
    } else {
      clack.outro(c.warn("No skills installed."));
    }
  },
});
