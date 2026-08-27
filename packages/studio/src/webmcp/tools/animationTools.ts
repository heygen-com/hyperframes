/**
 * `studio_animate`: author motion.
 *
 * These tools are deliberately less confident than the rest, because the
 * handlers underneath them are:
 *
 * - `handleGsapAddAnimation(method)` takes ONLY a method. Its insert position
 *   comes from the live playhead, not from the caller, and the call is
 *   `void ...catch()`, so it returns nothing and cannot be awaited.
 * - `handleGsapAddKeyframeBatch` returns a promise but catches its own failure,
 *   so awaiting it proves the call finished, not that it landed.
 * - `handleGsapDeleteAnimation` discards its promise entirely.
 * - `handleGsapUpdateMeta` is the one honest signal: it returns a boolean.
 *   Its `false` is ambiguous though, meaning either no selection or a failed
 *   write, so the no-selection case is ruled out before dispatch.
 *
 * U8 solved the same problem by reading the result back. That does not work
 * here: the animation list comes from React state that only refreshes on a
 * render, and no render happens inside one tool call. So rather than fake a
 * verification, these report what was dispatched and tell the agent to call
 * `studio_inspect` to see the result. Saying "I asked for this" is honest;
 * saying "this happened" would not be.
 */

import type { DomEditSelection } from "../../components/editor/domEditingTypes";
import { toolFailure, toolOk, type ToolFailure, type ToolResult } from "../toolResult";

export type GsapMethod = "to" | "from" | "set" | "fromTo";

const METHODS: readonly GsapMethod[] = ["to", "from", "set", "fromTo"];

export interface AnimationToolDeps {
  getCurrentSelection: () => DomEditSelection | null;
  getWriteBlockedReason: () => string | null;
  readPlayhead: () => { currentTime: number; duration: number; isPlaying: boolean };
  addAnimation: (method: GsapMethod) => void;
  updateAnimation: (
    animationId: string,
    updates: { duration?: number; ease?: string; position?: number },
  ) => Promise<boolean>;
  addKeyframe: (
    animationId: string,
    percent: number,
    properties: Record<string, number | string>,
  ) => Promise<void>;
  deleteAnimation: (animationId: string) => void;
}

const INSPECT_HINT = "Call studio_inspect to see the result.";

function guard(deps: AnimationToolDeps): ToolFailure | null {
  const blocked = deps.getWriteBlockedReason();
  if (blocked) return toolFailure("blocked", blocked, "Resolve it in Studio, then retry.");
  if (!deps.getCurrentSelection()) {
    return toolFailure("invalid", "nothing is selected", "Call studio_select first.");
  }
  return null;
}

function readAnimationId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export interface StudioAddAnimationResult {
  method: GsapMethod;
  /** Where it was inserted, which is the playhead, not a value you supplied. */
  insertedAtSeconds: number;
  dispatched: true;
}

export async function studioAddAnimation(
  deps: AnimationToolDeps,
  input: { method?: unknown },
): Promise<ToolResult<StudioAddAnimationResult>> {
  const method = METHODS.find((candidate) => candidate === input.method);
  if (!method) {
    return toolFailure("invalid", `method must be one of ${METHODS.join(", ")}`);
  }

  const blocked = guard(deps);
  if (blocked) return blocked;

  // The handler reads the playhead itself. Reporting a position the caller gave
  // us would be reporting a number that had no effect, so the tool takes no
  // position and reports where the playhead actually is instead.
  const { currentTime } = deps.readPlayhead();
  deps.addAnimation(method);

  return toolOk<StudioAddAnimationResult>({
    method,
    insertedAtSeconds: currentTime,
    dispatched: true,
  });
}

export interface StudioUpdateAnimationResult {
  animationId: string;
  updated: { duration?: number; ease?: string; position?: number };
}

export async function studioUpdateAnimation(
  deps: AnimationToolDeps,
  input: { animationId?: unknown; duration?: unknown; ease?: unknown; position?: unknown },
): Promise<ToolResult<StudioUpdateAnimationResult>> {
  const animationId = readAnimationId(input.animationId);
  if (!animationId) {
    return toolFailure("invalid", "animationId must be a non-empty string", INSPECT_HINT);
  }

  const updates: { duration?: number; ease?: string; position?: number } = {};
  if (typeof input.duration === "number" && Number.isFinite(input.duration)) {
    if (input.duration < 0) return toolFailure("invalid", "duration must not be negative");
    updates.duration = input.duration;
  }
  if (typeof input.ease === "string" && input.ease.trim()) updates.ease = input.ease;
  if (typeof input.position === "number" && Number.isFinite(input.position)) {
    updates.position = input.position;
  }
  if (Object.keys(updates).length === 0) {
    return toolFailure("invalid", "give at least one of duration, ease, position");
  }

  // Ruled out BEFORE dispatch on purpose: the handler answers `false` for both
  // "nothing selected" and "the write failed", so a false afterwards would be
  // ambiguous. Eliminating one of the two makes the other one legible.
  const blocked = guard(deps);
  if (blocked) return blocked;

  const landed = await deps.updateAnimation(animationId, updates);
  if (!landed) {
    return toolFailure(
      "failed",
      `the update to ${animationId} did not land`,
      "The animation id may be stale. studio_inspect lists the current ones.",
    );
  }

  return toolOk<StudioUpdateAnimationResult>({ animationId, updated: updates });
}

