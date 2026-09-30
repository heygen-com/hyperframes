/**
 * The attribute each clip-menu tool writes, and what a clip's attributes say is applied.
 * Pure over strings so the menu, the badges and an agent's hand edits all agree.
 */

import {
  parseAudioFxChain,
  serializeAudioFxChain,
  type HfAudioFxChain,
} from "@hyperframes/core/audio-fx";
import { activeAudioFxPresetIds } from "@hyperframes/core/audio-fx-presets";
import { normalizeHfColorGrading } from "@hyperframes/core/color-grading";
import { parseRateLane } from "@hyperframes/core/speed-ramp";
import { applyPresetToChain } from "../../components/editor/useApplyAudioFxPreset";

export interface ClipToolChoice {
  id: string;
  label: string;
}

export const VOICE_CHOICES: readonly ClipToolChoice[] = [
  { id: "voice-clean", label: "Clean" },
  { id: "voice-broadcast", label: "Broadcast" },
  { id: "voice-warm", label: "Warm" },
];

export const CHARACTER_CHOICES: readonly ClipToolChoice[] = [
  { id: "telephone", label: "Telephone" },
  { id: "radio-am", label: "AM Radio" },
  { id: "megaphone", label: "Megaphone" },
];

export const LOOK_CHOICES: readonly ClipToolChoice[] = [
  { id: "warm-daylight", label: "Warm daylight" },
  { id: "clean-studio", label: "Clean studio" },
  { id: "vintage-wash", label: "Vintage wash" },
  { id: "mono-clean", label: "Mono" },
  { id: "deep-contrast", label: "Deep contrast" },
  { id: "home-movie-8mm", label: "Home movie" },
];

const VOICE_MENU_IDS = new Set([...VOICE_CHOICES, ...CHARACTER_CHOICES].map((c) => c.id));

const EMPTY_CHAIN: HfAudioFxChain = { version: 1, nodes: [] };

function parseChainOrEmpty(raw: string | null | undefined): HfAudioFxChain {
  if (!raw) return EMPTY_CHAIN;
  try {
    return parseAudioFxChain(raw);
  } catch {
    return EMPTY_CHAIN;
  }
}

function labelFor(choices: readonly ClipToolChoice[], id: string | null): string | null {
  return choices.find((choice) => choice.id === id)?.label ?? null;
}

export function activeVoicePreset(rawChain: string | null | undefined): string | null {
  const ids = activeAudioFxPresetIds(parseChainOrEmpty(rawChain));
  return ids.find((id) => VOICE_MENU_IDS.has(id)) ?? null;
}

function voicePresetLabel(id: string | null): string | null {
  return labelFor(VOICE_CHOICES, id) ?? labelFor(CHARACTER_CHOICES, id);
}

/**
 * The `data-fx-chain` after choosing a voice preset, or `null` to drop the attribute.
 * Single choice: the other menu presets' nodes go; carve, leveller and hand-added nodes stay.
 */
export function chainWithVoicePreset(
  rawChain: string | null | undefined,
  presetId: string | null,
): string | null {
  const chain = parseChainOrEmpty(rawChain);
  const others = chain.nodes.filter(
    (node) =>
      !node.fromPreset || !VOICE_MENU_IDS.has(node.fromPreset) || node.fromPreset === presetId,
  );
  const kept: HfAudioFxChain = { ...chain, nodes: others };
  const next = presetId ? (applyPresetToChain(kept, presetId, undefined) ?? kept) : kept;
  return next.nodes.length > 0 ? serializeAudioFxChain(next) : null;
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function activeLook(rawGrading: string | null | undefined): string | null {
  return normalizeHfColorGrading(parseJson(rawGrading))?.preset ?? null;
}

function lookLabel(id: string | null): string | null {
  return labelFor(LOOK_CHOICES, id);
}

export function lookAttrValue(presetId: string | null): string | null {
  return presetId ? JSON.stringify({ preset: presetId, intensity: 1 }) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isDucked(rawCarve: string | null | undefined): boolean {
  const carve = parseJson(rawCarve);
  return isRecord(carve) && carve["enabled"] !== false;
}

function hasRateRamp(rawAutomation: string | null | undefined): boolean {
  return parseRateLane(rawAutomation) !== null;
}

const ZERO_INSET = /^inset\(\s*0(px|%)?\s*\)$/i;

export function hasCrop(clipPath: string | null | undefined): boolean {
  const value = clipPath?.trim() ?? "";
  return value !== "" && value !== "none" && !ZERO_INSET.test(value);
}

export type ClipBadgeKind = "link" | "look" | "voice" | "ramp" | "crop" | "ducked" | "volume";

export interface ClipBadge {
  kind: ClipBadgeKind;
  label: string;
}

/** What a clip's attributes say is applied; the element's own attributes, as read off its node. */
export interface ClipToolState {
  tag: string;
  hasSound: boolean;
  volume: number | null;
  muted: boolean;
  fxChain: string | null;
  automation: string | null;
  colorGrading: string | null;
  clipPath: string | null;
  carve: string | null;
  link: string | null;
}

function volumeBadge(state: ClipToolState): ClipBadge | null {
  const isAudio = state.tag === "audio";
  if (!isAudio && !state.hasSound) return null;
  if (state.muted) return { kind: "volume", label: "Muted" };
  const volume = state.volume ?? 1;
  if (Math.abs(volume - 1) < 0.005) return null;
  return { kind: "volume", label: `${Math.round(volume * 100)}%` };
}

/** Badges in the wireframe's order: look, voice, ramp, crop, ducked, volume. The link badge leads. */
export function readClipBadges(state: ClipToolState): ClipBadge[] {
  const look = lookLabel(activeLook(state.colorGrading));
  const voice = voicePresetLabel(activeVoicePreset(state.fxChain));
  const volume = volumeBadge(state);
  const badges: Array<ClipBadge | null> = [
    state.link ? { kind: "link", label: "Linked" } : null,
    look ? { kind: "look", label: look } : null,
    voice ? { kind: "voice", label: `Voice: ${voice}` } : null,
    hasRateRamp(state.automation) ? { kind: "ramp", label: "Ramp" } : null,
    hasCrop(state.clipPath) ? { kind: "crop", label: "Crop" } : null,
    isDucked(state.carve) ? { kind: "ducked", label: "Ducked" } : null,
    volume,
  ];
  return badges.filter((badge): badge is ClipBadge => badge !== null);
}

const MAX_VISIBLE_BADGES = 2;

/** The link badge is always shown; the rest cap at two, then `+N`. */
export function splitVisibleBadges(badges: readonly ClipBadge[]): {
  visible: ClipBadge[];
  hidden: ClipBadge[];
} {
  const link = badges.filter((badge) => badge.kind === "link");
  const rest = badges.filter((badge) => badge.kind !== "link");
  return {
    visible: [...link, ...rest.slice(0, MAX_VISIBLE_BADGES)],
    hidden: rest.slice(MAX_VISIBLE_BADGES),
  };
}
