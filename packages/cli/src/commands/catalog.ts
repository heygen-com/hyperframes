import { failCommand, finishCommand } from "../utils/commandResult.js";
import { defineCommand } from "citty";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  ["List all blocks and components", "hyperframes catalog"],
  ["List blocks only", "hyperframes catalog --type block"],
  ["Filter by tag", "hyperframes catalog --type block --tag social"],
  ["Machine-readable JSON", "hyperframes catalog --json"],
  ["Interactive picker (install on select)", "hyperframes catalog --human-friendly"],
];

import * as clack from "@clack/prompts";
import { type ItemType } from "@hyperframes/core";
import { c } from "../ui/colors.js";
import { listRegistryItems, loadAllItems } from "../registry/resolver.js";
import { loadProjectConfig, DEFAULT_PROJECT_CONFIG } from "../utils/projectConfig.js";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runAdd } from "./add.js";
import {
  createFilePrimitiveInstallStateStore,
  createPrimitiveInstallIntent,
  filterPrimitiveCatalogItems,
  resumePrimitiveInstallExactlyOnce,
} from "./catalog-resume.js";
import {
  AuthClient,
  startAuthorizationCodeFlow,
  tryResolveOAuthCredential,
} from "../auth/index.js";
import { PrimitiveFunnel } from "../telemetry/primitive-funnel.js";
import { writePrimitiveFunnelContext } from "../telemetry/primitive-funnel-state.js";
import {
  THREAD_MESSAGE_STACK_ARTIFACT_ID,
  THREAD_MESSAGE_STACK_CATALOG_DIGEST,
  THREAD_MESSAGE_STACK_VERSION_ID,
} from "../registry/heygenverseCatalog.js";

