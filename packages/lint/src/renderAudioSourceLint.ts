import { parseHTML } from "linkedom";
import { parseNumeric } from "@hyperframes/parsers/composition-contract";
import { querySelectorAllIncludingTemplates } from "./domQuery.js";
import type { HyperframeLintFinding } from "./types.js";
import {
  resolveLocalMediaCandidate,
  type HtmlSourceLike,
  type MediaStreamProbeResults,
} from "./mediaStreamProbe.js";

/** One element the render will probe for an audio stream. */
export interface RenderAudioSource {
  tag: "audio" | "video";
  elementId: string;
  /** The authored src as written (display value), not the resolved path. */
  src: string;
  /**
   * `<video>` only (always false for `<audio>`): whether `data-has-audio="true"`
   * is authored. A `<video>` with this false is still in the mixer's set: the
   * timing compiler marks every unmuted `<video>` audible (`timingCompiler.ts`
   * compileTag step 2).
   */
  declaredHasAudio: boolean;
}

/**
 * Parent `src`, else a descendant `<source src>`, preferring a local path over
 * http(s) so a localized sibling wins. Mirrors the engine's
 * `resolveMediaElementSrc` (packages/engine/src/services/videoFrameExtractor.ts).
 * The lint package cannot import the engine (dependency cycle), and lint's own
 * `mediaHasResolvableSrc` (rules/media.ts) reads regex `OpenTag` tokens rather
 * than DOM elements, so this rule carries its own DOM copy.
 */
