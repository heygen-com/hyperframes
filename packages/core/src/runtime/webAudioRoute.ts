import { HF_AUDIO_AUTOMATION_ATTR } from "../audioAutomation.js";
import { HF_AUDIO_FX_ATTR } from "../audioFx.js";
import { HF_AUDIO_GROUP_ATTR } from "../audioGroups.js";
import { postRuntimeMessage } from "./bridge";
import type { RuntimeJson } from "./types";

/**
 * Which transport may claim an `<audio>` element's output.
 *
 * `createMediaElementSource()` is the runtime's PRIMARY audio path, and it is
 * a one-way door: the node permanently reroutes the element away from its
 * native output and is cached for the element's lifetime. That matters because
 * of a spec behaviour that looks nothing like a failure — per the Web Audio
 * spec's MediaElementAudioSourceNode security section, a node built over a
 * resource that fails the CORS-cross-origin check outputs SILENCE. It does not
 * throw, so the `try/catch` around the call in `webAudioTransport.ts` never
 * fires, nothing reaches `swallow()`, and the composition plays perfectly —
 * timeline advancing, visuals animating — with no audio at all (#3458).
 *
 * The only defence is to decide BEFORE the call, which is what this module is:
 * a pure classifier, so the same verdict can be reached at media-discovery time
 * (to emit a diagnostic) and at schedule time (to actually withhold the node)
 * without those two ever drifting apart.
 *
 * That guarantee holds for every caller that routes through this classifier —
 * it is NOT a runtime-wide interception of `createMediaElementSource`. The
 * timeline transport (`webAudioTransport.ts`, via `init.ts`) always goes
 * through it; a UI surface that builds its own throwaway `AudioContext` for
 * an unrelated purpose (e.g. the asset sidebar's preview player,
 * `AudioRow.tsx`) has to call it too, and is expected to. Known gap: an
 * element playing a `MediaStream` via `srcObject` instead of `src`/`<source>`
 * has no origin for this module to judge — `routeCandidates` only reads
 * `src`-shaped attributes, so a `srcObject` element always reads as
 * `web-audio` here, correctly or not. Nothing in this codebase feeds
 * `createMediaElementSource` from a `srcObject` element today, so this is
 * recorded as a boundary rather than fixed.
 *
 * Second known gap, same shape: `isCorsSilenced` judges the RAW url string —
 * the same-origin URL the author wrote, or whatever the browser resolved into
 * `currentSrc` — not wherever a server-side redirect chain actually lands.
 * A same-origin URL that 302s to a cross-origin CDN reads as `web-audio` here
 * and gets a real `createMediaElementSource` node; whether that node is
 * silent then depends on the redirect target's CORS headers, which this
 * classifier never sees (following the chain to inspect the final response
 * would turn a pure, synchronous verdict — needed on every schedule call —
 * into an async fetch). A cross-origin URL that redirects back to same-origin
 * has the opposite miss: classified `decode-only` and sent down the fetch
 * fallback when Web Audio capture would have worked fine either way. Not
 * fixed for the same reason as `srcObject` — no caller in this codebase
 * routes media through a redirecting URL today — but worth knowing before
 * trusting this classifier's verdict for one that does.
 */
export type WebAudioMediaRoute =
  /** Same-origin, CORS-opted-in, or a scheme the check doesn't apply to. */
  | { kind: "web-audio" }
  /**
   * Cross-origin without a `crossorigin` opt-in. MediaElementSource would be
   * silent, but `fetch` + `decodeAudioData` may still succeed — a CDN that
   * sends `Access-Control-Allow-Origin` while the author simply never wrote the
   * attribute is the common shape of this bug — and that route keeps the whole
   * FX graph. So: withhold the node, still let the decode path try.
   */
  | { kind: "decode-only"; reason: "cross_origin_no_cors"; asset: string };

/** Fired when the runtime withholds Web Audio capture from a media element. */
const DIAGNOSTIC_BYPASS_CODE = "runtime_web_audio_bypass";

function getAttr(el: HTMLMediaElement, name: string): string | null {
  return typeof el.getAttribute === "function" ? el.getAttribute(name) : null;
}

function hasAttr(el: HTMLMediaElement, name: string): boolean {
  return getAttr(el, name) !== null;
}

