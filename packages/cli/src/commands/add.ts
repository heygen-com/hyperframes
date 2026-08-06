import { failCommand } from "../utils/commandResult.js";
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

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { ITEM_TYPE_DIRS, type RegistryItem } from "@hyperframes/core";
import { c } from "../ui/colors.js";
import { installItem } from "../registry/installer.js";
import { resolveItemsByTag } from "../registry/resolver.js";
import {
  validateThreadMessageStackData,
  type ThreadMessageStackData,
} from "../registry/threadMessageStack.js";
import { resolveItemWithDependencies } from "../registry/resolver.js";
import {
  gateRegistryItemsCompatibility,
  RegistryCompatibilityError,
} from "../registry/compatibility.js";
import {
  DEFAULT_PROJECT_CONFIG,
  loadProjectConfig,
  projectConfigPath,
  type ProjectConfig,
  writeProjectConfig,
} from "../utils/projectConfig.js";
import { copyToClipboard } from "../utils/clipboard.js";
import { authorizeThreadMessageStackInstall } from "../registry/threadMessageStackAuthorization.js";
import { PrimitiveFunnel, type PrimitiveFunnelContext } from "../telemetry/primitive-funnel.js";
import { writePrimitiveFunnelContext } from "../telemetry/primitive-funnel-state.js";
import {
  THREAD_MESSAGE_STACK_ARTIFACT_ID,
  THREAD_MESSAGE_STACK_CATALOG_DIGEST,
  THREAD_MESSAGE_STACK_VERSION_ID,
} from "../registry/heygenverseCatalog.js";

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
  /** Caller-owned messages materialized only for thread-message-stack. */
  threadMessageStackData?: ThreadMessageStackData;
  /** Caller-owned catalog session; direct add creates one without search/selection side effects. */
  primitiveFunnelSession?: {
    context: PrimitiveFunnelContext;
    funnel: PrimitiveFunnel;
  };
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
      | "incompatible-cli"
      | "oauth-required",
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
  requestedName: string,
  threadMessageStackData?: ThreadMessageStackData,
): Promise<string[]> {
  const written: string[] = [];
  try {
    for (const planItem of installPlan) {
      const result = await installItem(planItem, {
        destDir,
        baseUrl,
        ...(planItem.name === requestedName && threadMessageStackData
          ? { threadMessageStackData }
          : {}),
      });
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

async function resolveRequestedItem(
  name: string,
  registry: string,
): Promise<{ resolved: RegistryItem[]; item: RegistryItem }> {
  let resolved: RegistryItem[];
  try {
    resolved = await resolveItemWithDependencies(name, { baseUrl: registry });
  } catch (err) {
    throw new AddError(err instanceof Error ? err.message : String(err), "unknown-item");
  }
  const item = resolved[resolved.length - 1]!;
  if (item.type === "hyperframes:example") {
    throw new AddError(
      `"${item.name}" is an example — use \`hyperframes init <dir> --example ${item.name}\` instead.`,
      "example-type",
    );
  }
  return { resolved, item };
}

async function resolveAndInstall(
  opts: RunAddArgs,
  projectDir: string,
  config: ProjectConfig,
): Promise<RunAddResult> {
  const { resolved, item } = await resolveRequestedItem(opts.name, config.registry);
  const warnings = assertCompatibleOrThrow(resolved, opts.cliVersion);
  const installPlan: RegistryItem[] = resolved.map((resolvedItem) => ({
    ...resolvedItem,
    files: resolvedItem.files.map((f) => ({
      ...f,
      target: remapTarget(resolvedItem, f.target, config.paths),
    })),
  }));
  const written = await installAll(
    installPlan,
    projectDir,
    config.registry,
    item.name,
    opts.threadMessageStackData,
  );

  const itemForInstall = installPlan[installPlan.length - 1]!;
  const primaryFile =
    itemForInstall.files.find((f) => f.type === "hyperframes:snippet") ??
    itemForInstall.files.find((f) => f.type === "hyperframes:composition") ??
    itemForInstall.files[0];
  const snippet = buildSnippet(item, primaryFile?.target ?? "");

  return {
    ok: true,
    name: item.name,
    type: item.type,
    typeDir: ITEM_TYPE_DIRS[item.type],
    written,
    installed: installPlan.map((planItem) => planItem.name),
    snippet,
    clipboardCopied: !opts.skipClipboard && snippet ? copyToClipboard(snippet) : false,
    warnings,
  };
}

export async function runAdd(opts: RunAddArgs): Promise<RunAddResult> {
  const projectDir = resolve(opts.projectDir);
  let primitiveSession = opts.primitiveFunnelSession;
  let installStartedAt = 0;

  // 1. Load (or write default) project config.
  let config = loadProjectConfig(projectDir);
  const hasConfig = existsSync(projectConfigPath(projectDir));
  if (!hasConfig && existsSync(resolve(projectDir, "index.html"))) {
    writeProjectConfig(projectDir, DEFAULT_PROJECT_CONFIG);
    config = DEFAULT_PROJECT_CONFIG;
  }

  // This source-owned primitive is not downloadable through generic registry
  // credentials. Gate its named command boundary before registry resolution so
  // an API key, cancellation, or failed OAuth cannot fetch even its manifest.
  if (opts.name === "thread-message-stack") {
    if (!primitiveSession) {
      const context: PrimitiveFunnelContext = {
        funnelId: randomUUID(),
        installId: randomUUID(),
        primitiveId: "thread-message-stack",
        artifactId: THREAD_MESSAGE_STACK_ARTIFACT_ID,
        versionId: THREAD_MESSAGE_STACK_VERSION_ID,
        catalogVersion: THREAD_MESSAGE_STACK_CATALOG_DIGEST,
        queryFingerprint: `sha256:${createHash("sha256").update("").digest("hex")}`,
      };
      primitiveSession = { context, funnel: new PrimitiveFunnel(context) };
    }
    const authStartedAt = performance.now();
    const authorization = await authorizeThreadMessageStackInstall({
      onAuthStarted: () => primitiveSession?.funnel.authStarted(),
      onVerified: (user, authState) =>
        primitiveSession?.funnel.authCompleted(
          user.email ?? user.username,
          authState,
          performance.now() - authStartedAt,
        ),
    });
    if (authorization !== "authorized") {
      primitiveSession.funnel.authFailed(
        `${primitiveSession.context.installId}:auth-failed`,
        authorization === "cancelled" ? "auth_cancelled" : "auth_failed",
        performance.now() - authStartedAt,
      );
      throw new AddError(
        `thread-message-stack requires verified HeyGen OAuth (${authorization}); no source was downloaded or materialized.`,
        "oauth-required",
      );
    }
    primitiveSession.funnel.installStarted();
    installStartedAt = performance.now();
  }

  try {
    const result = await resolveAndInstall(opts, projectDir, config);
    if (primitiveSession) {
      writePrimitiveFunnelContext(projectDir, primitiveSession.context);
      primitiveSession.funnel.installCompleted(
        `${primitiveSession.context.installId}:install-completed`,
        performance.now() - installStartedAt,
      );
    }
    return result;
  } catch (error) {
    primitiveSession?.funnel.installFailed(
      `${primitiveSession.context.installId}:install-failed`,
      error instanceof AddError && error.code === "install-failed"
        ? "install_failed"
        : "invalid_payload",
      performance.now() - installStartedAt,
    );
    throw error;
  }
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
    "messages-file": {
      type: "string",
      description:
        "JSON file with {messages, stagger?, hold?}; valid only for thread-message-stack",
    },
  },
  // Existing command UX handles item, tag, JSON, clipboard, and file-input modes in one boundary.
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const projectDir = resolve(args.dir ?? process.cwd());
    const json = args.json === true;
    const skipClipboard = args.clipboard === false;
    const hasConfigBefore = existsSync(projectConfigPath(projectDir));

    // Try single item first. If it fails, check if the name matches a tag.
    try {
      let threadMessageStackData: ThreadMessageStackData | undefined;
      if (args["messages-file"]) {
        if (args.name !== "thread-message-stack") {
          throw new AddError(
            "--messages-file is valid only for thread-message-stack.",
            "wrong-type",
          );
        }
        const raw = readFileSync(resolve(projectDir, args["messages-file"]), "utf8");
        threadMessageStackData = validateThreadMessageStackData(JSON.parse(raw));
      }
      const result = await runAdd({
        name: args.name,
        projectDir,
        skipClipboard,
        ...(threadMessageStackData ? { threadMessageStackData } : {}),
      });
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
        failCommand();
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
        failCommand();
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