function resolveMediaElementSrc(el: Element): string | null {
  const direct = el.getAttribute("src");
  if (direct) return direct;
  let remote: string | null = null;
  for (const source of el.querySelectorAll("source")) {
    const src = source.getAttribute("src");
    if (!src) continue;
    if (!/^https?:\/\//i.test(src)) return src;
    remote ??= src;
  }
  return remote;
}

/**
 * Mirrors the engine's `isKnownInactiveTimelineWindow` (data-duration <= 0, or
 * data-end at/before the resolved start). The engine resolves a relative
 * `data-start` ("intro + 2") against the whole composition; lint cannot, so
 * when the answer depends on such a start the element is treated as unknown
 * and skipped — this rule must never flag an element the render drops.
 */
function isKnownOrPossiblyInactiveWindow(el: Element): boolean {
  const duration = parseNumeric(el.getAttribute("data-duration"));
  if (duration != null && duration <= 0) return true;
  const end = parseNumeric(el.getAttribute("data-end"));
  if (end == null) return false;
  const startAttr = el.getAttribute("data-start");
  const start = startAttr ? parseNumeric(startAttr) : 0;
  return start == null || end <= start;
}

/**
 * Whether the compile gate probes this `<audio>`. The gate is the producer's
 * `compileHtmlFile` (packages/producer/src/services/htmlCompiler.ts), whose
 * prober calls `assertAssetMediaTypeProfile("audio", …)`; it never looks at
 * `data-hidden`, so a hidden element it probes still fails the render. Both
 * phases keep only elements with their own `src` (a `<source>` child does not
 * count):
 *
 *   Phase 1 (core `compileTimingAttrs` → `compileTag` step 1, then the
 *   producer's "resolve missing durations" filter): no `data-end` and no
 *   parseable `data-duration` — the file is probed to supply the duration.
 *
 *   Phase 2 (core `extractResolvedMedia`, then the producer's `!el.loop`
 *   filter): parseable `data-duration > 0` and no `loop` — the file is probed
 *   to clamp the slot.
 *
 * Everything else — `data-end`-bounded, `loop`ed, `<source>`-only, or
 * `data-duration <= 0` — reaches the render only through the mixer gate.
 *
 * Mirror limit: core reads attributes with a regex that only sees quoted
 * values (`getAttr` in timingCompiler.ts); this reads the DOM, so an unquoted
 * `src=x` or `data-duration=5` is visible here and invisible to the compiler.
 */
function compileGateProbes(el: Element): boolean {
  if (!el.getAttribute("src")) return false;
  const duration = parseNumeric(el.getAttribute("data-duration"));
  if (duration == null) return !el.hasAttribute("data-end");
  return duration > 0 && !el.hasAttribute("loop");
}

/**
 * Whether the mixer (`parseAudioElements`, packages/engine/src/services/
 * audioMixer.ts) picks this `<video>` up as a track. Its selector is
 * `video[id][data-has-audio="true"]`, but it runs on compiled HTML: the timing
 * compiler (packages/core/src/compiler/timingCompiler.ts, `compileTag` step 2)
 * has already injected `data-has-audio="true"` on every unmuted `<video>`
 * lacking the attribute (and `"false"` on a muted one). An authored value
 * always wins over `muted`.
 */
function mixerTreatsVideoAsAudible(el: Element): boolean {
  const declared = el.getAttribute("data-has-audio");
  if (declared != null) return declared === "true";
  return !el.hasAttribute("muted");
}

/**
 * Every element the render will probe for an audio stream, which is the union
 * of two gates in the producer:
 *
 *   1. The compile gate — see `compileGateProbes`. `<audio>` only (it probes
 *      `<video>` as video); ignores `data-hidden`.
 *   2. The mixer/preflight gate (`parseAudioElements` →
 *      `preflightCompositionAssetMediaTypes`): `audio[id]` plus every
 *      `video[id]` the compiled HTML marks `data-has-audio="true"` (see
 *      `mixerTreatsVideoAsAudible`), minus `data-hidden` on the element or an
 *      ancestor, minus members of a hidden `<hf-audio-group>` bus (membership
 *      is the member's `data-audio-group`, so an ancestor walk cannot see it;
 *      audio only in v1), minus known inactive timing windows.
 *
 * So a hidden `<audio src>` bounded by `data-duration`, or with no timing at
 * all, is a candidate (gate 1 rejects it), while a hidden `<audio>` bounded by
 * `data-end`, or `loop`ed, or with only a `<source>` child, is not (gate 1
 * never sees it and gate 2 drops it).
 *
 * Known gaps:
 *   - A sub-composition host that is `data-hidden` only in the parent file.
 *     The mixer's ancestor walk sees that across inlining; a scan of the
 *     sub-composition file on its own cannot, so a `data-end`-bounded silent
 *     `<audio>` inside it is reported although the render would drop it.
 *   - Elements without an `id`. The compiler assigns one (`hf-audio-N`) and
 *     probes them like any other; this rule selects `[id]` so it can name the
 *     element, and leaves the missing id to `media_missing_id`.
 *
 * Each candidate needs a resolvable src (own `src` or a `<source src>`) that is
 * an existing local file — remote and missing files are other rules' business.
 *
 * Returned map: absolute file path -> the authored elements pointing at it,
 * so a file shared by several elements is probed once and every element is
 * named in the findings.
 */
// fallow-ignore-next-line complexity
export function collectRenderAudioCandidates(
  projectDir: string,
  htmlSources: HtmlSourceLike[],
): Map<string, RenderAudioSource[]> {
  const candidates = new Map<string, RenderAudioSource[]>();

  for (const { html, compSrcPath } of htmlSources) {
    const { document } = parseHTML(html);
    const hiddenGroupIds = new Set(
      querySelectorAllIncludingTemplates(document, "hf-audio-group[data-hidden]")
        .map((group) => group.getAttribute("id"))
        .filter((id): id is string => Boolean(id)),
    );

    for (const el of querySelectorAllIncludingTemplates(document, "audio[id], video[id]")) {
      const tag: RenderAudioSource["tag"] =
        el.tagName.toLowerCase() === "audio" ? "audio" : "video";
      const elementId = el.getAttribute("id");
      if (!elementId) continue;
      if (tag === "video" && !mixerTreatsVideoAsAudible(el)) continue;
      // The compile gate probes `<audio>` only; it reads `<video>` as video.
      const probedByCompileGate = tag === "audio" && compileGateProbes(el);
      if (!probedByCompileGate) {
        if (el.closest("[data-hidden]")) continue;
        const groupId = tag === "audio" ? el.getAttribute("data-audio-group") : null;
        if (groupId && hiddenGroupIds.has(groupId)) continue;
        if (isKnownOrPossiblyInactiveWindow(el)) continue;
      }
      const rawSrc = resolveMediaElementSrc(el);
      if (!rawSrc) continue;
      const candidate = resolveLocalMediaCandidate(projectDir, compSrcPath, rawSrc);
      if (!candidate) continue;

      const refs = candidates.get(candidate.resolved) ?? [];
      if (!refs.some((ref) => ref.tag === tag && ref.elementId === elementId)) {
        refs.push({
          tag,
          elementId,
          src: candidate.src,
          declaredHasAudio: tag === "video" && el.getAttribute("data-has-audio") === "true",
        });
      }
      candidates.set(candidate.resolved, refs);
    }
  }

  return candidates;
}

function mismatchFixHint(tag: RenderAudioSource["tag"], declaredHasAudio: boolean): string {
  if (tag === "audio") {
    return "Point the <audio> src at media containing an audio stream, or remove the element if no audio is intended.";
  }
  return declaredHasAudio
    ? 'Remove data-has-audio="true" from a silent <video>, or point it at media containing an audio stream.'
    : "Add muted to a silent <video>, or point it at media containing an audio stream.";
}

/**
 * The probe-backed half of `media_src_kind_mismatch`: the static half in
 * `rules/media.ts` classifies by extension per file; this half classifies the
 * render's audio element set by what ffprobe actually finds on disk, exactly
 * as the producer preflight does (`expected: "audio"` <=> the file has a
 * stream with `codec_type === "audio"`). Same code and severity, because it
 * is the same contract: the tag and the file's kind disagree and the render
 * fail-closes.
 *
 * A file whose probe is unknown (`null`/absent in `probes`) is never reported.
 */
export function lintRenderAudioSourceStreams(
  candidates: ReadonlyMap<string, readonly RenderAudioSource[]>,
  probes: MediaStreamProbeResults,
): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  for (const [filePath, refs] of candidates) {
    const streams = probes.get(filePath);
    if (!streams || streams.some((stream) => stream.codec_type === "audio")) continue;
    for (const { tag, elementId, src, declaredHasAudio } of refs) {
      const hasAudioAttr = declaredHasAudio ? ' data-has-audio="true"' : "";
      const consequence =
        tag === "video" && !declaredHasAudio
          ? "but the render mixes an unmuted <video> as audio and fail-closes when that track has no audio stream."
          : "so it is not audio. The producer fail-closes when the tag and file kind disagree.";
      findings.push({
        code: "media_src_kind_mismatch",
        severity: "error",
        message: `<${tag} id="${elementId}"${hasAudioAttr}> src "${src}" has no audio stream, ${consequence}`,
        elementId,
        fixHint: mismatchFixHint(tag, declaredHasAudio),
      });
    }
  }
  return findings;
}