/**
 * `crossorigin` is an enumerated attribute whose invalid-value default is
 * `anonymous`, so PRESENCE is the opt-in — `crossorigin=""` and even
 * `crossorigin="garbage"` both make the fetch a CORS request. Comparing the
 * value against `"anonymous"` would wrongly block those.
 *
 * Two independent reads, because a spec-faithful host and a permissive one
 * disagree about where the truth lives:
 *  - `getAttribute` is the primary read and covers every real browser: the
 *    markup is unambiguous regardless of what the IDL getter does with it.
 *  - `el.crossOrigin` is a secondary read for a host that sets the IDL
 *    property without reflecting it back to the attribute — some
 *    jsdom-style test/preview hosts do this. The check is `!= null`
 *    (covers both `null` and `undefined`), not a truthiness check, ON
 *    PURPOSE: `crossorigin=""` is a valid, common opt-in (see above), and
 *    its IDL fallback value is the empty string — a falsy value that
 *    `Boolean(el.crossOrigin)` would silently misread as "not opted in",
 *    reintroducing the exact silent-audio bug this module exists to close.
 */
function hasCorsOptIn(el: HTMLMediaElement): boolean {
  if (hasAttr(el, "crossorigin")) return true;
  return el.crossOrigin != null;
}

function baseUri(el: HTMLMediaElement): string {
  if (typeof el.baseURI === "string" && el.baseURI) return el.baseURI;
  return typeof document !== "undefined" ? document.baseURI : "";
}

/**
 * The URLs whose origin could decide this element's route.
 *
 * Order matters and mirrors the HTML resource selection algorithm. Once
 * `currentSrc` is set the browser has COMMITTED to that resource, so it is the
 * only candidate that can matter; a `<source>` sibling it passed over must not
 * cost a same-origin element its Web Audio graph. A `src` attribute is equally
 * definitive — the spec has it win outright over `<source>` children. Only
 * before selection settles (no `currentSrc`, no `src`) do the `<source>`
 * candidates matter, and there the conservative read is right: any of them
 * could be the one that gets picked.
 */
function routeCandidates(el: HTMLMediaElement): string[] {
  const current = typeof el.currentSrc === "string" ? el.currentSrc : "";
  if (current) return [current];
  const srcAttr = getAttr(el, "src");
  if (srcAttr) return [srcAttr];
  if (typeof el.querySelectorAll !== "function") return [];
  const sources: string[] = [];
  for (const source of Array.from(el.querySelectorAll("source"))) {
    const value = source.getAttribute("src");
    if (value) sources.push(value);
  }
  return sources;
}

/**
 * Whether this URL would make MediaElementSource silent. Only http(s) is
 * judged: `blob:` and `data:` are same-origin by construction, and a `file:`
 * page's opaque origin can't be compared meaningfully — so those keep the
 * pre-existing behaviour rather than losing Web Audio on a guess. The guard
 * changes behaviour ONLY in the case that is already known-broken.
 */
