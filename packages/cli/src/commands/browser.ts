import { failCommand } from "../utils/commandResult.js";
import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Find or download Chrome for rendering", "hyperframes browser ensure"],
  ["Purge a stale/partial download and re-download", "hyperframes browser ensure --force"],
  ["Print the Chrome executable path", "hyperframes browser path"],
  ["Remove cached Chrome download", "hyperframes browser clear"],
];
import { formatBytes } from "../ui/format.js";
import {
  ensureBrowser,
  findBrowser,
  clearBrowser,
  managedChromeVersion,
  CACHE_DIR,
  isLinuxArm,
  type BrowserResult,
} from "../browser/manager.js";
import { trackBrowserInstall } from "../telemetry/events.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";

function printBrowser(browser: BrowserResult): void {
  console.log();
  console.log(`   ${c.dim("Source:")}  ${c.bold(browser.source)}`);
  console.log(`   ${c.dim("Path:")}    ${c.bold(browser.executablePath)}`);
  console.log();
}

async function runEnsure(options?: { force?: boolean }): Promise<void> {
  clack.intro(c.bold("hyperframes browser ensure"));

  // ARM64 Linux: Chrome headless shell is not available (apt-get/system-only
  // install flow, no download cache to force a purge of) — --force is a no-op here.
  if (isLinuxArm()) {
    const s = clack.spinner();
    s.start("Linux ARM64 detected — looking for system Chromium...");
    const existing = await findBrowser();
    if (existing) {
      s.stop(c.success("System Chromium found"));
      printBrowser(existing);
      clack.outro(c.success("Ready to render."));
      return;
    }

    s.stop(c.warn("No Chromium found — attempting auto-install via apt-get..."));
    console.log();

    // Delegate to ensureBrowser which handles the full ARM64 install flow.
    try {
      const result = await ensureBrowser();
      printBrowser(result);
      clack.outro(c.success("Chromium ready. You can now render on ARM64."));
    } catch (err) {
      // The ARM64 auto-install failed: the browser is NOT ready, so this is a
      // real failure (exit 1), not a success. Report it and stop swallowing.
      clack.log.error(err instanceof Error ? err.message : String(err));
      clack.outro(c.warn("Manual setup required (see instructions above)."));
      failCommand(1, err);
    }
    return;
  }

  // Every exit path stops the spinner: a running one keeps the process alive after a failure.
  const downloading = `Downloading Chrome Headless Shell ${c.dim("v" + managedChromeVersion())}`;
  const s = clack.spinner();
  s.start(options?.force ? `${downloading}...` : "Looking for an existing browser...");
  let lastPct = -1;
  let result: BrowserResult;
  try {
    // `preferManagedChrome` reports what `render` actually uses: a system Chrome
    // without our pinned build still downloads on the next render.
    result = await ensureBrowser({
      force: options?.force,
      preferManagedChrome: true,
      onProgress: (downloaded, total) => {
        if (total <= 0) return;
        const pct = Math.floor((downloaded / total) * 100);
        if (pct > lastPct) {
          lastPct = pct;
          s.message(
            `${downloading} — ${c.progress(pct + "%")} ${c.dim("(" + formatBytes(downloaded) + " / " + formatBytes(total) + ")")}`,
          );
        }
      },
    });
  } catch (err) {
    s.stop(c.error("Browser not available"));
    clack.log.error(normalizeErrorMessage(err));
    failCommand(1, err);
  }

  if (result.source === "download") trackBrowserInstall();
  s.stop(c.success(result.source === "download" ? "Download complete" : "Browser found"));
  printBrowser(result);
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
      failCommand(1, err);
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
    force: {
      type: "boolean",
      description:
        "ensure only: purge any cached download (including a stale/partial one) and re-download from scratch",
      default: false,
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
  ${c.accent("npx hyperframes browser ensure")}           ${c.dim("Download Chrome if needed")}
  ${c.accent("npx hyperframes browser ensure --force")}   ${c.dim("Purge a stale/partial download and re-download")}
  ${c.accent("npx hyperframes browser path")}             ${c.dim("Print path for scripts")}
  ${c.accent("npx hyperframes browser clear")}            ${c.dim("Remove cached browser")}
`);
      return;
    }

    switch (subcommand) {
      case "ensure":
        return runEnsure({ force: args.force });
      case "path":
        return runPath();
      case "clear":
        return runClear();
      default:
        console.error(
          `${c.error("Unknown subcommand:")} ${subcommand}\n\nRun ${c.accent("hyperframes browser --help")} for usage.`,
        );
        failCommand(1, `Unknown subcommand: ${subcommand}`);
    }
  },
});
