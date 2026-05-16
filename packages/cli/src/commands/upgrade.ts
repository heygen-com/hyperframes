import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import * as clack from "@clack/prompts";
import { execFileSync } from "node:child_process";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Check for updates interactively", "hyperframes upgrade"],
  ["Check for updates without prompting", "hyperframes upgrade --check"],
  ["Upgrade non-interactively", "hyperframes upgrade --yes"],
];
import { VERSION } from "../version.js";
import { checkForUpdate, withMeta } from "../utils/updateCheck.js";

export default defineCommand({
  meta: { name: "upgrade", description: "Check for updates and show upgrade instructions" },
  args: {
    yes: { type: "boolean", alias: "y", description: "Show upgrade commands without prompting" },
    check: { type: "boolean", description: "Check for updates and exit (no prompt)" },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const useJson = args.json === true;
    const checkOnly = args.check === true;

    // JSON mode: always force-check and output structured data
    if (useJson) {
      const result = await checkForUpdate(true);
      console.log(JSON.stringify(withMeta(result), null, 2));
      return;
    }

    const autoYes = args.yes === true;
    clack.intro(c.bold("hyperframes upgrade"));

    const s = clack.spinner();
    s.start("Checking for updates...");

    const result = await checkForUpdate(true);

    if (result.latest === result.current) {
      s.stop(c.success("Already up to date"));
      clack.outro(`${c.success("\u25C7")}  ${c.bold("v" + VERSION)}`);
      return;
    }

    s.stop("Update available");

    console.log();
    console.log(`   ${c.dim("Current:")}  ${c.bold("v" + result.current)}`);
    console.log(`   ${c.dim("Latest:")}   ${c.bold(c.accent("v" + result.latest))}`);
    console.log();

    if (checkOnly) {
      clack.outro(c.accent("Update available: v" + result.latest));
      return;
    }

    if (!autoYes) {
      const shouldUpgrade = await clack.confirm({
        message: "Upgrade now?",
      });

      if (clack.isCancel(shouldUpgrade) || !shouldUpgrade) {
        clack.outro(c.dim("Skipped."));
        return;
      }
    }

    // Reject anything that isn't a strict semver-shaped string before it reaches
    // the install command. A poisoned npm registry response could otherwise put
    // shell metacharacters into `result.latest`; rejecting up front means the
    // version flows through execFile (and the displayed command) as an opaque
    // token, not something the shell might re-parse.
    const SAFE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
    if (!SAFE_VERSION.test(result.latest)) {
      clack.outro(c.dim("Refusing to install: unexpected version string from npm registry."));
      process.exitCode = 1;
      return;
    }

    const installArgs = ["install", "-g", `hyperframes@${result.latest}`];
    const installCmd = `npm ${installArgs.join(" ")}`;
    if (autoYes) {
      console.log();
      console.log(`   ${c.dim("Running:")} ${c.accent(installCmd)}`);
      console.log();
      try {
        // execFileSync with shell:false — the version is now provably safe per
        // SAFE_VERSION above, but keep the no-shell call so future edits can't
        // regress the shell-injection surface area.
        execFileSync("npm", installArgs, { stdio: "inherit", shell: false });
        clack.outro(c.success(`Upgraded to v${result.latest}`));
      } catch {
        clack.outro(c.dim("Install failed. Try running manually:"));
        console.log(`   ${c.accent(installCmd)}`);
        process.exitCode = 1;
      }
    } else {
      console.log();
      console.log(`   ${c.accent(installCmd)}`);
      console.log(`   ${c.dim("or")}`);
      console.log(`   ${c.accent("npx hyperframes@" + result.latest + " --version")}`);
      console.log();
      clack.outro(c.success("Run one of the commands above to upgrade."));
    }
  },
});
