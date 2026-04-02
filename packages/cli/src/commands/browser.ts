import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Find or download Chrome for rendering", "hyperframes browser ensure"],
  ["Print the Chrome executable path", "hyperframes browser path"],
  ["Remove cached Chrome download", "hyperframes browser clear"],
];
import { formatBytes } from "../ui/format.js";
import {
  ensureBrowser,
  findBrowser,
  clearBrowser,
  CHROME_VERSION,
  CACHE_DIR,
} from "../browser/manager.js";
import { trackBrowserInstall } from "../telemetry/events.js";

async function runEnsure(): Promise<void> {
  clack.intro(c.bold("hyperframes browser ensure"));

  const s = clack.spinner();
  s.start("Looking for an existing browser...");

  const existing = await findBrowser();
  if (existing) {
    s.stop(c.success("Browser found"));
    console.log();
    console.log(`   ${c.dim("Source:")}  ${c.bold(existing.source)}`);
    console.log(`   ${c.dim("Path:")}    ${c.bold(existing.executablePath)}`);
    console.log();
    clack.outro(c.success("Ready to render."));
    return;
  }

  s.stop("No browser found — downloading");

  const downloadSpinner = clack.spinner();
  downloadSpinner.start(`Downloading Chrome Headless Shell ${c.dim("v" + CHROME_VERSION)}...`);

  let lastPct = -1;
  const result = await ensureBrowser({
    onProgress: (downloaded, total) => {
      if (total <= 0) return;
      const pct = Math.floor((downloaded / total) * 100);
      if (pct > lastPct) {
        lastPct = pct;
        downloadSpinner.message(
          `Downloading Chrome Headless Shell ${c.dim("v" + CHROME_VERSION)} — ${c.progress(pct + "%")} ${c.dim("(" + formatBytes(downloaded) + " / " + formatBytes(total) + ")")}`,
        );
      }
    },
  });

  downloadSpinner.stop(c.success("Download complete"));
  trackBrowserInstall();

  console.log();
  console.log(`   ${c.dim("Source:")}  ${c.bold(result.source)}`);
  console.log(`   ${c.dim("Path:")}    ${c.bold(result.executablePath)}`);
  console.log();

  clack.outro(c.success("Ready to render."));
}

async function runPath(): Promise<void> {
  const result = await findBrowser();
  if (!result) {
    // Try a full ensure (which includes download) but write only the path
    try {
      const ensured = await ensureBrowser();
      process.stdout.write(ensured.executablePath + "\n");
    } catch (err: unknown) {
      console.error(err instanceof Error ? err.message : "Failed to find browser");
      process.exit(1);
    }
    return;
  }
  process.stdout.write(result.executablePath + "\n");
}

function runClear(): void {
  clack.intro(c.bold("hyperframes browser clear"));

  const removed = clearBrowser();
  if (removed) {
    clack.outro(c.success("Removed cached browser from ") + c.dim(CACHE_DIR));
  } else {
    clack.outro(c.dim("No cached browser to remove."));
  }
}

export default defineCommand({
  meta: { name: "browser", description: "Manage the Chrome browser used for rendering" },
  args: {
    subcommand: {
      type: "positional",
      description:
        "ensure = find or download Chrome, path = print executable path, clear = remove cached download",
      required: false,
    },
  },
  async run({ args }) {
    const subcommand = args.subcommand;

    if (!subcommand || subcommand === "") {
      console.log(`
${c.bold("hyperframes browser")} ${c.dim("<subcommand>")}

Manage the Chrome browser used for rendering.

${c.bold("SUBCOMMANDS:")}
  ${c.accent("ensure")}   ${c.dim("Find or download Chrome for rendering")}
  ${c.accent("path")}     ${c.dim("Print browser executable path (for scripting)")}
  ${c.accent("clear")}    ${c.dim("Remove cached Chrome download")}

${c.bold("EXAMPLES:")}
  ${c.accent("npx hyperframes browser ensure")}   ${c.dim("Download Chrome if needed")}
  ${c.accent("npx hyperframes browser path")}     ${c.dim("Print path for scripts")}
  ${c.accent("npx hyperframes browser clear")}    ${c.dim("Remove cached browser")}
`);
      return;
    }

    switch (subcommand) {
      case "ensure":
        return runEnsure();
      case "path":
        return runPath();
      case "clear":
        return runClear();
      default:
        console.error(
          `${c.error("Unknown subcommand:")} ${subcommand}\n\nRun ${c.accent("hyperframes browser --help")} for usage.`,
        );
        process.exit(1);
    }
  },
});