function isCorsSilenced(rawUrl: string, el: HTMLMediaElement): boolean {
  if (typeof window === "undefined") return false;
  let url: URL;
  try {
    url = new URL(rawUrl, baseUri(el));
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // `location.origin` is the URL's origin, not the document's actual
  // security origin: a sandboxed iframe without `allow-same-origin` still
  // reports the parent-looking URL there while `window.origin` reads
  // `"null"`. An opaque document can't prove same-origin with anything.
  const selfOrigin = typeof window.origin === "string" ? window.origin : window.location.origin;
  if (selfOrigin !== "null" && url.origin === selfOrigin) return false;
  return !hasCorsOptIn(el);
}

/**
 * Whether resource selection has settled enough for a verdict to be a FACT
 * rather than a guess. `currentSrc`/`src` are both definitive per the HTML
 * resource-selection algorithm (see `routeCandidates` above); before either
 * is set, a verdict can only be built from `<source>` children, any of which
 * the browser may still pass over before committing.
 *
 * `classifyWebAudioMediaRoute` itself stays unsettled-tolerant on purpose —
 * the schedule path needs *a* verdict even before selection settles, and
 * conservatively withholding the node there costs nothing but a decode-only
 * fallback. This predicate exists for the one caller that must NOT act on a
 * guess: the discovery-time diagnostic, which drops a message in a human's
 * lap and only gets to say it once (see `reportWebAudioMediaRoute`'s latch).
 */
export function isRouteSelectionSettled(el: HTMLMediaElement): boolean {
  const current = typeof el.currentSrc === "string" ? el.currentSrc : "";
  if (current) return true;
  return hasAttr(el, "src");
}

/**
 * Pure — no node creation, no diagnostics, no element mutation. Called from
 * both the schedule path (where it withholds the node) and the discovery path
 * (where it only reports), which is the point: `hyperframes check` never calls
 * `play()`, so a verdict reachable only from the transport would be invisible
 * to the very gate meant to surface it.
 */
export function classifyWebAudioMediaRoute(el: HTMLMediaElement): WebAudioMediaRoute {
  for (const candidate of routeCandidates(el)) {
    if (isCorsSilenced(candidate, el)) {
      return { kind: "decode-only", reason: "cross_origin_no_cors", asset: candidate };
    }
  }
  return { kind: "web-audio" };
}

/**
 * Processing the native HTMLMediaElement fallback cannot reproduce. The track
 * stays AUDIBLE either way — silence is the bug being fixed, so failing closed
 * would just reinstate it — but these authored intentions are quietly dropped,
 * which is worth saying out loud.
 *
 * Wider than the FX/automation pair the schedule path already tests: group
 * membership carries a whole shared bus (chain, fader, its own automation
 * clock), and an above-unity `data-volume` cannot survive a route whose only
 * gain stage is `el.volume`, which the spec pins to [0,1].
 */
export function nativeUnexpressibleProcessing(el: HTMLMediaElement): string[] {
  const lost: string[] = [];
  if (hasAttr(el, HF_AUDIO_FX_ATTR)) lost.push("fx-chain");
  if (hasAttr(el, HF_AUDIO_AUTOMATION_ATTR)) lost.push("automation");
  if (hasAttr(el, HF_AUDIO_GROUP_ATTR)) lost.push("audio-group");
  const volume = Number.parseFloat(getAttr(el, "data-volume") ?? "");
  if (Number.isFinite(volume) && volume > 1) lost.push("above-unity-gain");
  return lost;
}

/**
 * Render never plays through Web Audio at all: the producer mixes offline from
 * the source files, and that mix applies the FX chain itself (see
 * `applyAudioFxChain` in `packages/engine/src/services/audioMixer.ts`). So a
 * bypass is not a fact about the render, and `lostProcessing` would be an
 * outright false claim there — the offline mix DOES reproduce the chain the
 * line says native output cannot. The engine forwards every console line to
 * producer stdout, so an ungated report would also land in every render log.
 *
 * Reporting is all that is gated: `classifyWebAudioMediaRoute` stays pure and
 * the routing decision is unchanged, which costs nothing in render because the
 * element is not the audio source there in the first place.
 *
 * Same signal `mediaProxy.ts`'s `isRenderMode` gates on. The `<video>` half of
 * that check (the injected render-frame sibling) is deliberately not mirrored:
 * only `<audio>` ever reaches this module.
 */
function isRenderMode(): boolean {
  // Read through an inline cast rather than the ambient `Window` augmentation
  // in `window.d.ts`: that augmentation is only in scope for programs that
  // include it (core's own tsconfig does), and this module is also exported
  // as `./runtime/web-audio-route` for non-runtime consumers (e.g. the studio
  // asset sidebar's preview player, `AudioRow.tsx`) whose tsconfig doesn't
  // pull it in. This is a plain existence check, so the cast costs nothing.
  return (
    typeof window !== "undefined" &&
    !!(window as unknown as { __HF_EXPORT_RENDER_SEEK_CONFIG?: unknown })
      .__HF_EXPORT_RENDER_SEEK_CONFIG
  );
}

// One diagnostic per element. Latched only when something is actually emitted,
// so an early "web-audio" verdict taken before the resource selection settled
// can't suppress the real one at `loadedmetadata`.
const diagnosedElements = new WeakSet<HTMLMediaElement>();

/**
 * Emit the one-time diagnostic for a non-Web-Audio verdict.
 *
 * The bypass always reports: it is an accident by definition, and the whole
 * complaint in #3458 is that nothing was said.
 */
export function reportWebAudioMediaRoute(el: HTMLMediaElement, route: WebAudioMediaRoute): void {
  if (route.kind === "web-audio") return;
  if (isRenderMode()) return;
  if (diagnosedElements.has(el)) return;
  const lost = nativeUnexpressibleProcessing(el);
  diagnosedElements.add(el);

  const details: Record<string, RuntimeJson> = {
    asset: route.asset,
    reason: route.reason,
    lostProcessing: lost,
    note: "cross-origin media without a `crossorigin` opt-in is silent through createMediaElementSource (Web Audio spec); using native playback instead",
  };
  postRuntimeMessage({
    source: "hf-preview",
    type: "diagnostic",
    code: DIAGNOSTIC_BYPASS_CODE,
    details,
  });
  // The stable code lives in the console text so the CLI's scraper
  // (packages/cli/src/utils/checkBrowser.ts) can match a token, not prose —
  // same contract mediaProxy.ts's diagnostics use.
  const lostNote =
    lost.length > 0
      ? ` Native playback cannot reproduce: ${lost.join(", ")} — proxy or download the asset to a same-origin URL to keep it.`
      : "";
  console.info(
    `[hyperframes] ${DIAGNOSTIC_BYPASS_CODE}: "${route.asset}" (${route.reason}): ` +
      `Web Audio capture withheld; the track plays through native HTMLMediaElement output.${lostNote}`,
  );
}
