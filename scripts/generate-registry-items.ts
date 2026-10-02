import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ITEM_TYPE_DIRS } from "../packages/core/src/registry/types.ts";
import { runAsCommand } from "./entrypoint.ts";

function readIdentity(manifest: string): { name: unknown; type: unknown } {
  const item: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (typeof item !== "object" || item === null)
    throw new Error(`Registry identity must be an object: ${manifest}`);
  return { name: Reflect.get(item, "name"), type: Reflect.get(item, "type") };
}

function directoryItems(root: string, type: string, directory: string) {
  const path = join(root, "registry", directory);
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const manifest = join(path, entry.name, "registry-item.json");
      if (!existsSync(manifest)) return [];
      const item = readIdentity(manifest);
      if (item.name !== entry.name || item.type !== type)
        throw new Error(`Registry identity does not match its directory: ${manifest}`);
      return [{ name: entry.name, type }];
    });
}

export function generateRegistryManifest(root: string): void {
  const items = Object.entries(ITEM_TYPE_DIRS).flatMap(([type, directory]) =>
    directoryItems(root, type, directory),
  );
  const names = new Set<string>();
  for (const item of items) {
    if (names.has(item.name)) throw new Error(`Duplicate registry name: ${item.name}`);
    names.add(item.name);
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
