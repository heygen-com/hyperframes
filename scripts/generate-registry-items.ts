import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ITEM_TYPE_DIRS } from "../packages/core/src/registry/types.ts";
import { runAsCommand } from "./entrypoint.ts";

export function generateRegistryManifest(root: string): void {
  const items = [];
  const names = new Set<string>();
  for (const [type, directory] of Object.entries(ITEM_TYPE_DIRS)) {
    const path = join(root, "registry", directory);
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!entry.isDirectory()) continue;
      const manifest = join(path, entry.name, "registry-item.json");
      if (!existsSync(manifest)) continue;
      const item: unknown = JSON.parse(readFileSync(manifest, "utf8"));
      if (
        typeof item !== "object" ||
        item === null ||
        !("name" in item) ||
        !("type" in item) ||
        item.name !== entry.name ||
        item.type !== type
      ) {
        throw new Error(`Registry identity does not match its directory: ${manifest}`);
      }
      if (names.has(entry.name)) throw new Error(`Duplicate registry name: ${entry.name}`);
      names.add(entry.name);
      items.push({ name: entry.name, type });
    }
  }
  writeFileSync(
    join(root, "registry/registry.json"),
    JSON.stringify(
      {
        $schema: "https://hyperframes.heygen.com/schema/registry.json",
        name: "hyperframes",
        homepage: "https://hyperframes.heygen.com",
        items,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Indexed ${items.length} registry items without changing their sources.`);
}

runAsCommand(import.meta.url, async () =>
  generateRegistryManifest(resolve(fileURLToPath(new URL("..", import.meta.url)))),
);
