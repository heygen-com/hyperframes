#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { resolve, join, extname, basename } from "node:path";
import { parseArgs } from "node:util";
import { appendRecord, findByPrompt, findByEntity, nextId, allocateId } from "./lib/manifest.mjs";
import { regenerateIndex } from "./lib/index-gen.mjs";
import { cacheGet, cacheGetByEntity, importFromCache, cachePut } from "./lib/cache.mjs";
import { runCapability, listTypes, providerMatches, providerNamesFor } from "./lib/registry.mjs";
import { freezeUrl, freezeLocalFile, isDirectMediaUrl } from "./lib/freeze.mjs";
import { findExistingAsset } from "./lib/adopt.mjs";
import { track } from "./lib/telemetry.mjs";
import { recordMiss } from "./lib/misses.mjs";
import { buildStats } from "./lib/stats.mjs";
import { typesMatch } from "./lib/match.mjs";
import { listCandidates, formatCandidates, CANDIDATE_CAP } from "./lib/candidates.mjs";
import { findGlobalBySha } from "./lib/cache.mjs";
import { heygenAuthMethod } from "../audio/scripts/lib/heygen.mjs";
import { buildCube, paramsFromIntent } from "./lib/cube-build.mjs";
import { validateCubeFile } from "./lib/cube-validate.mjs";
import { analyzeMediaGrade, formatMeasuredNote } from "./lib/grade-analyzer.mjs";
import {
  freezeLibraryLut,
  isLibraryLutOfflineMiss,
  matchColorLook,
} from "./lib/lut-preset-provider.mjs";
import {
  HEYGEN_AUTH_COMMAND,
  HEYGEN_INSTALL_COMMAND,
  HEYGEN_MIN_VERSION,
  HEYGEN_UPDATE_COMMAND,
  consumeHeygenRemediation,
  firstSemver,
  flushHeygenFailureTracking,
  versionLessThan,
} from "./lib/heygen-cli.mjs";
import { BundledSfxAssetsError, inspectBundledSfxAssets } from "./lib/bundled-sfx-provider.mjs";

const INGEST_TYPES = listTypes();
const DEFAULT_EXT = {
  bgm: ".wav",
  sfx: ".mp3",
  voice: ".wav",
  image: ".jpg",
  icon: ".svg",
  logo: ".svg",
  brand: ".png",
  video: ".mp4",
  grade: ".cube",
  lut: ".cube",
};

// resolve shells `fetch`/`freezeUrl` and modern ESM; 18 is the floor where those
// exist without flags. Named so the --doctor node check verifies something real
// (O2). Declared before the top-level `--doctor` branch that calls runDoctor().
const MIN_NODE_VERSION = "18.0.0";