export interface StudioAddKeyframeResult {
  animationId: string;
  percent: number;
  properties: Record<string, number | string>;
  dispatched: true;
}

export async function studioAddKeyframe(
  deps: AnimationToolDeps,
  input: { animationId?: unknown; percent?: unknown; properties?: unknown },
): Promise<ToolResult<StudioAddKeyframeResult>> {
  const animationId = readAnimationId(input.animationId);
  if (!animationId) {
    return toolFailure("invalid", "animationId must be a non-empty string", INSPECT_HINT);
  }
  const percent = input.percent;
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    // Validated here because nothing in the platform checks input against the
    // schema; the tool receives whatever the agent sent.
    return toolFailure("invalid", "percent must be a number between 0 and 100");
  }
  const raw = input.properties;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return toolFailure("invalid", "properties must be an object of GSAP property to value");
  }
  const properties: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" || typeof value === "string") properties[key] = value;
  }
  if (Object.keys(properties).length === 0) {
    return toolFailure("invalid", "properties must contain at least one number or string value");
  }

  const blocked = guard(deps);
  if (blocked) return blocked;

  await deps.addKeyframe(animationId, percent, properties);

  return toolOk<StudioAddKeyframeResult>({ animationId, percent, properties, dispatched: true });
}

export interface StudioDeleteAnimationResult {
  animationId: string;
  dispatched: true;
}

export async function studioDeleteAnimation(
  deps: AnimationToolDeps,
  input: { animationId?: unknown },
): Promise<ToolResult<StudioDeleteAnimationResult>> {
  const animationId = readAnimationId(input.animationId);
  if (!animationId) {
    return toolFailure("invalid", "animationId must be a non-empty string", INSPECT_HINT);
  }

  const blocked = guard(deps);
  if (blocked) return blocked;

  deps.deleteAnimation(animationId);
  return toolOk<StudioDeleteAnimationResult>({ animationId, dispatched: true });
}

const DISPATCH_CAVEAT = `Reports what was dispatched, not what landed: the handler underneath does not report back. ${INSPECT_HINT}`;

export const STUDIO_ADD_ANIMATION_INPUT_SCHEMA = {
  type: "object",
  properties: {
    method: { type: "string", enum: METHODS, description: "The GSAP method to add." },
  },
  required: ["method"],
  additionalProperties: false,
} as const;

export const STUDIO_ADD_ANIMATION_DESCRIPTION = [
  "Add a GSAP animation to the CURRENTLY SELECTED element. Call studio_select first.",
  "It is inserted AT THE PLAYHEAD, which this tool does not control: call studio_seek first",
  "to choose when it starts. The result reports where the playhead actually was.",
  DISPATCH_CAVEAT,
].join(" ");

export const STUDIO_UPDATE_ANIMATION_INPUT_SCHEMA = {
  type: "object",
  properties: {
    animationId: { type: "string", description: "An animation id from studio_inspect." },
    duration: { type: "number", minimum: 0, description: "Duration in seconds." },
    ease: { type: "string", description: "A GSAP ease, for example power2.out." },
    position: { type: "number", description: "Start position in seconds." },
  },
  required: ["animationId"],
  additionalProperties: false,
} as const;

export const STUDIO_UPDATE_ANIMATION_DESCRIPTION = [
  "Change an existing animation's duration, ease or position.",
  "This is the one animation tool that CONFIRMS its write, so a failure here is real",
  "and usually means a stale animationId. Get current ids from studio_inspect.",
].join(" ");

export const STUDIO_ADD_KEYFRAME_INPUT_SCHEMA = {
  type: "object",
  properties: {
    animationId: { type: "string", description: "An animation id from studio_inspect." },
    percent: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description: "Where in the tween, 0 to 100.",
    },
    properties: {
      type: "object",
      description: 'GSAP property to value, for example {"y": -50, "opacity": 0}.',
    },
  },
  required: ["animationId", "percent", "properties"],
  additionalProperties: false,
} as const;

export const STUDIO_ADD_KEYFRAME_DESCRIPTION = [
  "Add a keyframe to an existing animation at a percentage through it.",
  "All the properties land in one commit, so they are one undo entry.",
  DISPATCH_CAVEAT,
].join(" ");

export const STUDIO_DELETE_ANIMATION_INPUT_SCHEMA = {
  type: "object",
  properties: {
    animationId: { type: "string", description: "An animation id from studio_inspect." },
  },
  required: ["animationId"],
  additionalProperties: false,
} as const;

export const STUDIO_DELETE_ANIMATION_DESCRIPTION = [
  "Remove an animation from the currently selected element. Undo reverses it.",
  DISPATCH_CAVEAT,
].join(" ");
