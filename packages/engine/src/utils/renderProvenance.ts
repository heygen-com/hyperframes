import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTagCI } from "./ffprobe.js";

/**
 * Hidden render provenance.
 *
 * HyperFrames stamps the *container* — never the picture — with the renderer
 * name and version, so a rendered file carries a machine-readable note about
 * what produced it, with no visible watermark burned into the frames.
 *
 * What goes in is deliberately boring: renderer name and version. No file
 * paths, usernames, machine names, project names or composition content. Once
 * a file is distributed the metadata travels with it, and metadata leaks are
 * hard to walk back.
 *
 * **An unauthenticated hint — not an authenticity or attribution boundary.**
 * These are ordinary unsigned container keys that any tool can write, so a
 * present tag means the file *claims* to be HyperFrames output, not that
 * HyperFrames produced it: one `ffmpeg -metadata hyperframes_renderer=...`
 * forges it. Absence proves just as little, since re-encoding, remuxing, or
 * any tool that drops unknown keys strips them, and files rendered before this
 * feature never had them. Good for diagnostics and support ("what wrote this
 * file?"); never a basis for trust, attribution or licensing decisions in
 * either direction. Verifiable provenance needs signed claims (C2PA), which
 * this deliberately is not.
 */

export const PROVENANCE_RENDERER_TAG = "hyperframes_renderer";
export const PROVENANCE_VERSION_TAG = "hyperframes_version";
export const PROVENANCE_RENDERER_NAME = "hyperframes";

/**
 * Deliberately not semver-shaped. A failed lookup must never break a render,
 * but it must never be readable as a measurement either: the previous
 * "0.0.0-dev" parses as a version, compares against one, and sorts below every
 * real release, so a total resolution failure looked exactly like a dev build.
 * It survived unnoticed across twenty published versions for that reason.
 */
/**
 * Exported so a caller that GATES on the version compares against this rather
 * than re-typing the literal: a second copy of the sentinel is a second thing
 * to keep in step, and the whole point of the value is that it must never be
 * mistaken for a version.
 */
export const UNRESOLVED_VERSION = "unresolved";

/** The package this file belongs to, whether built standalone or bundled. */
const OWN_PACKAGE_NAME = /^(?:hyperframes|@hyperframes\/[^/]+)$/;

/** Depth cap: a package root is a handful of levels up, never tens. */
const MAX_WALK_DEPTH = 12;

/**
 * The walk, separated from `import.meta.url` so it is testable against real
 * fixture layouts. A guard that cannot be exercised is a guard nobody has
 * checked, and the name match below is the part worth exercising.
 *
 * @param startDir directory to begin from; the search moves upward.
 */
