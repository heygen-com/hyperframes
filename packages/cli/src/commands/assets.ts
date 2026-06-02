import { defineCommand } from "citty";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  ["List reusable assets", "hyperframes assets"],
  ["Search for a logo", "hyperframes assets logo --kind image"],
  ["Machine-readable search for agents", "hyperframes assets openai --json"],
  ["Copy the best match into the project assets directory", "hyperframes assets openai --copy"],
  [
    "Copy with an explicit target under paths.assets",
    "hyperframes assets openai --copy --to logos/openai.svg",
  ],
];

import { resolve } from "node:path";
import {
  ASSET_KINDS,
  copyAssetToProject,
  type AssetKind,
  type AssetMatch,
  resolveAssetLibraries,
  type ResolvedAssetLibrary,
  scanAssetLibraries,
} from "../assets/library.js";
import { c } from "../ui/colors.js";
import { formatBytes } from "../ui/format.js";
import { loadProjectConfig } from "../utils/projectConfig.js";

const NAME_COL = 30;
const KIND_COL = 10;
const LIBRARY_COL = 22;

interface AssetsCommandArgs {
  query?: string;
  dir?: string;
  kind?: string;
  limit?: string;
  copy?: boolean;
  to?: string;
  force?: boolean;
  json?: boolean;
}

interface AssetsCommandContext {
  projectDir: string;
  assetsDir: string;
  libraries: ResolvedAssetLibrary[];
  matches: AssetMatch[];
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 25;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid --limit "${value}". Use a positive integer.`);
  }
  return parsed;
}

function parseKind(value: string | undefined): AssetKind | undefined {
  if (!value) return undefined;
  for (const kind of ASSET_KINDS) {
    if (value === kind) return kind;
  }
  throw new Error(`Invalid --kind "${value}". Use one of: ${ASSET_KINDS.join(", ")}.`);
}

function assetJson(asset: AssetMatch) {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    relativePath: asset.relativePath,
    path: asset.path,
    size: asset.size,
    library: {
      name: asset.library.name,
      path: asset.library.path,
      source: asset.library.source,
    },
  };
}

function libraryJson(library: ResolvedAssetLibrary) {
  return {
    name: library.name,
    path: library.path,
    source: library.source,
  };
}

function printNoLibraries(): void {
  console.log(c.warn("No asset libraries found."));
  console.log(
    c.dim(
      "Add assetLibraries to hyperframes.json, set HYPERFRAMES_ASSET_LIBRARY, or put files in ~/.hyperframes/assets.",
    ),
  );
}

function printNoMatches(libraries: ResolvedAssetLibrary[]): void {
  console.log(c.warn("No matching assets found."));
  console.log(
    c.dim(
      `Searched ${libraries.length} asset ${libraries.length === 1 ? "library" : "libraries"}.`,
    ),
  );
}

function truncateCell(value: string, width: number): string {
  return value.length > width - 1 ? `${value.slice(0, width - 4)}...` : value;
}

function printMatchesHeader(): void {
  console.log(
    `${c.bold("Name".padEnd(NAME_COL))}${c.bold("Kind".padEnd(KIND_COL))}${c.bold("Library".padEnd(LIBRARY_COL))}${c.bold("Path")}`,
  );
  console.log("-".repeat(92));
}

function printMatchRows(matches: AssetMatch[]): void {
  for (const asset of matches) {
    const name = truncateCell(asset.name, NAME_COL);
    const library = truncateCell(asset.library.name, LIBRARY_COL);
    console.log(
      `${c.cyan(name.padEnd(NAME_COL))}${asset.kind.padEnd(KIND_COL)}${library.padEnd(LIBRARY_COL)}${asset.relativePath} ${c.dim(formatBytes(asset.size))}`,
    );
  }
}

function printMatches(matches: AssetMatch[], libraries: ResolvedAssetLibrary[]): void {
  if (libraries.length === 0) return printNoLibraries();
  if (matches.length === 0) return printNoMatches(libraries);

  printMatchesHeader();
  printMatchRows(matches);
  console.log("");
  console.log(
    c.dim(
      `${matches.length} assets. Run "hyperframes assets <query> --copy" to copy the best match.`,
    ),
  );
}

function loadAssetsContext(args: AssetsCommandArgs): AssetsCommandContext {
  const projectDir = resolve(args.dir ?? process.cwd());
  const config = loadProjectConfig(projectDir);
  const libraries = resolveAssetLibraries({ projectDir, config });
  const matches = scanAssetLibraries({
    libraries,
    query: args.query,
    kind: parseKind(args.kind),
    limit: parseLimit(args.limit),
  });
  return { projectDir, assetsDir: config.paths.assets, libraries, matches };
}

function printCopiedAsset(asset: AssetMatch, relativeTarget: string, src: string): void {
  console.log(`${c.success("OK")} Copied ${c.accent(asset.name)}`);
  console.log(`  ${c.dim(asset.path)}`);
  console.log(`  ${c.dim("->")} ${relativeTarget}`);
  console.log("");
  console.log(c.dim("Use as:"));
  console.log(`  src="${src}"`);
}

function bestCopyMatch(matches: AssetMatch[], query: string | undefined): AssetMatch {
  const asset = matches[0];
  if (asset) return asset;
  throw new Error(
    query
      ? `No asset matched "${query}".`
      : "Use a search query with --copy so HyperFrames can choose an asset.",
  );
}

function handleCopy(args: AssetsCommandArgs, context: AssetsCommandContext, json: boolean): void {
  const asset = bestCopyMatch(context.matches, args.query);
  const copied = copyAssetToProject({
    asset,
    projectDir: context.projectDir,
    assetsDir: context.assetsDir,
    target: args.to,
    force: args.force === true,
  });

  if (json) {
    console.log(JSON.stringify({ ok: true, asset: assetJson(asset), copied }, null, 2));
    return;
  }

  printCopiedAsset(asset, copied.relativeTarget, copied.src);
}

function handleSearch(context: AssetsCommandContext, json: boolean): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          libraries: context.libraries.map(libraryJson),
          assets: context.matches.map(assetJson),
        },
        null,
        2,
      ),
    );
    return;
  }

  printMatches(context.matches, context.libraries);
}

function handleError(err: unknown, json: boolean): never {
  const message = err instanceof Error ? err.message : String(err);
  if (json) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.error(c.error(message));
  }
  process.exit(1);
}

export default defineCommand({
  meta: {
    name: "assets",
    description: "Search and copy reusable assets from configured local libraries",
  },
  args: {
    query: {
      type: "positional",
      description: "Search query (file name, folder, tag-like word, or library name)",
      required: false,
    },
    dir: {
      type: "string",
      description: "Project directory (defaults to the current working directory)",
    },
    kind: {
      type: "string",
      description: `Filter by asset kind: ${ASSET_KINDS.join(", ")}`,
    },
    limit: {
      type: "string",
      description: "Maximum number of matches to print",
      default: "25",
    },
    copy: {
      type: "boolean",
      description: "Copy the best matching asset into this project's configured assets path",
    },
    to: {
      type: "string",
      description: "Copy target path relative to hyperframes.json paths.assets",
    },
    force: {
      type: "boolean",
      description: "Allow --copy to overwrite an existing file",
    },
    json: {
      type: "boolean",
      description: "Print a machine-readable summary",
    },
  },
  async run({ args }) {
    const json = args.json === true;

    try {
      const context = loadAssetsContext(args);
      if (args.copy === true) handleCopy(args, context, json);
      else handleSearch(context, json);
    } catch (err) {
      handleError(err, json);
    }
  },
});
