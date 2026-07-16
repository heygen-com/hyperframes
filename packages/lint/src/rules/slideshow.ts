import type { LintContext, HyperframeLintFinding } from "../context";
import type { LintRule } from "../types";
import { readAttr, readDecodedAttr } from "../utils";
import {
  parseSlideshowManifest,
  resolveSlideshow,
  isSceneLikeCompositionId,
} from "@hyperframes/parsers/slideshow";

type Scene = { id: string; start: number; duration: number };

function parseTiming(raw: string): { start: number; duration: number } | null {
  const startStr = readAttr(raw, "data-start");
  if (startStr === null) return null;
  const start = Number(startStr);
  if (!Number.isFinite(start)) return null;

  const durationStr = readAttr(raw, "data-duration");
  if (durationStr !== null) {
    const duration = Number(durationStr);
    if (Number.isFinite(duration)) return { start, duration };
  }
  const endStr = readAttr(raw, "data-end") ?? readAttr(raw, "data-hf-authored-end");
  if (endStr !== null) {
    const end = Number(endStr);
    if (Number.isFinite(end) && end > start) return { start, duration: end - start };
  }
  return null;
}

function collectCompositionIdScenes(ctx: LintContext, seen: Set<string>, out: Scene[]): void {
  for (const tag of ctx.tags) {
    const compositionId = readDecodedAttr(tag.raw, "data-composition-id");
    if (!compositionId || !isSceneLikeCompositionId(compositionId) || seen.has(compositionId))
      continue;
    const timing = parseTiming(tag.raw);
    if (!timing || timing.duration <= 0) continue;
    seen.add(compositionId);
    out.push({ id: compositionId, ...timing });
  }
}

function extractScenesFromClips(ctx: LintContext): Scene[] {
  const seen = new Set<string>();
  const scenes: Scene[] = [];
  collectCompositionIdScenes(ctx, seen, scenes);
  return scenes;
}

export const slideshowRules: LintRule<LintContext>[] = [
  (ctx) => {
    const findings: HyperframeLintFinding[] = [];

    let manifest;
    try {
      manifest = parseSlideshowManifest(ctx.source);
    } catch (e) {
      findings.push({
        code: "slideshow_invalid",
        severity: "error",
        message: `Slideshow island contains invalid JSON or structure: ${e instanceof Error ? e.message : String(e)}`,
        fixHint:
          'Ensure the <script type="application/hyperframes-slideshow+json"> block contains valid JSON matching the SlideshowManifest schema.',
      });
      return findings;
    }

    if (!manifest) return findings;

    const scenes = extractScenesFromClips(ctx);
    const { errors } = resolveSlideshow(manifest, scenes);

    for (const error of errors) {
      findings.push({
        code: "slideshow_unresolved_ref",
        severity: "error",
        message: `Slideshow manifest error: ${error}`,
        fixHint:
          "Ensure every sceneId in the slideshow island matches the data-composition-id of a scene element in the composition, or provide explicit startTime/endTime.",
      });
    }

    return findings;
  },
];
