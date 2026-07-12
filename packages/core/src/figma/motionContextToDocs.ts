/**
 * Mechanical translation of a raw Figma MCP `get_motion_context` response
 * into MotionDocs — no hand transcription (design spec §6 motion notes).
 *
 * Field-tested decoding rules (2026-07, SDS "Unlocked" card):
 *
 * - The response carries two encodings per node. The motion.dev snippet is
 *   the reliable one: every track is sampled inside the timeline-cohort
 *   window, so values are correct AT their normalized times. The CSS
 *   snippet stretches per-track durations and can disagree — it is ignored.
 * - Keyframes clustered at the tail of the window (segments spanning less
 *   than WRAP_EPSILON_S of real time) are LOOP-WRAP MARKERS — the instant
 *   reset at the loop boundary — not authored motion. They are stripped and
 *   the wrap is realized by the tween's `repeat` restart. Inventing visible
 *   returns from wrap markers is the known failure mode this module exists
 *   to prevent.
 * - After stripping, the last kept keyframe's time extends to 1 so the
 *   track fills its window (the dropped tail spanned sub-millisecond time).
 *
 * Verification is still mandatory: render and compare against
 * `export_video` ground truth with skills/figma/scripts/verify-motion.mjs.
 */

import type { MotionDoc, MotionEase, MotionTrack } from "./types";

/** Tail segments shorter than this (seconds) are loop-wrap markers. */
const WRAP_EPSILON_S = 0.005;

export interface MotionContextNode {
  nodeId: string;
  nodeName: string;
  nodeType?: string;
  codeSnippets?: { css?: string; motionDev?: string };
}

export interface MotionContextResponse {
  nodes: MotionContextNode[];
  timelineCohorts?: Array<{
    rootNodeId: string;
    durationMs: number;
    loopMode?: string;
    memberNodeIds?: string[];
  }>;
}

export interface MotionContextToDocsOptions {
  /**
   * Maps a node to the CSS selector of its imported element. REQUIRED in
   * practice: pass the ids from the Phase-3 component import (the mapper's
   * slugs, e.g. `#headphones-3d`) — deriving selectors from node names here
   * would silently drift from the imported HTML.
   */
  selectorFor: (node: MotionContextNode) => string;
  /** Extra plays per track (GSAP semantics: 0 = play once). Default 0. */
  repeat?: number;
}

/** motion.dev property → GSAP property. */
const PROPERTY_MAP: Record<string, string> = { rotate: "rotation" };

/** Escape regex metacharacters — keys are `\w+` property names today, but a
 * future caller passing anything else must not silently misparse. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract the balanced `{...}` body following `marker` in `src`. Brace
 * counting does not skip string literals — sound for motion.dev output
 * (numeric arrays + named eases, never arbitrary strings containing `}`). */
function balancedBlock(src: string, marker: string): string | null {
  const at = src.indexOf(marker);
  if (at === -1) return null;
  const start = src.indexOf("{", at + marker.length - 1);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start + 1, i);
    }
  }
  return null;
}

