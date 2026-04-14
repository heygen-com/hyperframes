import { defineCommand } from "citty";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  ["Add a block to the current project", "hyperframes add claude-code-window"],
  ["Add a component effect", "hyperframes add shader-wipe"],
  ["Target a specific project directory", "hyperframes add shader-wipe --dir ./my-video"],
  ["Skip the clipboard copy (CI/headless)", "hyperframes add shader-wipe --no-clipboard"],
];

import { existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { ITEM_TYPE_DIRS, type RegistryItem } from "@hyperframes/core";
import { c } from "../ui/colors.js";
import { installItem, resolveItem } from "../registry/index.js";
import {
  DEFAULT_PROJECT_CONFIG,
  loadProjectConfig,
  projectConfigPath,
  writeProjectConfig,
} from "../utils/projectConfig.js";
import { copyToClipboard } from "../utils/clipboard.js";

// ── Target-path resolution ──────────────────────────────────────────────────
// `registry-item.json` files specify `target` paths relative to the project
// root. For blocks and components we override the default path with the
// user's `hyperframes.json#paths` so a project can reshape its layout
// without editing every item's manifest.

export function remapTarget(
  item: RegistryItem,
  originalTarget: string,
  paths: { blocks: string; components: string },
): string {
  if (item.type === "hyperframes:block") {
    // Anchored to the default target prefix from DEFAULT_PROJECT_CONFIG.paths.blocks.
    // Targets that don't start with "compositions/" pass through unchanged.
    // Strip trailing slashes to prevent double-slash in output.
    const blocksDir = paths.blocks.replace(/\/+$/, "");
    return originalTarget.replace(/^compositions\//, `${blocksDir}/`);
  }
  if (item.type === "hyperframes:component") {
    // Anchored to the default target prefix from DEFAULT_PROJECT_CONFIG.paths.components.
    const componentsDir = paths.components.replace(/\/+$/, "");
    return originalTarget.replace(/^compositions\/components\//, `${componentsDir}/`);
  }
  // Examples are installed by `init`, not `add` — no remapping.
  return originalTarget;
}

// ── Include-snippet builders ────────────────────────────────────────────────
// Shown to the user after install so they know how to wire the item into
// their host composition. Copied to clipboard by default.

export function buildSnippet(item: RegistryItem, relativeTarget: string): string {
  if (item.type === "hyperframes:block") {
    // data-start omitted — adjust to your timeline position after pasting.
    return `<iframe src="${relativeTarget}" data-duration="${item.duration}"></iframe>`;
  }
  if (item.type === "hyperframes:component") {
    return `<!-- paste from ${relativeTarget} into your composition -->`;
  }
  return "";
}

// ── Core runner (tested) ────────────────────────────────────────────────────

export interface RunAddArgs {
  name: string;
  projectDir: string;
  skipClipboard?: boolean;
}

export interface RunAddResult {
  ok: true;
  name: string;
  type: RegistryItem["type"];
  typeDir: string;
  written: string[];
  snippet: string;
  clipboardCopied: boolean;
}

export class AddError extends Error {
  constructor(
    message: string,
    public readonly code: "unknown-item" | "wrong-type" | "install-failed" | "example-type",
  ) {
    super(message);
    this.name = "AddError";
  }
}

export async function runAdd(opts: RunAddArgs): Promise<RunAddResult> {
  const projectDir = resolve(opts.projectDir);

  // 1. Load (or write default) project config.
  let config = loadProjectConfig(projectDir);
  const hasConfig = existsSync(projectConfigPath(projectDir));
  if (!hasConfig && existsSync(resolve(projectDir, "index.html"))) {
    writeProjectConfig(projectDir, DEFAULT_PROJECT_CONFIG);
    config = DEFAULT_PROJECT_CONFIG;
  }

  // 2. Resolve the item from the registry.
  let item: RegistryItem;
  try {
    item = await resolveItem(opts.name, { baseUrl: config.registry });
  } catch (err) {
    throw new AddError(err instanceof Error ? err.message : String(err), "unknown-item");
  }

  if (item.type === "hyperframes:example") {
    throw new AddError(
      `"${item.name}" is an example — use \`hyperframes init <dir> --example ${item.name}\` instead.`,
      "example-type",
    );
  }

  // 3. Remap targets per project config.
  const remappedFiles = item.files.map((f) => ({
    ...f,
    target: remapTarget(item, f.target, config.paths),
  }));
  const itemForInstall: RegistryItem = { ...item, files: remappedFiles };

  // 4. Install — the installer validates every target before any write.
  let written: string[];
  try {
    const result = await installItem(itemForInstall, {
      destDir: projectDir,
      baseUrl: config.registry,
    });
    written = result.written;
  } catch (err) {
    throw new AddError(
      `Install failed: ${err instanceof Error ? err.message : String(err)}`,
      "install-failed",
    );
  }

  // 5. Build include snippet + clipboard copy.
  const primaryFile =
    itemForInstall.files.find((f) => f.type === "hyperframes:snippet") ??
    itemForInstall.files.find((f) => f.type === "hyperframes:composition") ??
    itemForInstall.files[0];
  const snippetTargetRel = primaryFile?.target ?? "";
  const snippet = buildSnippet(item, snippetTargetRel);
  const clipboardCopied = !opts.skipClipboard && snippet ? copyToClipboard(snippet) : false;

  return {
    ok: true,
    name: item.name,
    type: item.type,
    typeDir: ITEM_TYPE_DIRS[item.type],
    written,
    snippet,
    clipboardCopied,
  };
}

// ── Command ─────────────────────────────────────────────────────────────────

export default defineCommand({
  meta: {
    name: "add",
    description: "Install a block or component from the registry into this project",
  },
  args: {
    name: {
      type: "positional",
      description: "Registry item name (e.g. claude-code-window, shader-wipe)",
      required: true,
    },
    dir: {
      type: "string",
      description: "Project directory (defaults to the current working directory)",
    },
    "no-clipboard": {
      type: "boolean",
      description: "Skip copying the include snippet to the clipboard",
    },
    json: {
      type: "boolean",
      description: "Print a machine-readable summary (written files + snippet) to stdout",
    },
  },
  async run({ args }) {
    const projectDir = resolve(args.dir ?? process.cwd());
    const json = args.json === true;
    const skipClipboard = args["no-clipboard"] === true;
    const hasConfigBefore = existsSync(projectConfigPath(projectDir));

    try {
      const result = await runAdd({ name: args.name, projectDir, skipClipboard });
      const wroteConfig = !hasConfigBefore && existsSync(projectConfigPath(projectDir));

      if (json) {
        console.log(JSON.stringify(result));
        return;
      }

      if (wroteConfig) {
        console.log(c.dim(`Wrote default ${projectConfigPath(projectDir)}`));
      }
      console.log("");
      console.log(`${c.success("✓")} Added ${c.accent(result.name)} (${result.type})`);
      for (const file of result.written) {
        console.log(`  ${c.dim(relative(projectDir, file))}`);
      }
      if (result.snippet) {
        console.log("");
        console.log(c.dim("Include snippet:"));
        console.log(`  ${result.snippet}`);
        console.log("");
        console.log(
          result.clipboardCopied
            ? c.dim("Copied to clipboard — paste into your host composition.")
            : c.dim("Paste the snippet above into your host composition."),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        console.error(c.error(msg));
      }
      process.exit(1);
    }
  },
});