export function resolveOwnVersionFrom(startDir: string): string {
  // Resolve by WALKING UP to our own package root, not by a fixed relative
  // path, because this code runs from two different layouts and no single
  // literal is correct in both:
  //
  //   repo      packages/engine/src/utils/  + ../../  -> packages/engine/package.json  OK
  //   published <pkg>/dist/cli.js           + ../../  -> node_modules/package.json     overshoots
  //
  // The published CLI bundles the engine, so the file that actually runs sits
  // at <pkg>/dist/, one level shallower than the source. The old code used the
  // repo-correct path, missed in the published artifact, and its catch turned
  // that miss into a sentinel.
  //
  // THE NAME CHECK IS THE FIX, NOT A REFINEMENT. A bare "first package.json
  // found while walking up" resolves to whatever happens to sit above us in a
  // hoisted install and returns a confident wrong version - the same class of
  // defect as the sentinel, and harder to notice because the answer looks
  // plausible. Only a package.json whose own name is ours may answer.
  let dir = startDir;

  for (let depth = 0; depth < MAX_WALK_DEPTH; depth++) {
    const candidate = join(dir, "package.json");
    let pkg: { name?: unknown; version?: unknown } | undefined;
    try {
      pkg = JSON.parse(readFileSync(candidate, "utf8")) as typeof pkg;
    } catch {
      // No package.json here, or unreadable/malformed. Either way this
      // directory cannot answer; keep walking rather than give up, so one
      // stray file between us and our root is not fatal.
      pkg = undefined;
    }
    if (pkg && typeof pkg.name === "string" && OWN_PACKAGE_NAME.test(pkg.name)) {
      if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
      // Our package root, but no usable version. Stop: walking past it would
      // only find someone else's.
      reportUnresolved(`found ${pkg.name} at ${candidate} but it declares no version`);
      return UNRESOLVED_VERSION;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  reportUnresolved(`no package.json matching ${OWN_PACKAGE_NAME} within ${MAX_WALK_DEPTH} levels`);
  return UNRESOLVED_VERSION;
}

/**
 * Make the failure audible. The point of this change is that a resolution
 * failure stops being indistinguishable from data - a silent fallback is what
 * let the previous sentinel ship unnoticed.
 */
function reportUnresolved(reason: string): void {
  console.warn(
    `[renderProvenance] could not resolve the engine version (${reason}); ` +
      `stamping ${PROVENANCE_VERSION_TAG}="${UNRESOLVED_VERSION}". ` +
      `This is a lookup failure, not a version - do not treat it as one.`,
  );
}

function readEngineVersion(): string {
  try {
    return resolveOwnVersionFrom(dirname(fileURLToPath(import.meta.url)));
  } catch {
    reportUnresolved("import.meta.url is not a file URL");
    return UNRESOLVED_VERSION;
  }
}

export const PROVENANCE_VERSION = readEngineVersion();

/**
 * MP4/MOV (the mov muxer family) writes only tags it recognises from a fixed
 * map and silently discards everything else. WebM/Matroska keeps arbitrary
 * keys as-is.
 */
function isMovFamilyContainer(outputPath: string): boolean {
  const lower = outputPath.toLowerCase();
  return lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".m4v");
}

/**
 * The provenance ffmpeg arguments for a given output container. Place them
 * before the output path.
 *
 * Must be applied on *every* stage that writes an mp4 — encode, mux and the
 * faststart remux each run their own ffmpeg, and a stage without the flag
 * drops the tags written by the stage before it.
 */
export function renderProvenanceArgs(outputPath: string): string[] {
  const args = [
    "-metadata",
    `${PROVENANCE_RENDERER_TAG}=${PROVENANCE_RENDERER_NAME}`,
    "-metadata",
    `${PROVENANCE_VERSION_TAG}=${PROVENANCE_VERSION}`,
  ];

  if (isMovFamilyContainer(outputPath)) {
    // The additive `+` form is mandatory. A bare `-movflags use_metadata_tags`
    // *resets* the flag field, silently discarding a `+faststart` set earlier
    // in the same command — the file still probes fine and keeps its tags,
    // but the moov atom lands at the end and progressive playback regresses.
    args.push("-movflags", "+use_metadata_tags");
  }
  return args;
}

/** Mutating form of {@link renderProvenanceArgs} for push-built arg lists. */
export function appendRenderProvenanceArgs(args: string[], outputPath: string): void {
  args.push(...renderProvenanceArgs(outputPath));
}

export interface RenderProvenance {
  renderer: string;
  /** Empty string when the renderer tag is present but the version is not. */
  version: string;
}

/**
 * Read provenance back from ffprobe format tags. Matroska uppercases keys on
 * read while mp4 preserves the case written, so the lookup is
 * case-insensitive — a case-sensitive read works on mp4 and misses every webm.
 */
export function readRenderProvenance(
  tags: Record<string, string | undefined> | undefined,
): RenderProvenance | null {
  const renderer = readTagCI(tags, PROVENANCE_RENDERER_TAG);
  if (renderer === "") return null;
  return { renderer, version: readTagCI(tags, PROVENANCE_VERSION_TAG) };
}
