import { createRequire } from "node:module";
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

const UNKNOWN_VERSION = "0.0.0-dev";

function readEngineVersion(): string {
  try {
    // The engine ships as raw TS and exports "./package.json", so this
    // resolves without a build-time define. A failed read must never break a
    // render, hence the fallback rather than a throw.
    const version = (createRequire(import.meta.url)("../../package.json") as { version?: string })
      .version;
    return typeof version === "string" && version.length > 0 ? version : UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
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
