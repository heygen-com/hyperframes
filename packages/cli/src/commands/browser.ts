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
  CHROME_VERSION,
  CACHE_DIR,
  isLinuxArm,
} from "../browser/manager.js";
import { trackBrowserInstall, trackCommandFailure } from "../telemetry/events.js";

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
      console.log();
      console.log(`   ${c.dim("Source:")}  ${c.bold(existing.source)}`);
      console.log(`   ${c.dim("Path:")}    ${c.bold(existing.executablePath)}`);
      console.log();
      clack.outro(c.success("Ready to render."));
      return;
    }

    s.stop(c.warn("No Chromium found — attempting auto-install via apt-get..."));
    console.log();

    // Delegate to ensureBrowser which handles the full ARM64 install flow.
    try {
      const result = await ensureBrowser();
      console.log();
      console.log(`   ${c.dim("Source:")}  ${c.bold(result.source)}`);
      console.log(`   ${c.dim("Path:")}    ${c.bold(result.executablePath)}`);
      console.log();
      clack.outro(c.success("Chromium ready. You can now render on ARM64."));
    } catch (err) {
      // The ARM64 auto-install failed: the browser is NOT ready, so this is a
      // real failure (exit 1), not a success. Report it and stop swallowing.
      trackCommandFailure("browser", err);
      clack.log.error(err instanceof Error ? err.message : String(err));
      clack.outro(c.warn("Manual setup required (see instructions above)."));
      failCommand();
    }
    return;
  }

  const s = clack.spinner();
  if (!options?.force) {
    // Resolve with `preferManagedChrome` so this reports what `render`
    // actually uses — a system Chrome without our pinned HF cache still
    // downloads on the next render, so it shouldn't be reported as "found".
    s.start("Looking for an existing browser...");

    let lastPct = -1;
    const existing = await ensureBrowser({
      preferManagedChrome: true,
      onProgress: (downloaded, total) => {
        if (total <= 0) return;
        const pct = Math.floor((downloaded / total) * 100);
        if (pct > lastPct) {
          lastPct = pct;
          s.message(
            `Downloading Chrome Headless Shell ${c.dim("v" + CHROME_VERSION)} — ${c.progress(pct + "%")} ${c.dim("(" + formatBytes(downloaded) + " / " + formatBytes(total) + ")")}`,
          );
        }
      },
    });

    if (existing.source === "download") trackBrowserInstall();
    s.stop(c.success(existing.source === "download" ? "Download complete" : "Browser found"));
    console.log();
    console.log(`   ${c.dim("Source:")}  ${c.bold(existing.source)}`);
    console.log(`   ${c.dim("Path:")}    ${c.bold(existing.executablePath)}`);
    console.log();
    clack.outro(c.success("Ready to render."));
    return;
  }

  s.start("Purging cached download and re-downloading...");

  const downloadSpinner = clack.spinner();
  downloadSpinner.start(`Downloading Chrome Headless Shell ${c.dim("v" + CHROME_VERSION)}...`);

  let lastPct = -1;
  const result = await ensureBrowser({
    force: options?.force,
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
      trackCommandFailure("browser", err);
      console.error(err instanceof Error ? err.message : "Failed to find browser");
      failCommand();
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
        trackCommandFailure("browser", `Unknown subcommand: ${subcommand}`);
        console.error(
          `${c.error("Unknown subcommand:")} ${subcommand}\n\nRun ${c.accent("hyperframes browser --help")} for usage.`,
        );
        failCommand();
    }
  },
});
