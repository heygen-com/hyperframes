/**
 * `studio_transform`: move, resize and rotate, as a drag would.
 *
 * This tool reads the element's box back after every write and reports what
 * ACTUALLY changed. That is not belt-and-braces, it is the only thing standing
 * between an agent and a silent lie, because two of the three handlers can do
 * nothing and resolve:
 *
 * - The handlers exposed on `DomEditActionsValue` are the GSAP-AWARE wrappers
 *   (`useDomEditSession.ts` aliases them), not the CSS ones in
 *   `useDomGeometryCommits.ts`.
 * - `handleGsapAwarePathOffsetCommit` and `handleGsapAwareRotationCommit` are
 *   `if (gsapCommitMutation) { ...intercept... }` with NO else branch. In a
 *   composition with no GSAP they return having done nothing. The adjacent
 *   comments confirm that is deliberate: there is no CSS fallback to write to.
 * - `handleGsapAwareBoxSizeCommit` is different. It runs through
 *   `runGestureTransaction` with a scale route and a width/height route, so
 *   resize works more generally than the other two.
 *
 * Read back, do not assume.
 */

import type { DomEditSelection } from "../../components/editor/domEditingTypes";
import { toolFailure, toolOk, type ToolFailure, type ToolResult } from "../toolResult";

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TransformToolDeps {
  getCurrentSelection: () => DomEditSelection | null;
  getWriteBlockedReason: () => string | null;
  /** The element's box as it renders right now. */
  readBox: (selection: DomEditSelection) => ElementBox;
  moveTo: (selection: DomEditSelection, next: { x: number; y: number }) => Promise<void>;
  resizeTo: (selection: DomEditSelection, next: { width: number; height: number }) => Promise<void>;
  rotateTo: (selection: DomEditSelection, next: { angle: number }) => Promise<void>;
}

export interface StudioTransformInput {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  rotate?: unknown;
}

export interface StudioTransformResult {
  /** The box as it renders after the write, read back, not echoed. */
  box: ElementBox;
  applied: string[];
  /** Requested operations whose effect could not be observed, with why. */
  unchanged: Record<string, string>;
}

const NO_OP_HINT =
  "Move and rotate are written as GSAP code; a composition with no GSAP timeline has nothing to write to. studio_inspect reports the element's animations.";

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function guard(deps: TransformToolDeps): ToolFailure | null {
  const blocked = deps.getWriteBlockedReason();
  if (blocked) return toolFailure("blocked", blocked, "Resolve it in Studio, then retry.");
  if (!deps.getCurrentSelection()) {
    return toolFailure("invalid", "nothing is selected", "Call studio_select first.");
  }
  return null;
}

interface TransformRequest {
  move: { x: number; y: number } | null;
  size: { width: number; height: number } | null;
  rotate: number | null;
}

/**
 * Both or neither. Accepting one axis alone would mean inventing the other from
 * the current value, which moves the element somewhere the caller did not ask
 * for.
 */
function parsePair(
  a: unknown,
  b: unknown,
  names: [string, string],
  min = Number.NEGATIVE_INFINITY,
): { pair: [number, number] | null } | ToolFailure {
  const first = readNumber(a);
  const second = readNumber(b);
  if (first === null && second === null) return { pair: null };
  if (first === null || second === null) {
    return toolFailure("invalid", `${names[0]} and ${names[1]} must be given together`);
  }
  if (first < min || second < min) {
    return toolFailure("invalid", `${names[0]} and ${names[1]} must be at least ${min}`);
  }
  return { pair: [first, second] };
}

function isFailure(value: object): value is ToolFailure {
  return "ok" in value;
}

function parseRequest(input: StudioTransformInput): TransformRequest | ToolFailure {
  const move = parsePair(input.x, input.y, ["x", "y"]);
  if (isFailure(move)) return move;
  const size = parsePair(input.width, input.height, ["width", "height"], 0);
  if (isFailure(size)) return size;
  const rotate = readNumber(input.rotate);

  if (!move.pair && !size.pair && rotate === null) {
    return toolFailure(
      "invalid",
      "give at least one of x, y, width, height, rotate as a finite number",
    );
  }

  return {
    move: move.pair ? { x: move.pair[0], y: move.pair[1] } : null,
    size: size.pair ? { width: size.pair[0], height: size.pair[1] } : null,
    rotate,
  };
}

export async function studioTransform(
  deps: TransformToolDeps,
  input: StudioTransformInput,
): Promise<ToolResult<StudioTransformResult>> {
  const request = parseRequest(input);
  if (isFailure(request)) return request;

  const blocked = guard(deps);
  if (blocked) return blocked;

  const selection = deps.getCurrentSelection();
  if (!selection) return toolFailure("invalid", "nothing is selected");

  const applied: string[] = [];
  const unchanged: Record<string, string> = {};

  // Sequential, and each one re-reads first, so a move is judged against the box
  // AFTER a resize in the same call rather than against the original.
  if (request.size) {
    const before = deps.readBox(selection);
    await deps.resizeTo(selection, request.size);
    const after = deps.readBox(selection);
    if (after.width !== before.width || after.height !== before.height) applied.push("resize");
    else unchanged.resize = "the element's size did not change";
  }

  if (request.move) {
    const before = deps.readBox(selection);
    await deps.moveTo(selection, request.move);
    const after = deps.readBox(selection);
    if (after.x !== before.x || after.y !== before.y) applied.push("move");
    else unchanged.move = `the element did not move. ${NO_OP_HINT}`;
  }

  if (request.rotate !== null) {
    // Rotation is written as the CSS `rotate` property, an individual transform
    // property that does NOT appear in getComputedStyle().transform. There is no
    // reliable box-derived signal, so this is reported as dispatched rather than
    // verified, and the description says so.
    await deps.rotateTo(selection, { angle: request.rotate });
    applied.push("rotate");
  }

  if (applied.length === 0) {
    return toolFailure(
      "blocked",
      `nothing changed: ${Object.values(unchanged).join("; ")}`,
      NO_OP_HINT,
    );
  }

  return toolOk<StudioTransformResult>({ box: deps.readBox(selection), applied, unchanged });
}

export const STUDIO_TRANSFORM_INPUT_SCHEMA = {
  type: "object",
  properties: {
    x: { type: "number", description: "New x offset in pixels. Must be paired with y." },
    y: { type: "number", description: "New y offset in pixels. Must be paired with x." },
    width: { type: "number", minimum: 0, description: "New width. Must be paired with height." },
    height: { type: "number", minimum: 0, description: "New height. Must be paired with width." },
    rotate: { type: "number", description: "Rotation in degrees." },
  },
  additionalProperties: false,
} as const;

export const STUDIO_TRANSFORM_DESCRIPTION = [
  "Move, resize or rotate the CURRENTLY SELECTED element, the way a drag would.",
  "Call studio_select first. Give x with y, and width with height.",
  "The result's `box` is READ BACK after the write, not echoed from your request, and",
  "`applied` lists what actually took effect. Check it.",
  "Move and rotate are written as GSAP code, so in a composition with no GSAP timeline they",
  "do nothing; that shows up in `unchanged` rather than as a false success.",
  "Rotation is reported as dispatched rather than verified, because the CSS `rotate` property",
  "does not appear in the element's computed transform.",
  "Returns `ok: true`, or `ok: false` with `kind`, `reason` and a `hint`.",
].join(" ");
