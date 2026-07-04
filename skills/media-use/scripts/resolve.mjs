#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { parseArgs } from "node:util";
import { appendRecord, findByPrompt, findByEntity, nextId, typeSubdir } from "./lib/manifest.mjs";
import { regenerateIndex } from "./lib/index-gen.mjs";
import { cacheGet, cacheGetByEntity, importFromCache } from "./lib/cache.mjs";
import { getProvider, listTypes } from "./lib/providers.mjs";
import { freezeUrl, freezeLocalFile } from "./lib/freeze.mjs";
import { findExistingAsset } from "./lib/adopt.mjs";

const { values: args } = parseArgs({
  options: {
    type: { type: "string", short: "t" },
    intent: { type: "string", short: "i" },
    entity: { type: "string", short: "e" },
    project: { type: "string", short: "p", default: "." },
    adopt: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`media-use resolve — turn a media need into a frozen local file

Usage:
  node resolve.mjs --type <type> --intent "<description>" [--project <dir>]

Types: ${listTypes().join(", ")}

Options:
  --type, -t      Media type (required)
  --intent, -i    What you need (required)
  --entity, -e    Entity name for cache matching (optional)
  --project, -p   Project directory (default: .)
  --adopt         Adopt all existing assets/ files into the manifest
  --json          Output JSON instead of one-line result
  --help, -h      Show this help`);
  process.exit(0);
}

if (args.adopt) {
  const { adoptExistingAssets } = await import("./lib/adopt.mjs");
  const projectDir = resolve(args.project);
  const adopted = adoptExistingAssets(projectDir);
  if (args.json) {
    console.log(JSON.stringify({ ok: true, adopted: adopted.length, assets: adopted }));
  } else if (adopted.length === 0) {
    console.log("no new assets to adopt (assets/ empty or already registered)");
  } else {
    console.log(`adopted ${adopted.length} asset${adopted.length === 1 ? "" : "s"} from assets/`);
    for (const r of adopted) console.log(`  ${r.id} → ${r.path} (${r.type})`);
  }
  process.exit(0);
}

if (!args.type || !args.intent) {
  console.error("error: --type and --intent are required");
  process.exit(2);
}

const projectDir = resolve(args.project);
const type = args.type;
const intent = args.intent;
const entity = args.entity || null;

async function run() {
  // 1. project manifest — exact-prompt match
  const projectHit = findByPrompt(projectDir, intent, type);
  if (projectHit && existsSync(join(projectDir, projectHit.path))) {
    return result(projectHit, "cached");
  }

  // 1b. entity match in project. icon and image are interchangeable for
  // entity hits — both live in images/, and figma-imported brand marks are
  // always recorded as type image while agents ask for logos as type icon.
  if (entity) {
    const entityHit = findByEntity(projectDir, entity);
    if (
      entityHit &&
      typesMatch(entityHit.type, type) &&
      existsSync(join(projectDir, entityHit.path))
    ) {
      return result(entityHit, "cached");
    }
  }

  // 1c. scan existing assets/ directory for unregistered matches
  const existingAsset = findExistingAsset(projectDir, intent, type);
  if (existingAsset) {
    const id = nextId(projectDir, type);
    const record = {
      id,
      type: existingAsset.type,
      path: existingAsset.relativePath,
      source: "existing",
      description: existingAsset.name.replace(/[-_]/g, " "),
      provenance: { provider: "local", adopted: true, prompt: intent },
    };
    appendRecord(projectDir, record);
    regenerateIndex(projectDir);
    return result(record, "existing");
  }

  // 2. global cache — exact-prompt or entity match
  const cacheHit = cacheGet(intent, type);
  if (cacheHit) {
    const id = nextId(projectDir, type);
    const ext = extname(cacheHit.cached_path);
    const localPath = `.media/${typeSubdir(type)}/${id}${ext}`;
    const imported = importFromCache(cacheHit, projectDir, id, localPath);
    if (imported) {
      appendRecord(projectDir, imported);
      regenerateIndex(projectDir);
      return result(imported, "reused");
    }
  }

  if (entity) {
    const entityCacheHit = cacheGetByEntity(entity);
    if (entityCacheHit && typesMatch(entityCacheHit.type, type)) {
      const id = nextId(projectDir, type);
      const ext = extname(entityCacheHit.cached_path);
      const localPath = `.media/${typeSubdir(type)}/${id}${ext}`;
      const imported = importFromCache(entityCacheHit, projectDir, id, localPath);
      if (imported) {
        appendRecord(projectDir, imported);
        regenerateIndex(projectDir);
        return result(imported, "reused");
      }
    }
  }

  // 3. provider search
  const provider = getProvider(type);
  let searchResult = null;
  try {
    searchResult = await provider.search(intent, { entity, projectDir });
  } catch {
    // search failed, try generate
  }

  // 4. generate fallback
  if (!searchResult && provider.generate) {
    try {
      searchResult = await provider.generate(intent, { entity, projectDir });
    } catch {
      // generate failed too
    }
  }

  if (!searchResult) {
    if (args.json) {
      console.log(
        JSON.stringify({ ok: false, error: `no provider could resolve ${type}: "${intent}"` }),
      );
    } else {
      console.error(`error: no provider could resolve ${type}: "${intent}"`);
    }
    process.exit(1);
  }

  // 5. freeze + register
  const id = nextId(projectDir, type);
  const ext = searchResult.ext || extFromUrl(searchResult.url || "") || defaultExt(type);
  const localPath = `.media/${typeSubdir(type)}/${id}${ext}`;
  const fullPath = join(projectDir, localPath);

  if (searchResult.localPath) {
    freezeLocalFile(searchResult.localPath, fullPath);
  } else if (searchResult.url) {
    await freezeUrl(searchResult.url, fullPath);
  } else {
    console.error("error: provider returned no url or localPath");
    process.exit(1);
  }

  const record = {
    id,
    type,
    path: localPath,
    source: searchResult.source || "search",
    description: searchResult.metadata?.description || intent,
    ...(searchResult.metadata?.duration != null && { duration: searchResult.metadata.duration }),
    ...(searchResult.metadata?.width != null && { width: searchResult.metadata.width }),
    ...(searchResult.metadata?.height != null && { height: searchResult.metadata.height }),
    ...(searchResult.metadata?.transparent != null && {
      transparent: searchResult.metadata.transparent,
    }),
    ...(entity && { entity }),
    provenance: {
      provider: searchResult.metadata?.provider || "unknown",
      prompt: intent,
      ...searchResult.metadata?.provenance,
    },
  };

  appendRecord(projectDir, record);
  regenerateIndex(projectDir);
  return result(record, searchResult.source || "search");
}

function typesMatch(a, b) {
  if (a === b) return true;
  const visual = new Set(["icon", "image"]);
  return visual.has(a) && visual.has(b);
}

function result(record, source) {
  if (args.json) {
    console.log(JSON.stringify({ ok: true, ...record, _source: source }));
  } else {
    const meta = formatMeta(record, source);
    console.log(`resolved ${record.id} → ${record.path} (${meta})`);
  }
}

function formatMeta(record, source) {
  const parts = [record.type];
  if (record.duration != null) parts.push(`${record.duration}s`);
  if (record.width && record.height) parts.push(`${record.width}×${record.height}`);
  if (record.transparent) parts.push("transparent");
  if (source === "reused") parts.push("reused");
  if (source === "generated") parts.push("generated");
  return parts.join(", ");
}

function extFromUrl(url) {
  try {
    return extname(new URL(url).pathname) || null;
  } catch {
    return null;
  }
}

const DEFAULT_EXT = {
  bgm: ".wav",
  sfx: ".mp3",
  voice: ".wav",
  image: ".jpg",
  icon: ".svg",
  brand: ".png",
};

function defaultExt(type) {
  return DEFAULT_EXT[type] || ".bin";
}

run().catch((err) => {
  if (args.json) {
    console.log(JSON.stringify({ ok: false, error: err.message }));
  } else {
    console.error(`error: ${err.message}`);
  }
  process.exit(1);
});
