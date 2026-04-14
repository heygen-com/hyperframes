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
import { runAdd } from "./add.js";

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
    json: {
      type: "boolean",
      description: "Print matching items as JSON to stdout",
    },
    "human-friendly": {
      type: "boolean",
      description: "Interactive picker — select an item to install",
    },
  },
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
      process.exit(1);
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
    const matching = tagFilter
      ? items.filter((item) => item.tags?.some((t) => t.toLowerCase() === tagFilter))
      : items;

    if (matching.length === 0) {
      if (json) console.log("[]");
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
        process.exit(0);
      }

      const result = await runAdd({
        name: selected as string,
        projectDir: dir,
        skipClipboard: false,
      });

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