/** Extract a balanced `[...]` immediately after `key:` inside `src`. */
function arrayAfterKey(src: string, key: string): string | null {
  const re = new RegExp(`${escapeRegExp(key)}\\s*:\\s*\\[`);
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === "[") depth += 1;
    if (src[i] === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

function scalarAfterKey(src: string, key: string): string | null {
  const m = new RegExp(`${escapeRegExp(key)}\\s*:\\s*("[^"]*"|[\\w.]+)`).exec(src);
  return m?.[1] ?? null;
}

function parseEase(transitionBlock: string): MotionEase[] | null {
  const arr = arrayAfterKey(transitionBlock, "ease");
  if (arr) return JSON.parse(arr) as MotionEase[];
  const scalar = scalarAfterKey(transitionBlock, "ease");
  if (scalar?.startsWith('"')) return [JSON.parse(scalar) as string];
  return null;
}

/**
 * Strip loop-wrap tail keyframes: walking from the end, drop keyframes whose
 * incoming segment spans < WRAP_EPSILON_S of real time; stop at the first
 * substantial segment. Extend the last kept time to 1.
 */
function stripWrapTail(
  values: Array<number | string>,
  times: number[],
  ease: MotionEase[],
  duration: number,
): { values: Array<number | string>; times: number[]; ease: MotionEase[] } {
  let end = values.length;
  while (end > 2) {
    const tPrev = times[end - 2];
    const tCur = times[end - 1];
    if (tPrev === undefined || tCur === undefined) break;
    if ((tCur - tPrev) * duration >= WRAP_EPSILON_S) break;
    end -= 1;
  }
  const v = values.slice(0, end);
  const t = times.slice(0, end);
  const e = ease.slice(0, Math.max(1, end - 1));
  const last = t.length - 1;
  if (t[last] !== undefined && t[last] < 1) t[last] = 1;
  return { values: v, times: t, ease: e };
}

interface RawTrackData {
  values: Array<number | string>;
  times: number[];
  ease: MotionEase[];
  duration: number;
}

/** Extract and validate one property's raw arrays from the snippet blocks. */
function extractTrackData(animate: string, transition: string, prop: string): RawTrackData | null {
  const valuesSrc = arrayAfterKey(animate, prop);
  const propTransition = balancedBlock(transition, `${prop}: {`);
  if (!valuesSrc || !propTransition) return null;
  const timesSrc = arrayAfterKey(propTransition, "times");
  const durationSrc = scalarAfterKey(propTransition, "duration");
  const ease = parseEase(propTransition);
  if (!timesSrc || !durationSrc || !ease) return null;
  const values = JSON.parse(valuesSrc) as Array<number | string>;
  const times = JSON.parse(timesSrc) as number[];
  const duration = Number(durationSrc);
  if (values.length !== times.length || !Number.isFinite(duration)) return null;
  return { values, times, ease, duration };
}

/** Parse one property's track out of the animate/transition blocks. */
function parsePropertyTrack(
  animate: string,
  transition: string,
  prop: string,
  repeat: number,
): MotionTrack | null {
  const raw = extractTrackData(animate, transition, prop);
  if (!raw) return null;
  // segment eases: a single named ease applies to every segment
  const segCount = raw.values.length - 1;
  const segEase =
    raw.ease.length === segCount
      ? raw.ease
      : Array.from({ length: segCount }, (_, i) => raw.ease[i % raw.ease.length] ?? "linear");
  const stripped = stripWrapTail(raw.values, raw.times, segEase, raw.duration);
  return {
    property: PROPERTY_MAP[prop] ?? prop,
    values: stripped.values,
    times: stripped.times,
    ease: stripped.ease,
    duration: raw.duration,
    repeat,
  };
}

/** Parse one node's motion.dev snippet into MotionTracks. */
function parseNodeTracks(node: MotionContextNode, repeat: number): MotionTrack[] {
  const snippet = node.codeSnippets?.motionDev;
  if (!snippet) return [];
  const animate = balancedBlock(snippet, "animate={");
  const transition = balancedBlock(snippet, "transition={");
  if (!animate || !transition) return [];

  const tracks: MotionTrack[] = [];
  const propRe = /(\w+)\s*:\s*\[/g;
  let m: RegExpExecArray | null;
  while ((m = propRe.exec(animate)) !== null) {
    const prop = m[1];
    if (prop === undefined) continue;
    const track = parsePropertyTrack(animate, transition, prop, repeat);
    if (track) tracks.push(track);
  }
  return tracks;
}

/**
 * Raw `get_motion_context` response → MotionDoc[], mechanically. Feed the
 * result to motionToGsap/emitTimelineScript; then verify against
 * export_video ground truth before calling the import done.
 */
export function motionContextToDocs(
  response: MotionContextResponse,
  options: MotionContextToDocsOptions,
): MotionDoc[] {
  const repeat = options.repeat ?? 0;
  const docs: MotionDoc[] = [];
  for (const node of response.nodes ?? []) {
    const tracks = parseNodeTracks(node, repeat);
    if (tracks.length === 0) continue;
    docs.push({ selector: options.selectorFor(node), tracks });
  }
  return docs;
}