export default defineCommand({
  meta: {
    name: "catalog",
    description: "Browse and install blocks and components from the registry",
  },
  args: {
    type: {
      type: "string",
      description: 'Filter by type: "block" or "component"',
    },
    tag: {
      type: "string",
      description: "Filter by tag (e.g. social, transition, text)",
    },
    query: {
      type: "string",
      description: "Filter by name, title, or description",
    },
    json: {
      type: "boolean",
      description: "Print matching items as JSON to stdout",
    },
    "human-friendly": {
      type: "boolean",
      description: "Interactive picker — select an item to install",
    },
  },
  // Catalog output and interactive installation intentionally share the command boundary.
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const json = args.json === true;
    const interactive = args["human-friendly"] === true;
    const dir = resolve(process.cwd());
    const config = loadProjectConfig(dir) ?? DEFAULT_PROJECT_CONFIG;

    let typeFilter: ItemType | undefined;
    if (args.type === "block") typeFilter = "hyperframes:block";
    else if (args.type === "component") typeFilter = "hyperframes:component";
    else if (args.type) {
      console.error(`Invalid --type: "${args.type}". Use "block" or "component".`);
      failCommand();
    }

    const entries = await listRegistryItems(typeFilter ? { type: typeFilter } : undefined, {
      baseUrl: config.registry,
    });
    const filtered = entries.filter((e) => e.type !== "hyperframes:example");

    if (filtered.length === 0) {
      if (json) console.log("[]");
      else console.log("No items found in registry.");
      return;
    }

    const items = await loadAllItems(filtered, { baseUrl: config.registry });

    const tagFilter = args.tag?.toLowerCase();
    const tagged = tagFilter
      ? items.filter((item) => item.tags?.some((t) => t.toLowerCase() === tagFilter))
      : items;
    const normalizedQuery = args.query?.trim().toLowerCase() ?? "";
    const matching = filterPrimitiveCatalogItems(tagged, normalizedQuery);

    if (matching.length === 0) {
      if (json) console.log("[]");
      else if (normalizedQuery) console.log(`No items match query "${args.query}".`);
      else console.log(`No items match tag "${args.tag}".`);
      return;
    }

    if (json) {
      const output = matching.map((item) => ({
        name: item.name,
        type: item.type.replace("hyperframes:", ""),
        title: item.title,
        description: item.description,
        tags: item.tags ?? [],
        ...("dimensions" in item && item.dimensions ? { dimensions: item.dimensions } : {}),
        ...("duration" in item && item.duration ? { duration: item.duration } : {}),
      }));
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    if (interactive) {
      const options = matching.map((item) => ({
        value: item.name,
        label: item.name,
        hint: item.description,
      }));

      const selected = await clack.select({
        message: `${matching.length} items available — pick one to install`,
        options,
      });

      if (clack.isCancel(selected)) {
        clack.cancel("Cancelled.");
        finishCommand(0);
      }

      const selectedName = selected as string;
      let result: Awaited<ReturnType<typeof runAdd>> | undefined;
      if (selectedName === "thread-message-stack") {
        const intent = createPrimitiveInstallIntent({
          itemName: selectedName,
          query: args.query ?? "",
          artifactId: THREAD_MESSAGE_STACK_ARTIFACT_ID,
          versionId: THREAD_MESSAGE_STACK_VERSION_ID,
        });
        const funnelContext = {
          funnelId: intent.funnelId,
          installId: intent.installId,
          artifactId: intent.artifactId,
          versionId: intent.versionId,
          catalogVersion: THREAD_MESSAGE_STACK_CATALOG_DIGEST,
          queryFingerprint: `sha256:${intent.queryFingerprint}`,
        };
        const funnel = new PrimitiveFunnel(funnelContext);
        funnel.searched();
        funnel.selected();
        const outcome = await resumePrimitiveInstallExactlyOnce(intent, {
          store: createFilePrimitiveInstallStateStore(),
          isAuthenticated: async () => {
            const credential = await tryResolveOAuthCredential();
            if (!credential) return false;
            try {
              const user = await new AuthClient().getCurrentUser(credential);
              funnel.authCompleted(user.email ?? user.username);
              return true;
            } catch {
              return false;
            }
          },
          authenticate: async () => {
            funnel.authRequired();
            try {
              await startAuthorizationCodeFlow();
              const credential = await tryResolveOAuthCredential();
              if (!credential) return "failed";
              const user = await new AuthClient().getCurrentUser(credential);
              funnel.authCompleted(user.email ?? user.username);
              return true;
            } catch {
              return "failed";
            }
          },
          install: async () => {
            result = await runAdd({ name: selectedName, projectDir: dir, skipClipboard: false });
            writePrimitiveFunnelContext(dir, funnelContext);
          },
        });
        if (outcome === "failed" || outcome === "cancelled") {
          funnel.installFailed(
            randomUUID(),
            outcome === "cancelled" ? "auth_cancelled" : "auth_failed",
          );
          throw new Error(`Catalog authentication ${outcome}; no primitive was installed.`);
        }
        if (outcome === "installed") funnel.installSucceeded(randomUUID());
        if (!result) {
          console.log(`${c.success("✓")} ${c.accent(selectedName)} was already installed.`);
          return;
        }
      } else {
        result = await runAdd({ name: selectedName, projectDir: dir, skipClipboard: false });
      }

      for (const warning of result.warnings) {
        console.warn(c.warn(`Warning: ${warning}`));
      }
      console.log("");
      console.log(`${c.success("✓")} Installed ${c.accent(result.name)} (${result.type})`);
      for (const file of result.written) {
        const rel = file.replace(dir + "/", "");
        console.log(`  ${c.dim(rel)}`);
      }
      if (result.snippet) {
        console.log("");
        console.log(c.dim("Include snippet:"));
        console.log(`  ${result.snippet}`);
      }
      return;
    }

    const NAME_COL = 28;
    const TYPE_COL = 12;
    console.log(
      `${c.bold("Name".padEnd(NAME_COL))}${c.bold("Type".padEnd(TYPE_COL))}${c.bold("Description")}`,
    );
    console.log("-".repeat(80));

    for (const item of matching) {
      const type = item.type.replace("hyperframes:", "");
      const tags = item.tags?.length ? c.dim(` [${item.tags.join(", ")}]`) : "";
      console.log(
        `${c.cyan(item.name.padEnd(NAME_COL))}${type.padEnd(TYPE_COL)}${item.description}${tags}`,
      );
    }

    console.log("");
    console.log(c.dim(`${matching.length} items. Run "hyperframes add <name>" to install.`));
  },
});
