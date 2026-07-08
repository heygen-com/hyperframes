#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { resolve, join, extname, basename } from "node:path";
import { parseArgs } from "node:util";
import { appendRecord, findByPrompt, findByEntity, nextId, allocateId } from "./lib/manifest.mjs";
import { regenerateIndex } from "./lib/index-gen.mjs";
import { cacheGet, cacheGetByEntity, importFromCache, cachePut } from "./lib/cache.mjs";
import { runCapability, listTypes, providerMatches, providerNamesFor } from "./lib/registry.mjs";
import { freezeUrl, freezeLocalFile, isDirectMediaUrl } from "./lib/freeze.mjs";
import { findExistingAsset } from "./lib/adopt.mjs";
import { track } from "./lib/telemetry.mjs";
import { typesMatch } from "./lib/match.mjs";
import { listCandidates, formatCandidates, CANDIDATE_CAP } from "./lib/candidates.mjs";
import { findGlobalBySha } from "./lib/cache.mjs";

const { values: args } = parseArgs({
  options: {
    type: { type: "string", short: "t" },
    intent: { type: "string", short: "i" },
    entity: { type: "string", short: "e" },
    project: { type: "string", short: "p", default: "." },
    adopt: { type: "boolean", default: false },
    candidates: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    reuse: { type: "string" },
    from: { type: "string" },
    "local-only": { type: "boolean", default: false },
    provider: { type: "string" },
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
  --candidates    List reusable assets (project + global cache) for --type; no
                  download, no mutation. Read them and decide reuse yourself.
  --reuse <sha>   Import a specific global-cache asset (by content sha/prefix,
                  from --candidates) into this project
  --provider      Force one generator (e.g. codex, mflux, kokoro, heygen)
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

// Candidates: side-effect-free listing of reusable assets (project + global
// cache) for --type. No download, no provider, no mutation. The agent reads
// these and decides semantic fit itself.
if (args.candidates || args["dry-run"]) {
  await showCandidates();
  process.exit(0);
}

// Reuse: import a specific global-cache asset (by content sha/prefix, taken
// from --candidates) into this project. `!== undefined` so an empty --reuse ""
// still routes here (and gets a clear empty-sha error) instead of falling
// through to the misleading "--type and --intent are required".
if (args.reuse !== undefined) {
  await reuseGlobal(args.reuse);
  process.exit(0);
}

// Ingest: freeze a user-supplied local file or direct public URL (no search).
if (args.from) {
  await ingest(args.from);
  process.exit(0);
}

if (!args.type || !args.intent || !args.intent.trim()) {
  console.error("error: --type and a non-empty --intent are required");
  process.exit(2);
}

if (!listTypes().includes(args.type)) {
  console.error(`error: unknown media type: ${args.type} (known: ${listTypes().join(", ")})`);
  process.exit(2);
}

// Forced-provider validation: reject an unknown/unavailable provider name up
// front so a typo reads as a typo, not a catalog miss (`no provider could
// resolve`). Match rule mirrors runProviders (full name or dotted prefix).
if (args.provider && !providerMatches(args.type, args.provider)) {
  console.error(
    `error: unknown provider "${args.provider}" for type ${args.type} (available: ${providerNamesFor(args.type).join(", ")})`,
  );
  process.exit(2);
}

const projectDir = resolve(args.project);
const type = args.type;
const intent = args.intent;
const entity = args.entity || null;

async function run() {
  // A forced --provider means "(re)generate with THIS provider" — it bypasses
  // every reuse rung (project/entity/assets/global cache) so it can't silently
  // hand back an asset from a different provider. The floor only applies to the
  // default (unforced) cascade.
  const forced = !!args.provider;

  // 1. project manifest — exact-prompt match
  const projectHit = forced ? null : findByPrompt(projectDir, intent, type);
  if (projectHit && existsSync(join(projectDir, projectHit.path))) {
    return result(projectHit, "cached");
  }

  // 1b. entity match in project. icon and image are interchangeable for
  // entity hits — both live in images/, and figma-imported brand marks are
  // always recorded as type image while agents ask for logos as type icon.
  if (!forced && entity) {
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
  const existingAsset = forced ? null : findExistingAsset(projectDir, intent, type);
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
  const cacheHit = forced ? null : cacheGet(intent, type);
  if (cacheHit) {
    const ext = extname(cacheHit.cached_path);
    const { id, localPath } = allocateId(projectDir, type, ext);
    const imported = importFromCache(cacheHit, projectDir, id, localPath);
    if (imported) {
      appendRecord(projectDir, imported);
      regenerateIndex(projectDir);
      return result(imported, "reused");
    }
  }

  if (!forced && entity) {
    const entityCacheHit = cacheGetByEntity(entity);
    if (entityCacheHit && typesMatch(entityCacheHit.type, type)) {
      const ext = extname(entityCacheHit.cached_path);
      const { id, localPath } = allocateId(projectDir, type, ext);
      const imported = importFromCache(entityCacheHit, projectDir, id, localPath);
      if (imported) {
        appendRecord(projectDir, imported);
        regenerateIndex(projectDir);
        return result(imported, "reused");
      }
    }
  }

  // Offline guard: --local-only skips every remote provider (HeyGen catalog),
  // leaving the project + global cache and any local provider.
  const localOnly = args["local-only"];
  const ctx = { entity, projectDir, localOnly, provider: args.provider };

  // Adherence nudge (offline, no auto-reuse): the exact-cache floor missed and
  // we're about to fetch/generate. If lexically-similar assets already exist,
  // point the agent at --candidates so it can reuse instead of fetching. Only a
  // fuzzy match ever reaches the agent this way — never auto-applied. Goes to
  // stderr so it reaches --json callers without corrupting stdout. Best-effort.
  try {
    const { similar } = listCandidates({ projectDir, type, intent, cap: CANDIDATE_CAP });
    if (similar > 0) {
      console.error(
        `media-use: ${similar} similar cached asset${similar === 1 ? "" : "s"} already ${similar === 1 ? "exists" : "exist"} — run \`resolve --candidates --type ${type} --intent "${intent}"\` to review and reuse instead of fetching.`,
      );
    }
  } catch {
    // hint is best-effort; never block a resolve
  }

  // 3. provider search — registry tries providers in order (heygen-CLI first)
  let searchResult = null;
  try {
    searchResult = await runCapability(type, "search", intent, ctx);
  } catch {
    // search failed, try generate
  }

  // 4. generate fallback — same ordered cascade for the generate capability
  if (!searchResult) {
    try {
      searchResult = await runCapability(type, "generate", intent, ctx);
    } catch {
      // generate failed too
    }
  }

  if (!searchResult) {
    await track("media_use_resolve_miss", {
      type,
      local_only: !!localOnly,
      provider_override: !!args.provider,
    });
    // brand stays local: no frame.md/design.md -> upsell the HyperFrames design
    // flow rather than reporting a generic miss (B5).
    const msg =
      type === "brand"
        ? "no brand spec found — add a frame.md or design.md (colors/font/logo) to this project. Run the HyperFrames design flow to create one; brand tokens are read locally for deterministic rendering."
        : args.provider
          ? `provider "${args.provider}" could not resolve ${type}: "${intent}"${localOnly ? " (--local-only skips network providers; drop it or the --provider override)" : ""}`
          : `no provider could resolve ${type}: "${intent}"`;
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: msg }));
    } else {
      console.error(`error: ${msg}`);
    }
    process.exit(1);
  }

  // 5. freeze + register (atomic id+file reservation so concurrent resolves
  // can't collide on an id during the download — MU-23)
  const ext = searchResult.ext || extFromUrl(searchResult.url || "") || defaultExt(type);
  const { id, localPath } = allocateId(projectDir, type, ext);
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
    ...(searchResult.metadata?.duration != null && {
      duration: Math.round(searchResult.metadata.duration * 10) / 10, // round to 0.1s like probe (voice bypassed it)
    }),
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
  // Auto-promote: surface every fetched asset in the global cache so it's
  // reusable across all hyperframes projects (B3). Non-fatal; dedup by sha.
  // ponytail: promotes search/generate/ingest assets (the ones media-use
  // fetched), not bulk --adopt imports — add those if cross-project reuse of
  // pre-existing project assets is wanted.
  try {
    cachePut(fullPath, record);
  } catch {
    // promotion is best-effort; a resolve still succeeds locally
  }
  return result(record, searchResult.source || "search");
}