const { values: args } = parseArgs({
  options: {
    type: { type: "string", short: "t" },
    intent: { type: "string", short: "i" },
    entity: { type: "string", short: "e" },
    project: { type: "string", short: "p", default: "." },
    adopt: { type: "boolean", default: false },
    candidates: { type: "boolean", default: false },
    doctor: { type: "boolean", default: false },
    stats: { type: "boolean", default: false },
    days: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    reuse: { type: "string" },
    from: { type: "string" },
    params: { type: "string" },
    for: { type: "string" },
    "local-only": { type: "boolean", default: false },
    provider: { type: "string" },
    "avatar-id": { type: "string" },
    "voice-id": { type: "string" },
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
  --doctor        Check local CLI dependencies; no manifest changes.
  --stats         Print local usage stats from .media and ~/.media; no mutation.
  --days <N>      Limit --stats to records/misses from the last N days when
                  timestamps are available.
  --reuse <sha>   Import a specific global-cache asset (by content sha/prefix,
                  from --candidates) into this project
  --from <file>   Freeze a local file or direct public URL (ingest)
  --params <json> Build an explicit parametric LUT (lut/grade only)
  --for <media>   Analyze a local image/video and add measured grade adjust
                  suggestions (grade only)
  --local-only    Offline: skip every network provider
  --provider      Force one generator (e.g. codex, mflux, kokoro, heygen)
  --avatar-id     Override the default avatar for heygen.video generation
  --voice-id      Override the default voice for voice/heygen.video generation
  --json          Output JSON instead of one-line result
  --help, -h      Show this help`);
  process.exit(0);
}

const projectDir = resolve(args.project);
const type = args.type;
const intent = args.intent;
const entity = args.entity || null;

if (args.adopt) {
  const { adoptExistingAssets } = await import("./lib/adopt.mjs");
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

if (args.doctor) {
  const doctor = runDoctor();
  const failed = doctor.checks.filter((check) => !check.ok);
  // Non-PII: instrument the exact question the feature exists to answer — how
  // often is --doctor run and which check fails most. Awaited so a short-lived
  // run flushes before exit.
  await track("media_use_doctor_run", {
    ok: doctor.ok,
    checks_failed: failed.length,
    failed: failed.map((check) => check.name),
  });
  if (args.json) {
    console.log(JSON.stringify({ ok: doctor.ok, checks: doctor.checks }));
  } else {
    printDoctor(doctor.checks);
  }
  process.exit(doctor.ok ? 0 : 1);
}

if (args.stats) {
  const report = buildStats({
    projectDir,
    days: args.days ? Number(args.days) : undefined,
  });
  if (args.json) {
    console.log(JSON.stringify(report));
  } else {
    printStats(report);
  }
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

// Recipes: folder-based named bundles resolved by entity name — no providers,
// no content hashing (an evolving versioned bundle, not an immutable file).
// Delegates to lib/recipe-store.mjs the way grade/lut delegate to resolveColor;
// freeze/list live in scripts/recipe.mjs.
if (type === "recipe") {
  const { useRecipe } = await import("./lib/recipe-store.mjs");
  const name = (entity || intent || "").trim();
  if (!name) exitError("--type recipe needs --entity <name> (or --intent <name>)", 2);
  try {
    const used = useRecipe({ projectDir, name });
    if (args.json) {
      console.log(JSON.stringify({ ok: true, ...used }));
    } else {
      console.log(
        `resolved recipe ${used.recipe.name} (v${used.recipe.version}, ${used.recipe.workflow})`,
      );
      console.log(`  frame spec → ${used.frameSpecPath} (copied over)`);
      console.log(`  storyboard skeleton → ${used.skeletonPath}`);
      if (used.briefSkeletonPath) console.log(`  brief skeleton → ${used.briefSkeletonPath}`);
    }
    process.exit(0);
  } catch (err) {
    exitError(err.message, 1);
  }
}

if (args.params !== undefined) {
  if (type !== "lut" && type !== "grade") {
    exitError(
      type
        ? `--params only supports --type lut or grade (got ${type})`
        : "--params requires --type lut or grade",
      2,
    );
  }
  try {
    await runParams();
    process.exit(0);
  } catch (err) {
    exitError(err.message, 1);
  }
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

function recordAvailable(projectDir, record) {
  if (!record) return false;
  if (record.path) return existsSync(join(projectDir, record.path));
  return record.type === "grade" && record.grading;
}

// Sparse `{ authMethod }` for a heygen-family provider name (e.g. "heygen.tts"),
// else `{}` — keeps auth_method telemetry absent for every non-heygen resolve
// instead of implying an auth method that doesn't apply.
function heygenAuthMethodFor(provider) {
  if (!provider || !provider.startsWith("heygen.")) return {};
  const authMethod = heygenAuthMethod();
  return authMethod ? { authMethod } : {};
}

function localizeImportedRecord(record, localPath) {
  if (record?.type === "grade" && record.grading?.lut) {
    record.grading = {
      ...record.grading,
      lut: { ...record.grading.lut, src: localPath },
    };
  }
  return record;
}

async function run() {
  // A forced --provider means "(re)generate with THIS provider" — it bypasses
  // every reuse rung (project/entity/assets/global cache) so it can't silently
  // hand back an asset from a different provider. The floor only applies to the
  // default (unforced) cascade.
  const forced = !!args.provider;

  // 1. project manifest — exact-prompt match
  const projectHit = forced ? null : findByPrompt(projectDir, intent, type);
  if (recordAvailable(projectDir, projectHit)) {
    return result(projectHit, "cached");
  }

  // 1b. entity match in project. icon and image are interchangeable for
  // entity hits — both live in images/, and figma-imported brand marks are
  // always recorded as type image while agents ask for logos as type icon.
  if (!forced && entity) {
    const entityHit = findByEntity(projectDir, entity);
    if (entityHit && typesMatch(entityHit.type, type) && recordAvailable(projectDir, entityHit)) {
      return result(entityHit, "cached");
    }
  }

  // 1c. scan existing assets/ directory for unregistered matches
  const existingAsset =
    forced || type === "grade" || type === "lut"
      ? null
      : findExistingAsset(projectDir, intent, type);
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
    const imported = localizeImportedRecord(
      importFromCache(cacheHit, projectDir, id, localPath),
      localPath,
    );
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
      const imported = localizeImportedRecord(
        importFromCache(entityCacheHit, projectDir, id, localPath),
        localPath,
      );
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
  const ctx = {
    entity,
    projectDir,
    localOnly,
    provider: args.provider,
    avatarId: args["avatar-id"],
    voiceId: args["voice-id"],
  };

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

  if (type === "grade" || type === "lut") {
    return resolveColor(type, intent, { projectDir });
  }

  // 3. provider search — registry tries providers in order (heygen-CLI first)
  let searchResult = null;
  let providerFailure = null;
  try {
    searchResult = await runCapability(type, "search", intent, ctx);
  } catch (error) {
    providerFailure = error;
    // search failed, try generate
  }

  // 4. generate fallback — same ordered cascade for the generate capability
  if (!searchResult) {
    try {
      searchResult = await runCapability(type, "generate", intent, ctx);
    } catch (error) {
      providerFailure ??= error;
      // generate failed too
    }
  }

  // A search/generate attempt against heygen may have fired a fire-and-forget
  // media_use_provider_error track (reportHeygenFailure — heygen-search.mjs /
  // voice-provider.mjs are sync call sites several layers below here and can't
  // await it themselves). Join it now, before any process.exit() below can
  // race it: both it and the miss/success telemetry below are separate,
  // non-keepalive HTTP connections with no ordering guarantee otherwise.
  await flushHeygenFailureTracking();

  if (!searchResult) {
    await track("media_use_resolve_miss", {
      type,
      local_only: !!localOnly,
      provider_override: !!args.provider,
    });
    recordMiss({
      type,
      intent,
      provider_override: !!args.provider,
      local_only: !!args["local-only"],
    });
    // brand stays local: no frame.md/design.md -> upsell the HyperFrames design
    // flow rather than reporting a generic miss (B5).
    const msg =
      providerFailure instanceof BundledSfxAssetsError
        ? providerFailure.message
        : type === "brand"
          ? "no brand spec found — add a frame.md or design.md (colors/font/logo) to this project. Run the HyperFrames design flow to create one; brand tokens are read locally for deterministic rendering."
          : args.provider
            ? `provider "${args.provider}" could not resolve ${type}: "${intent}"${localOnly ? " (--local-only skips network providers; drop it or the --provider override)" : ""}`
            : `no provider could resolve ${type}: "${intent}"`;
    if (args.json) {
      console.log(
        JSON.stringify({
          ok: false,
          ...(providerFailure instanceof BundledSfxAssetsError
            ? { code: providerFailure.code, fix: providerFailure.fix }
            : {}),
          error: msg,
        }),
      );
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
      // heygenAuthMethodFor spreads first so an explicit authMethod on a
      // future provider's own metadata.provenance can still override it below
      // -- safe today (no provider sets authMethod itself), but keep this
      // ordering if that ever changes.
      ...heygenAuthMethodFor(searchResult.metadata?.provider),
      ...searchResult.metadata?.provenance,
    },
  };

  const heygenRemediation = consumeHeygenRemediation();
  if (
    searchResult.metadata?.provider === "bundled.sfx" &&
    !localOnly &&
    !args.provider &&
    heygenRemediation
  ) {
    record.advisory = heygenRemediation;
  }

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

function mergeSmartAdjust(block) {
  if (!args.for) return block;
  const mediaPath = resolve(args.for);
  // Clear upfront error beats an ffmpeg "No such file" stack on a typo'd path.
  if (!existsSync(mediaPath)) throw new Error(`--for file not found: ${mediaPath}`);
  const analysis = analyzeMediaGrade(mediaPath);
  console.error(formatMeasuredNote(mediaPath, analysis.measured));
  return {
    ...block,
    adjust: {
      ...(block.adjust || {}),
      ...analysis.adjust,
    },
  };
}

function freezeGeneratedLut(
  params,
  {
    projectDir,
    type,
    description = "parametric color grade",
    validationErrorPrefix = "generated LUT failed validation",
  },
) {
  const { id, localPath } = allocateId(projectDir, type, ".cube");
  const fullPath = join(projectDir, localPath);
  const tmpPath = `${fullPath}.tmp`;
  try {
    // Write + validate at .tmp, then atomic rename, so a crash between write and
    // validate can't leave an invalid .cube at the final path.
    writeFileSync(tmpPath, buildCube(params));
    const check = validateCubeFile(tmpPath);
    if (!check.ok) throw new Error(check.error);
    renameSync(tmpPath, fullPath);
  } catch (err) {
    rmSync(tmpPath, { force: true });
    throw new Error(`${validationErrorPrefix}: ${err.message}`);
  }
  return {
    id,
    localPath,
    fullPath,
    lut: { src: localPath, intensity: 1 },
    source: "generated",
    description,
    metadata: {
      provider: "cube_lut.builder",
      provenance: { params },
    },
  };
}

function exitError(message, status = 1) {
  if (args.json) {
    console.log(JSON.stringify({ ok: false, error: message }));
  } else {
    console.error(`error: ${message}`);
  }
  process.exit(status);
}

function parseExplicitParams() {
  try {
    return JSON.parse(args.params);
  } catch (err) {
    throw new Error(`invalid --params JSON: ${err.message}`);
  }
}

async function runParams() {
  if (type === "lut" && args.for) {
    throw new Error("--for is only supported with --type grade");
  }
  const params = parseExplicitParams();
  const description =
    typeof intent === "string" && intent.trim()
      ? intent.trim()
      : `custom parametric ${type === "lut" ? "lut" : "grade"}`;
  const frozen = freezeGeneratedLut(params, {
    projectDir,
    type,
    description,
    validationErrorPrefix: "--params produced an invalid LUT",
  });
  const record = {
    id: frozen.id,
    type,
    path: frozen.localPath,
    source: frozen.source,
    description: frozen.description,
    ...(type === "grade" && { grading: mergeSmartAdjust({ intensity: 1, lut: frozen.lut }) }),
    provenance: {
      provider: frozen.metadata.provider,
      ...frozen.metadata.provenance,
    },
  };
  return finalizeColorRecord(record, frozen.source, frozen.fullPath);
}

async function finalizeColorRecord(record, source, fullPath = null) {
  appendRecord(projectDir, record);
  regenerateIndex(projectDir);
  if (fullPath) {
    try {
      cachePut(fullPath, record);
    } catch {
      // promotion is best-effort
    }
  }
  return result(record, source);
}

async function colorMiss(type, intent) {
  await track("media_use_resolve_miss", {
    type,
    local_only: !!args["local-only"],
    provider_override: !!args.provider,
  });
  recordMiss({
    type,
    intent,
    provider_override: !!args.provider,
    local_only: !!args["local-only"],
  });
  const msg = `no local color grade could resolve ${type}: "${intent}"`;
  if (args.json) {
    console.log(JSON.stringify({ ok: false, error: msg }));
  } else {
    console.error(`error: ${msg}`);
  }
  process.exit(1);
}

async function resolveGrade(intent, { projectDir }) {
  const match = matchColorLook(intent);
  if (match?.kind === "preset") {
    const id = nextId(projectDir, "grade");
    const grading = mergeSmartAdjust({ preset: match.preset, intensity: 1 });
    const record = {
      id,
      type: "grade",
      source: "preset",
      description: intent,
      grading,
      provenance: {
        provider: "color_grade.local",
        prompt: intent,
        preset: match.preset,
      },
    };
    return finalizeColorRecord(record, "preset");
  }

  if (match?.kind === "library") {
    let frozen;
    try {
      frozen = await freezeLibraryLut(match, {
        projectDir,
        type: "grade",
        localOnly: args["local-only"],
      });
    } catch (err) {
      if (isLibraryLutOfflineMiss(err)) return colorMiss("grade", intent);
      throw err;
    }
    const grading = mergeSmartAdjust({ intensity: 1, lut: frozen.lut });
    const record = {
      id: frozen.id,
      type: "grade",
      path: frozen.localPath,
      source: frozen.source,
      description: frozen.description,
      grading,
      provenance: {
        provider: frozen.metadata.provider,
        prompt: intent,
        ...frozen.metadata.provenance,
      },
    };
    return finalizeColorRecord(record, frozen.source, frozen.fullPath);
  }

  const params = paramsFromIntent(intent);
  if (!params) {
    // No creative look matched. With --for, the measured adjust block is a
    // valid grade on its own (footage auto-correction); only a true miss
    // (no look AND no analysis) aborts.
    if (args.for) {
      const grading = mergeSmartAdjust({ intensity: 1 });
      const record = {
        id: nextId(projectDir, "grade"),
        type: "grade",
        source: "measured",
        description: intent,
        grading,
        provenance: { provider: "color_grade.local", prompt: intent, measured: true },
      };
      return finalizeColorRecord(record, "measured");
    }
    return colorMiss("grade", intent);
  }
  const frozen = freezeGeneratedLut(params, { projectDir, type: "grade" });
  const grading = mergeSmartAdjust({ intensity: 1, lut: frozen.lut });
  const record = {
    id: frozen.id,
    type: "grade",
    path: frozen.localPath,
    source: frozen.source,
    description: intent,
    grading,
    provenance: {
      provider: frozen.metadata.provider,
      prompt: intent,
      ...frozen.metadata.provenance,
    },
  };
  return finalizeColorRecord(record, frozen.source, frozen.fullPath);
}

async function resolveLut(intent, { projectDir }) {
  if (args.for) {
    throw new Error("--for is only supported with --type grade");
  }
  const match = matchColorLook(intent);
  if (match?.kind === "library") {
    let frozen;
    try {
      frozen = await freezeLibraryLut(match, {
        projectDir,
        type: "lut",
        localOnly: args["local-only"],
      });
    } catch (err) {
      if (isLibraryLutOfflineMiss(err)) return colorMiss("lut", intent);
      throw err;
    }
    const record = {
      id: frozen.id,
      type: "lut",
      path: frozen.localPath,
      source: frozen.source,
      description: frozen.description,
      provenance: {
        provider: frozen.metadata.provider,
        prompt: intent,
        ...frozen.metadata.provenance,
      },
    };
    return finalizeColorRecord(record, frozen.source, frozen.fullPath);
  }

  const params = paramsFromIntent(intent);
  if (!params) return colorMiss("lut", intent);
  const frozen = freezeGeneratedLut(params, { projectDir, type: "lut" });
  const record = {
    id: frozen.id,
    type: "lut",
    path: frozen.localPath,
    source: frozen.source,
    description: intent,
    provenance: {
      provider: frozen.metadata.provider,
      prompt: intent,
      ...frozen.metadata.provenance,
    },
  };
  return finalizeColorRecord(record, frozen.source, frozen.fullPath);
}

async function resolveColor(type, intent, options) {
  if (type === "grade") return resolveGrade(intent, options);
  return resolveLut(intent, options);
}

async function ingest(src) {
  if (!type || !INGEST_TYPES.includes(type)) {
    console.error(`error: --from requires --type (one of: ${INGEST_TYPES.join(", ")})`);
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
  if (type === "lut" || type === "grade") {
    try {
      const check = validateCubeFile(fullPath);
      if (!check.ok) throw new Error(check.error);
    } catch (err) {
      rmSync(fullPath, { force: true });
      exitError(`ingested LUT is invalid: ${err.message}`, 1);
    }
  }
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

// Best-effort latest stable CLI tag from the CDN (the install script's source of
// truth). null on any failure (offline, no curl) — treated as "unknown", never fatal.
function latestHeygenStable() {
  const probe = runCommand("curl", [
    "-fsSL",
    "--max-time",
    "4",
    "https://static.heygen.ai/cli/stable",
  ]);
  return probe.status === 0 ? firstSemver(commandText(probe)) : null;
}

function heygenAuthCheck() {
  // `heygen auth status` already emits JSON by default (only `--human` opts out
  // to a table) — there is no `--json`/`--output` flag; passing one errors with
  // "unknown flag". emailFromAuthStatus parses that default JSON.
  // NOTE: JSON-by-default is a v0.3.0 behavior — this probe assumes it, which
  // HEYGEN_MIN_VERSION >= 0.3.0 (+ the version gate above) guarantees. If that
  // floor is ever lowered, auth detection on an older CLI would silently break.
  const authProbe = runCommand("heygen", ["auth", "status"]);
  // spawnSync sets .error/.signal on a timeout or spawn failure (status then
  // null). A stalled auth endpoint (transient network/DNS) must not be reported
  // as an authoritative "not authenticated" with a re-login fix.
  const timedOut = authProbe.error?.code === "ETIMEDOUT" || authProbe.signal != null;
  const email = authProbe.status === 0 ? emailFromAuthStatus(commandText(authProbe)) : null;
  return {
    name: "heygen authenticated",
    ok: !!email,
    detail: email
      ? `heygen authenticated as ${email}`
      : timedOut
        ? "heygen auth status timed out — possible network issue, not proof of sign-out"
        : "heygen not authenticated",
    fix: email ? "" : timedOut ? "check network, then re-run --doctor" : HEYGEN_AUTH_COMMAND,
  };
}

function runDoctor() {
  const checks = [];
  const bundledSfx = inspectBundledSfxAssets();
  checks.push({
    name: "bundled SFX assets",
    ok: bundledSfx.ok,
    detail: bundledSfx.detail,
    fix: bundledSfx.fix,
  });
  const heygenVersionProbe = runCommand("heygen", ["--version"]);
  const heygenOnPath = heygenVersionProbe.status === 0;
  const heygenVersionText = commandText(heygenVersionProbe);
  const heygenVersion = firstSemver(heygenVersionText);

  checks.push({
    name: "heygen on PATH",
    ok: heygenOnPath,
    // Just "is the binary here" — the version row below owns the version string,
    // so this row must not also render `heygen v0.3.0` (two byte-identical lines).
    detail: heygenOnPath ? "heygen found on PATH" : "heygen not found",
    fix: heygenOnPath ? "" : HEYGEN_INSTALL_COMMAND,
  });

  if (!heygenOnPath) {
    checks.push({
      name: "heygen version",
      ok: false,
      detail: "heygen version unavailable",
      fix: HEYGEN_INSTALL_COMMAND,
    });
    checks.push({
      name: "heygen authenticated",
      ok: false,
      detail: "heygen auth status unavailable",
      fix: HEYGEN_INSTALL_COMMAND,
    });
  } else if (heygenVersion) {
    const versionOk = !versionLessThan(heygenVersion, HEYGEN_MIN_VERSION);
    // Keep it latest: even when the installed version clears the floor, nudge
    // `heygen update` if a newer stable exists. Best-effort — silently skipped
    // when the CDN is unreachable, so it never blocks the check.
    const latest = versionOk ? latestHeygenStable() : null;
    const behind = latest && versionLessThan(heygenVersion, latest);
    checks.push({
      name: "heygen version",
      ok: versionOk,
      detail: versionOk
        ? `heygen v${heygenVersion}${behind ? ` (latest v${latest} available)` : ""}`
        : `heygen v${heygenVersion} (need >= v${HEYGEN_MIN_VERSION})`,
      fix: versionOk ? (behind ? HEYGEN_UPDATE_COMMAND : "") : HEYGEN_UPDATE_COMMAND,
    });

    // Below the OAuth-capable floor the auth probe fails for the SAME root cause
    // (an old CLI can't OAuth and doesn't emit JSON auth status), which would
    // read as a confusing second "not authenticated" error. Skip it — one root
    // cause, one fix.
    checks.push(
      versionOk
        ? heygenAuthCheck()
        : {
            name: "heygen authenticated",
            ok: false,
            detail: "skipped — update heygen first",
            fix: HEYGEN_UPDATE_COMMAND,
          },
    );
  } else {
    // Fail-open: heygen ran but printed no semver (dev/stripped build). We can't
    // verify the version, so we don't block on it — but say so rather than a bare
    // green check that implies a real version comparison happened.
    checks.push({
      name: "heygen version",
      ok: true,
      detail: "heygen present; version unverifiable (no semver in --version output)",
      fix: "",
    });

    checks.push(heygenAuthCheck());
  }

  const ffmpegProbe = runCommand("ffmpeg", ["-version"]);
  checks.push({
    name: "ffmpeg on PATH",
    ok: ffmpegProbe.status === 0,
    detail: ffmpegProbe.status === 0 ? firstLine(ffmpegProbe.stdout) : "ffmpeg not found",
    fix: ffmpegProbe.status === 0 ? "" : "brew install ffmpeg",
  });

  const ffprobeProbe = runCommand("ffprobe", ["-version"]);
  checks.push({
    name: "ffprobe on PATH",
    ok: ffprobeProbe.status === 0,
    detail: ffprobeProbe.status === 0 ? firstLine(ffprobeProbe.stdout) : "ffprobe not found",
    fix: ffprobeProbe.status === 0 ? "" : "brew install ffmpeg",
  });

  const nodeOk = !versionLessThan(process.versions.node, MIN_NODE_VERSION);
  checks.push({
    name: "node version",
    ok: nodeOk,
    detail: `${process.version} (need >= v${MIN_NODE_VERSION})`,
    fix: nodeOk ? "" : `upgrade Node to >= v${MIN_NODE_VERSION}`,
  });

  // ffmpeg AND ffprobe are both strictly required (see SKILL.md); the exit code
  // must reflect that so a script gating on `--doctor` doesn't pass with ffprobe
  // missing and then break at the first probe call.
  const ffmpeg = checks.find((check) => check.name === "ffmpeg on PATH");
  const ffprobe = checks.find((check) => check.name === "ffprobe on PATH");
  return { ok: bundledSfx.ok && !!ffmpeg?.ok && !!ffprobe?.ok, checks };
}

function printDoctor(checks) {
  const heygenChecks = new Set(["heygen on PATH", "heygen version", "heygen authenticated"]);
  for (const check of checks) {
    const prefix = check.ok ? "✓" : "✗";
    const freePath = heygenChecks.has(check.name)
      ? " — free-usage path: bgm/image/voice/avatar-video"
      : "";
    const fix = check.ok || !check.fix ? "" : ` — fix: ${check.fix}`;
    console.log(`${prefix} ${check.detail}${freePath}${fix}`);
  }
}

function printStats(report) {
  console.log("media-use stats");
  console.log(`total resolves: ${report.total_resolves}`);
  console.log(`misses: ${report.misses}`);
  console.log(
    `hit rate: ${report.hit_rate == null ? "n/a" : `${Math.round(report.hit_rate * 100)}%`}`,
  );
  printMap("by type", report.by_type);
  printMap("by source", report.by_source);
  printMap("by provider", report.by_provider);
  printMap("by via", report.by_via);
  console.log(`global cache assets: ${report.global_cache_assets}`);
  console.log(`global cache disk: ${report.global_cache_disk_bytes} bytes`);
  console.log(`cross-project reuse: ${report.cross_project_reuse}`);
  console.log("top missed intents:");
  const entries = Object.entries(report.top_missed_intents);
  if (entries.length === 0) {
    console.log("  none");
    return;
  }
  for (const [type, misses] of entries) {
    console.log(`  ${type}:`);
    for (const miss of misses) console.log(`    ${miss.count}  ${miss.intent}`);
  }
}

function printMap(label, values) {
  const entries = Object.entries(values);
  console.log(`${label}:`);
  if (entries.length === 0) {
    console.log("  none");
    return;
  }
  for (const [key, value] of entries) console.log(`  ${key}: ${value}`);
}

function runCommand(bin, argv) {
  return spawnSync(bin, argv, {
    encoding: "utf8",
    timeout: 15000,
  });
}

function commandText(result) {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function firstLine(text) {
  return (
    String(text || "")
      .trim()
      .split(/\r?\n/)[0] || ""
  );
}

function emailFromAuthStatus(text) {
  // JSON only (auth status emits JSON by default). No prose regex fallback: a
  // human-format body like "Session expired. Contact support@heygen.ai" would
  // otherwise report the user as authenticated as support@heygen.ai.
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed?.data?.email || parsed?.email || null;
  } catch {
    return null;
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
  const imported = localizeImportedRecord(
    importFromCache(rec, projectDir, id, localPath),
    localPath,
  );
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
    // How a library LUT resolved: "url" (CDN), "params-fallback" (CDN failed →
    // parametric), or "params" (offline). Surfaces silent CDN→params downgrades
    // in prod, which --doctor can't (it only answers "reachable now?").
    via: record.provenance?.via,
    // Free (OAuth) vs. paid (API-key) heygen path — sparse: absent for every
    // non-heygen provider (see heygenAuthMethodFor at construction time). On a
    // cache/reuse hit this reports how the asset was ORIGINALLY fetched, not
    // this resolve's own credential state — intentional: it's a conversion
    // signal about the fetch that actually consumed a heygen credit, not
    // about the (free, no-credential) act of copying a cached file.
    auth_method: record.provenance?.authMethod,
    local_only: !!args["local-only"],
    provider_override: !!args.provider,
  });
  if (args.json) {
    const grading = record.type === "grade" && record.grading ? record.grading : null;
    console.log(
      JSON.stringify({
        ok: true,
        ...record,
        ...(grading || {}),
        ...(grading && { grading }),
        _source: source,
      }),
    );
  } else {
    const meta = formatMeta(record, source);
    console.log(`resolved ${record.id} → ${record.path || "inline"} (${meta})`);
  }
}

function formatMeta(record, source) {
  const parts = [record.type];
  if (record.grading?.preset) parts.push(`preset ${record.grading.preset}`);
  if (record.grading?.lut) parts.push("lut");
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
