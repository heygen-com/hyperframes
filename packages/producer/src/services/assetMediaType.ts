import { existsSync } from "node:fs";
import {
  fingerprintElementId,
  isNotMediaPayload,
  NotMediaPayloadError,
  probeMediaProfile,
  resolveProjectRelativeSrc,
  type AudioElement,
  type ImageElement,
  type MediaProbeProfile,
  type VideoElement,
} from "@hyperframes/engine";
import { withMediaProbeSlot } from "../utils/mediaProbeConcurrency.js";

export const ASSET_MEDIA_TYPE_MISMATCH = "ASSET_MEDIA_TYPE_MISMATCH" as const;

export type AssetElementMediaType = "audio" | "image" | "video";
export type DetectedAssetMediaType = AssetElementMediaType | "unknown";

export interface AssetMediaTypeMismatch {
  expected: AssetElementMediaType;
  detected: DetectedAssetMediaType;
  /** Stable, bounded correlation key. Never the raw element id or source. */
  elementFingerprint: string;
}

export class AssetMediaTypeMismatchError extends Error {
  readonly code = ASSET_MEDIA_TYPE_MISMATCH;
  readonly owner = "user" as const;
  readonly retryable = false as const;
  readonly mismatches: readonly AssetMediaTypeMismatch[];

  constructor(mismatches: readonly AssetMediaTypeMismatch[]) {
    const expectedKinds = [...new Set(mismatches.map((item) => item.expected))].sort().join(",");
    super(
      `${mismatches.length} composition asset(s) do not match their authored media element type` +
        (expectedKinds ? ` (expected: ${expectedKinds})` : ""),
    );
    this.name = "AssetMediaTypeMismatchError";
    this.mismatches = mismatches;
  }
}

function detectedAssetMediaType(profile: MediaProbeProfile): DetectedAssetMediaType {
  if (profile.visualKind === "moving") return "video";
  if (profile.visualKind === "still") return "image";
  if (profile.hasAudioStream) return "audio";
  return "unknown";
}

function mediaProfileMatchesElementType(
  expected: AssetElementMediaType,
  profile: MediaProbeProfile,
): boolean {
  if (expected === "audio") return profile.hasAudioStream;
  if (expected === "image") return profile.visualKind === "still";
  return profile.visualKind === "moving";
}

export function assertAssetMediaTypeProfile(
  expected: AssetElementMediaType,
  profile: MediaProbeProfile,
  elementIdentity: string,
): void {
  if (mediaProfileMatchesElementType(expected, profile)) return;
  throw new AssetMediaTypeMismatchError([
    {
      expected,
      detected: detectedAssetMediaType(profile),
      elementFingerprint: fingerprintElementId(elementIdentity),
    },
  ]);
}

interface CompositionMediaAssets {
  videos: readonly VideoElement[];
  audios: readonly AudioElement[];
  images: readonly ImageElement[];
}

interface MediaReference {
  id: string;
  src: string;
  expected: AssetElementMediaType;
}

function isRemoteOrInlineSource(src: string): boolean {
  return /^(?:https?:|data:|blob:|about:)/i.test(src.trim());
}

/**
 * Fail early when a successfully-probed local asset cannot satisfy the HTML
 * element that owns it. Missing, corrupt, remote-at-runtime, and unprobeable
 * inputs deliberately remain untouched so their existing source/download/
 * invalid-media classification is preserved downstream.
 */
export async function preflightCompositionAssetMediaTypes(input: {
  projectDir: string;
  compiledDir: string;
  composition: CompositionMediaAssets;
  signal?: AbortSignal;
}): Promise<void> {
  const references: MediaReference[] = [
    ...input.composition.videos.map((asset) => ({
      id: asset.id,
      src: asset.src,
      expected: "video" as const,
    })),
    ...input.composition.audios.map((asset) => ({
      id: asset.id,
      src: asset.src,
      expected: "audio" as const,
    })),
    ...input.composition.images.map((asset) => ({
      id: asset.id,
      src: asset.src,
      expected: "image" as const,
    })),
  ];

  const byPath = new Map<string, MediaReference[]>();
  for (const reference of references) {
    if (!reference.src || isRemoteOrInlineSource(reference.src)) continue;
    const resolvedPath = resolveProjectRelativeSrc(
      reference.src,
      input.projectDir,
      input.compiledDir,
    );
    if (!existsSync(resolvedPath)) continue;
    byPath.set(resolvedPath, [...(byPath.get(resolvedPath) ?? []), reference]);
  }

  const mismatches: AssetMediaTypeMismatch[] = [];
  const notMediaFingerprints: string[] = [];
  const entries = [...byPath];
  await Promise.all(
    entries.map(([resolvedPath, pathReferences]) =>
      withMediaProbeSlot(async () => {
        // STUDIO-5433. This preflight is the only place every local media src is
        // seen regardless of its authored timing, so it is where a document
        // payload behind a `data-end` video gets caught — the compiler's own
        // sniff only runs for elements whose duration it has to resolve.
        //
        // Video only, deliberately. An `<img>` may legitimately be an SVG,
        // which ffprobe reads through its `svg_pipe` demuxer. And a bad audio
        // source is non-fatal by existing policy (audioStage ships the render
        // without the track and reports `audioError`), so it is classified
        // per-element in audioMixer instead of aborted here.
        const sniffableReferences = pathReferences.filter((ref) => ref.expected === "video");
        if (sniffableReferences.length > 0 && (await isNotMediaPayload(resolvedPath))) {
          notMediaFingerprints.push(
            ...sniffableReferences.map((ref) => fingerprintElementId(ref.id)),
          );
          return;
        }

        let profile: MediaProbeProfile;
        try {
          profile = await probeMediaProfile(resolvedPath, { signal: input.signal });
        } catch (error) {
          if (input.signal?.aborted) throw input.signal.reason ?? error;
          return;
        }
        for (const reference of pathReferences) {
          if (mediaProfileMatchesElementType(reference.expected, profile)) continue;
          mismatches.push({
            expected: reference.expected,
            detected: detectedAssetMediaType(profile),
            elementFingerprint: fingerprintElementId(reference.id),
          });
        }
      }),
    ),
  );

  // Thrown ahead of the mismatch aggregate: "this file is an HTML page" is the
  // actionable diagnosis, while the type mismatch it also produces is a symptom.
  if (notMediaFingerprints.length > 0) throw new NotMediaPayloadError(notMediaFingerprints);
  if (mismatches.length > 0) throw new AssetMediaTypeMismatchError(mismatches);
}