async function ingest(src) {
  const projectDir = resolve(args.project);
  const type = args.type;
  if (!type || !listTypes().includes(type)) {
    console.error(`error: --from requires --type (one of: ${listTypes().join(", ")})`);
    process.exit(2);
  }
  const isUrl = /^https?:\/\//i.test(src);
  if (isUrl && !isDirectMediaUrl(src)) {
    console.error(
      `error: --from takes a direct public media URL or a local file; "${src}" is not a direct media link (no platform pages / yt-dlp)`,
    );
    process.exit(2);
  }
  if (!isUrl && !existsSync(resolve(src))) {
    console.error(`error: file not found: ${src}`);
    process.exit(2);
  }
  // Refuse 0-byte input: an empty asset would register clean but fail at render
  // (freezeUrl already rejects empty responses; this covers local files).
  if (!isUrl && statSync(resolve(src)).size === 0) {
    console.error(`error: refusing to ingest a 0-byte file: ${src}`);
    process.exit(2);
  }
  const ext = extname(isUrl ? new URL(src).pathname : src) || defaultExt(type);
  const { id, localPath } = allocateId(projectDir, type, ext);
  const fullPath = join(projectDir, localPath);
  if (isUrl) await freezeUrl(src, fullPath);
  else freezeLocalFile(resolve(src), fullPath);
  const record = {
    id,
    type,
    path: localPath,
    source: "ingested",
    description: basename(src.split("?")[0]),
    provenance: { provider: "local", from: src },
  };
  appendRecord(projectDir, record);
  regenerateIndex(projectDir);
  try {
    cachePut(fullPath, record); // surface ingested assets globally too (B3)
  } catch {
    // best-effort
  }
  await result(record, "ingested");
}

