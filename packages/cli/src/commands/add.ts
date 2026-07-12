import { defineCommand } from "citty";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  ["Add a block to the current project", "hyperframes add claude-code-window"],
  ["Add a component effect", "hyperframes add shader-wipe"],
  ["Add all HTML-in-Canvas blocks", "hyperframes add html-in-canvas"],
  ["Add all caption blocks", "hyperframes add captions"],
  ["Target a specific project directory", "hyperframes add shader-wipe --dir ./my-video"],
  ["Skip the clipboard copy (CI/headless)", "hyperframes add shader-wipe --no-clipboard"],
];

import { existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { ITEM_TYPE_DIRS, type RegistryItem } from "@hyperframes/core";
import { c } from "../ui/colors.js";
import { installItem, resolveItemsByTag } from "../registry/index.js";
import { resolveItemWithDependencies } from "../registry/resolver.js";
import {
  gateRegistryItemsCompatibility,
  RegistryCompatibilityError,
} from "../registry/compatibility.js";
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
    const dims =
      "dimensions" in item && item.dimensions
        ? ` data-width="${item.dimensions.width}" data-height="${item.dimensions.height}"`
        : "";
    return `<div data-composition-src="${relativeTarget}" data-duration="${item.duration}"${dims}></div>`;
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
  /** Current CLI version used for registry metadata compatibility checks. */
  cliVersion?: string;
}

export interface RunAddResult {
  ok: true;
  name: string;
  type: RegistryItem["type"];
  typeDir: string;
  written: string[];
  /** Names of every item installed, in order — dependencies first, then `name`. */
  installed: string[];
  snippet: string;
  clipboardCopied: boolean;
  warnings: string[];
}

export class AddError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "unknown-item"
      | "wrong-type"
      | "install-failed"
      | "example-type"
      | "incompatible-cli",
  ) {
    super(message);
    this.name = "AddError";
  }
}

// Compatibility-gate a set of resolved items before any install runs, mapping
// the shared gate's error into an AddError so the command surfaces the right
// exit code. Returns the accumulated (non-fatal) warnings from every item.
function assertCompatibleOrThrow(items: RegistryItem[], cliVersion?: string): string[] {
  try {
    return gateRegistryItemsCompatibility(items, cliVersion);
  } catch (err) {
    if (err instanceof RegistryCompatibilityError) {
      throw new AddError(err.message, "incompatible-cli");
    }
    throw err;
  }
}

