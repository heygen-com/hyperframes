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
  | { kind: "decode-only"; reason: "cross_origin_no_cors"; asset: string }
  /**
   * `data-native-audio`: the author took the element off Web Audio entirely.
   * Unlike the automatic verdict this must ALSO skip decode — a decode success
   * would put the element right back under a buffer source and mute it, which
   * is the exact outcome the escape hatch exists to prevent.
   */
  | { kind: "native"; reason: "authored_opt_out"; asset: string };

/**
 * Per-element escape hatch. Origin comparison is a URL question, and some
 * things a URL cannot answer: a same-origin path that 302s to a CDN reads as
 * same-origin here but is cross-origin by the time the media element resolves
 * it. A global message-passing switch can't cover that either — it races the
 * runtime bootstrap that already scheduled the track.
 */
const HF_NATIVE_AUDIO_ATTR = "data-native-audio";

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
 */
function hasCorsOptIn(el: HTMLMediaElement): boolean {
  if (hasAttr(el, "crossorigin")) return true;
  // Secondary read for a host that set the IDL property without reflecting it.
  return typeof el.crossOrigin === "string";
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
  if (url.origin === window.location.origin) return false;
  return !hasCorsOptIn(el);
}

function primaryAsset(el: HTMLMediaElement): string {
  return routeCandidates(el)[0] ?? "";
}

/**
 * Pure — no node creation, no diagnostics, no element mutation. Called from
 * both the schedule path (where it withholds the node) and the discovery path
 * (where it only reports), which is the point: `hyperframes check` never calls
 * `play()`, so a verdict reachable only from the transport would be invisible
 * to the very gate meant to surface it.
 */
export function classifyWebAudioMediaRoute(el: HTMLMediaElement): WebAudioMediaRoute {
  if (hasAttr(el, HF_NATIVE_AUDIO_ATTR)) {
    return { kind: "native", reason: "authored_opt_out", asset: primaryAsset(el) };
  }
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
  return typeof window !== "undefined" && !!window.__HF_EXPORT_RENDER_SEEK_CONFIG;
}

// One diagnostic per element. Latched only when something is actually emitted,
// so an early "web-audio" verdict taken before the resource selection settled
// can't suppress the real one at `loadedmetadata`.
const diagnosedElements = new WeakSet<HTMLMediaElement>();

/**
 * Emit the one-time diagnostic for a non-Web-Audio verdict.
 *
 * The automatic bypass always reports: it is an accident by definition, and the
 * whole complaint in #3458 is that nothing was said. An authored
 * `data-native-audio` reports only when processing is being dropped — the
 * author asked for native output, so honouring it is not a finding.
 */
export function reportWebAudioMediaRoute(el: HTMLMediaElement, route: WebAudioMediaRoute): void {
  if (route.kind === "web-audio") return;
  if (isRenderMode()) return;
  if (diagnosedElements.has(el)) return;
  const lost = nativeUnexpressibleProcessing(el);
  if (route.kind === "native" && lost.length === 0) return;
  diagnosedElements.add(el);

  const details: Record<string, RuntimeJson> = {
    asset: route.asset,
    reason: route.reason,
    lostProcessing: lost,
    note:
      route.reason === "cross_origin_no_cors"
        ? "cross-origin media without a `crossorigin` opt-in is silent through createMediaElementSource (Web Audio spec); using native playback instead"
        : "element opted out of Web Audio via data-native-audio",
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