async function showCandidates() {
  const projectDir = resolve(args.project);
  const type = args.type;
  if (!type || !listTypes().includes(type)) {
    console.error(`error: --candidates requires --type (one of: ${listTypes().join(", ")})`);
    process.exit(2);
  }
  const intent = args.intent || "";
  const { candidates, truncated, total, similar } = listCandidates({
    projectDir,
    type,
    intent,
    cap: CANDIDATE_CAP,
  });
  await track("media_use_candidates", {
    type,
    project_n: total.project,
    global_n: total.global,
    local_only: !!args["local-only"],
  });
  if (args.json) {
    console.log(JSON.stringify({ ok: true, candidates, truncated, total, similar }));
  } else {
    console.log(formatCandidates(candidates, { truncated, total }));
  }
}

async function reuseGlobal(shaArg) {
  const projectDir = resolve(args.project);
  const type = args.type;
  if (!type || !listTypes().includes(type)) {
    console.error(`error: --reuse requires --type (one of: ${listTypes().join(", ")})`);
    process.exit(2);
  }
  if (!shaArg || !shaArg.trim()) {
    console.error("error: --reuse needs a content sha/prefix (from `resolve --candidates`)");
    process.exit(2);
  }
  const rec = findGlobalBySha(shaArg);
  if (rec && rec.ambiguous) {
    console.error(
      `error: sha prefix "${shaArg}" is ambiguous (${rec.count} matches) — use more characters`,
    );
    process.exit(2);
  }
  if (!rec) {
    console.error(`error: no reusable global asset matches sha "${shaArg}"`);
    process.exit(1);
  }
  // Type guard: don't import a bgm asset as an image (audio under images/).
  // icon<->image are interchangeable; everything else must match --type.
  if (!typesMatch(rec.type, type)) {
    console.error(`error: sha "${shaArg}" is a ${rec.type} asset, not ${type}`);
    process.exit(2);
  }
  const ext = extname(rec.cached_path || "") || defaultExt(type);
  const { id, localPath } = allocateId(projectDir, type, ext);
  const imported = importFromCache(rec, projectDir, id, localPath);
  if (!imported) {
    console.error(`error: cache entry for "${shaArg}" is incomplete or missing on disk`);
    process.exit(1);
  }
  // Distinguish an explicit agent reuse from an automatic normalize-exact hit.
  imported.source = "reused-explicit";
  imported.provenance = { ...imported.provenance, reused_by: "agent" };
  appendRecord(projectDir, imported);
  regenerateIndex(projectDir);
  await result(imported, "reused-explicit");
}

async function result(record, source) {
  // Non-PII usage event: which media type, how it resolved, which provider won.
  // Never the intent text or paths. Awaited so a short-lived run flushes it.
  await track("media_use_resolve", {
    type: record.type,
    source,
    provider: record.provenance?.provider,
    local_only: !!args["local-only"],
    provider_override: !!args.provider,
  });
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
  if (source === "reused" || source === "reused-explicit") parts.push("reused");
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
  logo: ".svg",
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