// Install a topologically-ordered plan (dependencies first, requested item
// last). The installer validates every target before any write; a failure on
// any item surfaces as an install-failed AddError. Returns all written paths.
async function installAll(
  installPlan: RegistryItem[],
  destDir: string,
  baseUrl: string | undefined,
): Promise<string[]> {
  const written: string[] = [];
  try {
    for (const planItem of installPlan) {
      const result = await installItem(planItem, { destDir, baseUrl });
      written.push(...result.written);
    }
  } catch (err) {
    throw new AddError(
      `Install failed: ${err instanceof Error ? err.message : String(err)}`,
      "install-failed",
    );
  }
  return written;
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

  // 2. Resolve the requested item and its transitive registryDependencies.
  //    The list comes back topologically sorted: dependencies first, the
  //    requested item last.
  let resolved: RegistryItem[];
  try {
    resolved = await resolveItemWithDependencies(opts.name, { baseUrl: config.registry });
  } catch (err) {
    throw new AddError(err instanceof Error ? err.message : String(err), "unknown-item");
  }
  // `resolveItemWithDependencies` always pushes the requested item last (or throws),
  // so the final element is the item the user asked for.
  const item = resolved[resolved.length - 1]!;

  if (item.type === "hyperframes:example") {
    throw new AddError(
      `"${item.name}" is an example — use \`hyperframes init <dir> --example ${item.name}\` instead.`,
      "example-type",
    );
  }

  // 3. Compatibility-gate every item we're about to install (dependencies
  //    included) before writing anything.
  const warnings = assertCompatibleOrThrow(resolved, opts.cliVersion);

  // 4. Remap targets per project config — each item by its own type.
  const installPlan: RegistryItem[] = resolved.map((resolvedItem) => ({
    ...resolvedItem,
    files: resolvedItem.files.map((f) => ({
      ...f,
      target: remapTarget(resolvedItem, f.target, config.paths),
    })),
  }));

  // 5. Install — dependencies first, requested item last.
  const written = await installAll(installPlan, projectDir, config.registry);

  // 6. Build include snippet + clipboard copy for the requested item.
  const itemForInstall = installPlan[installPlan.length - 1]!;
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
    installed: installPlan.map((planItem) => planItem.name),
    snippet,
    clipboardCopied,
    warnings,
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
      description:
        "Registry item name or tag. Single items install directly (e.g. shader-wipe). " +
        "If the name matches a tag instead, all blocks with that tag are installed (e.g. html-in-canvas, captions).",
      required: true,
    },
    dir: {
      type: "string",
      description: "Project directory (defaults to the current working directory)",
    },
    clipboard: {
      // Declared as the positive `clipboard` (default on) so citty's built-in
      // `--no-<name>` negation handles `--no-clipboard`. Declaring the arg
      // literally as `"no-clipboard"` made citty parse `--no-clipboard` as the
      // negation of a (nonexistent) `clipboard` arg, so assertKnownFlags threw
      // "Unknown flag: --clipboard" even though --help advertised it.
      type: "boolean",
      default: true,
      description: "Copy the include snippet to the clipboard (use --no-clipboard to skip)",
    },
    json: {
      type: "boolean",
      description: "Print a machine-readable summary (written files + snippet) to stdout",
    },
  },
  async run({ args }) {
    const projectDir = resolve(args.dir ?? process.cwd());
    const json = args.json === true;
    const skipClipboard = args.clipboard === false;
    const hasConfigBefore = existsSync(projectConfigPath(projectDir));

    // Try single item first. If it fails, check if the name matches a tag.
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
      for (const warning of result.warnings) {
        console.warn(c.warn(`Warning: ${warning}`));
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
    } catch (singleErr) {
      // Not a single item — try as a tag for bulk install
      if (!(singleErr instanceof AddError) || singleErr.code !== "unknown-item") {
        const msg = singleErr instanceof Error ? singleErr.message : String(singleErr);
        if (json) console.log(JSON.stringify({ ok: false, error: msg }));
        else console.error(c.error(msg));
        process.exit(1);
      }

      let config = loadProjectConfig(projectDir);
      if (
        !existsSync(projectConfigPath(projectDir)) &&
        existsSync(resolve(projectDir, "index.html"))
      ) {
        writeProjectConfig(projectDir, DEFAULT_PROJECT_CONFIG);
        config = DEFAULT_PROJECT_CONFIG;
      }

      let items: Awaited<ReturnType<typeof resolveItemsByTag>>;
      try {
        items = await resolveItemsByTag(args.name, { baseUrl: config.registry, skipCache: true });
      } catch {
        items = [];
      }

      if (items.length === 0) {
        const msg = singleErr instanceof Error ? singleErr.message : String(singleErr);
        if (json) console.log(JSON.stringify({ ok: false, error: msg }));
        else console.error(c.error(msg));
        process.exit(1);
      }

      if (!json) {
        console.log("");
        console.log(
          `${c.accent("◆")} Installing ${c.accent(String(items.length))} blocks tagged ${c.accent(args.name)}`,
        );
      }

      const results: RunAddResult[] = [];
      for (const item of items) {
        try {
          const result = await runAdd({ name: item.name, projectDir, skipClipboard: true });
          results.push(result);
          for (const warning of result.warnings) {
            if (!json) console.log(`  ${c.warn("Warning:")} ${warning}`);
          }
          if (!json) console.log(`  ${c.success("✓")} ${result.name}`);
        } catch {
          if (!json) console.log(`  ${c.error("✗")} ${item.name} (skipped)`);
        }
      }

      if (json) {
        console.log(
          JSON.stringify({ ok: true, tag: args.name, installed: results.map((r) => r.name) }),
        );
      } else {
        console.log("");
        console.log(`${c.success("✓")} Installed ${results.length}/${items.length} blocks`);
      }
    }
  },
});
