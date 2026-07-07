// Provider registry — the v2 contract.
//
// Each media type maps to an ORDERED list of provider entries. Providers are
// tried in order; the first to return a non-null result wins, which keeps
// resolution deterministic (same request -> same provider -> same file ->
// reproducible renders). heygen-CLI is always first for the types it serves.
//
// An entry exposes any of three capability methods — search / generate /
// process — plus { name }. media-use holds no keys; each external tool owns its
// own auth. Providers, by type:
//   - heygen CLI: catalog + TTS, first for every type it serves (sub creds)
//   - mflux: local FLUX-class image gen, spec-selected to the machine's RAM
//     (free, private, offline once cached)
//   - codex CLI: image gen on the user's ChatGPT sub — the better-quality upsell
//     and the fallback when no local model fits
//   - Kokoro (via the hyperframes CLI): local voiceover, free/private default
//     for the voice type, ahead of the paid HeyGen TTS upsell
//
// Generation is local-first, cloud-upsell. `ctx.provider` forces one provider
// (e.g. "make an image with codex").

import { bgmProvider } from "./bgm-provider.mjs";
import { sfxProvider } from "./sfx-provider.mjs";
import { imageProvider, iconProvider } from "./image-provider.mjs";
import { brandProvider } from "./brand-provider.mjs";
import { heygenTtsGenerate } from "./voice-provider.mjs";
import { localTtsGenerate } from "./tts-local-provider.mjs";
import { codexImageGenerate } from "./codex-provider.mjs";
import { mfluxImageGenerate } from "./mflux-provider.mjs";

// Provider markers: `network` = hits a remote service (skipped by --local-only).
// `paid` = costs wallet credits (documentation for the agent's cost judgment,
// X4: agent-initiated paid should confirm). HeyGen catalog SEARCH is free;
// HeyGen TTS now costs credits, so it is the paid upsell behind local Kokoro.
const A = (name, caps) => ({ name, ...caps }); // local, free
const N = (name, caps) => ({ name, network: true, ...caps }); // remote, free
const P = (name, caps) => ({ name, network: true, paid: true, ...caps }); // remote, paid

// heygen-CLI first (and currently only). All remote providers are skipped by --local-only.
const REGISTRY = {
  bgm: [N("heygen.audio.sounds", { search: bgmProvider.search })],
  sfx: [N("heygen.audio.sounds", { search: sfxProvider.search })],
  image: [
    N("heygen.asset.search", { search: imageProvider.search }),
    // Catalog miss -> generate. Local first (best FLUX-class model the machine's
    // RAM can run, spec-selected; free, private, kept under --local-only), then
    // the codex CLI on the user's ChatGPT sub as the better-quality upsell and
    // the fallback when no local model fits.
    A("mflux.local", { generate: mfluxImageGenerate }),
    N("codex.image_gen", { generate: codexImageGenerate }),
  ],
  icon: [N("heygen.asset.search", { search: iconProvider.search })],
  voice: [
    // Local Kokoro first (free, private, on-device via the hyperframes CLI, kept
    // under --local-only), then HeyGen TTS as the higher-quality paid upsell and
    // the fallback when Kokoro is not set up.
    A("kokoro.local", { generate: localTtsGenerate }),
    P("heygen.tts", { generate: heygenTtsGenerate }),
  ],
  brand: [
    // Local design spec, not heygen — reads frame.md / design.md tokens.
    A("design_spec", { search: brandProvider.search }),
  ],
};

function listFor(type) {
  const list = REGISTRY[type];
  if (!list) throw new Error(`unknown media type: ${type}`);
  return list;
}

/** Ordered providers for a type. */
export function getProviders(type) {
  return listFor(type);
}

/** All declared media types. */
export function listTypes() {
  return Object.keys(REGISTRY);
}

/** Provider names available for a type, in cascade order (for --provider validation). */
export function providerNamesFor(type) {
  return listFor(type).map((p) => p.name);
}

/**
 * Does an override token (full name like "codex.image_gen" or a prefix like
 * "codex") match any provider declared for the type? Same match rule as
 * runProviders, so validation and dispatch never disagree.
 */
export function providerMatches(type, want) {
  return providerNamesFor(type).some((n) => n === want || n.startsWith(`${want}.`));
}

/**
 * Back-compat shim for the v1 single-provider API. Returns the first declared
 * provider for the type (tagged with `type`); throws for an unknown type.
 * Kept for v1 callers only — new code should use getProviders/runCapability.
 */
export function getProvider(type) {
  const first = listFor(type)[0] || {};
  return { ...first, type };
}

/**
 * Run a capability across an explicit ordered provider list. Tries each in
 * order, returns the first non-null result, skips providers that don't expose
 * the capability. Pure over its input — the unit-testable core of the cascade.
 *
 * Offline guard: a `network` provider is skipped when `ctx.localOnly` is set —
 * unconditionally, even under a `ctx.provider` override. --local-only is a hard
 * safety flag: it must never make a network call. Forcing a network provider
 * while offline yields a clean miss (the caller explains the conflict), never a
 * silent network request.
 * Provider override: `ctx.provider` (a full name like "codex.image_gen" or a
 * prefix like "codex") pins resolution to matching providers only — this is how
 * a user "make an image WITH codex" forces the upsell instead of taking the
 * free-first default.
 */
export async function runProviders(providers, capability, intent, ctx) {
  const want = ctx?.provider;
  for (const p of providers) {
    if (want && p.name !== want && !p.name.startsWith(`${want}.`)) continue;
    if (p.network && ctx?.localOnly) continue; // --local-only wins, even over --provider
    const fn = p[capability];
    if (typeof fn !== "function") continue;
    const res = await fn(intent, ctx);
    if (res) return res;
  }
  return null;
}

/** Run a capability over the providers for a type (deterministic, heygen-first). */
export async function runCapability(type, capability, intent, ctx) {
  return runProviders(getProviders(type), capability, intent, ctx);
}
