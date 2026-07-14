// fallow-ignore-file code-duplication
// executeGsapMutationRecast and executeGsapMutationAcorn are intentionally
// parallel — two writers, same switch-case interface. Structural duplication
// is load-bearing (both paths must remain testable in isolation).
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  rmSync,
  statSync,
  renameSync,
  readdirSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import { isAudioFile } from "../helpers/mime.js";
import { generateWaveformCache } from "../helpers/waveform.js";
import { validateUploadedMediaBuffer } from "../helpers/mediaValidation.js";
import { isSafePath, resolveWithinProject } from "../helpers/safePath.js";
import { backupPathForResponse, snapshotBeforeWrite } from "../helpers/backupJournal.js";
import {
  findUnsafeDomPatchValues,
  findUnsafeMutationValues,
  type UnsafeMutationValue,
} from "../helpers/finiteMutation.js";
import type { GsapAnimation } from "@hyperframes/parsers";
import { classifyPropertyGroup } from "@hyperframes/parsers/gsap-constants";
import { parseGsapScriptAcorn } from "@hyperframes/parsers/gsap-parser-acorn";
import { unrollComputedTimeline } from "@hyperframes/parsers";
import {
  updateAnimationInScript,
  addAnimationToScript,
  removeAnimationFromScript,
  addKeyframeToScript,
  removeKeyframeFromScript,
  moveKeyframeInScript,
  resizeKeyframedTweenInScript,
  updateKeyframeInScript,
  convertToKeyframesFromScript,
  removeAllKeyframesFromScript,
  materializeKeyframesFromScript,
  unrollDynamicAnimations,
  setArcPathInScript,
  updateArcSegmentInScript,
  removeArcPathFromScript,
  addAnimationWithKeyframesToScript,
  splitAnimationsInScript,
  splitIntoPropertyGroupsFromScript,
  shiftPositionsInScript,
  scalePositionsInScript,
  dedupePositionWritesInScript,
} from "@hyperframes/parsers/gsap-writer-acorn";
import {
  removeElementFromHtml,
  patchElementInHtml,
  probeElementInSource,
  splitElementInHtml,
  wrapElementsInHtml,
  unwrapElementsFromHtml,
  isHTMLElement,
  type PatchOperation,
  type ElementRebase,
} from "../helpers/sourceMutation.js";
import { parseHTML } from "linkedom";

// ── Server cutover flag ─────────────────────────────────────────────────────

/**
 * Mirror of the client STUDIO_SDK_CUTOVER_ENABLED flag for server-side writer
 * selection. When true, the acorn writer handles GSAP mutations; otherwise the
 * recast writer (gsapParser.ts) is used. Default false → recast.
 *
 * Enable with: STUDIO_SDK_CUTOVER_ENABLED=true (or =1)
 * Mirrors the client Vite env var name so one env switch flips both sides.
 */
function isAcornGsapWriterEnabled(): boolean {
  const val = process.env["STUDIO_SDK_CUTOVER_ENABLED"];
  return val === "true" || val === "1";
}

/**
 * Lazy-load gsapParser for write ops (recast-backed) — the default server writer.
 * The read path uses the browser-safe acorn parser; this loader is only needed
 * for the recast write path (the default when STUDIO_SDK_CUTOVER_ENABLED is off).
 */
async function loadGsapParser() {
  return import("@hyperframes/parsers/gsap-parser-recast");
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Resolve the project and file path from the request, validating safety.
 * Returns null (and sends an error response) if anything is invalid.
 */
interface RouteContext {
  req: {
    param: (name: string) => string;
    path: string;
    query: (name: string) => string | undefined;
  };
  json: (data: unknown, status?: number) => Response;
}

interface ResolvedGsapFile {
  project: { dir: string };
  filePath: string;
  absPath: string;
}

/** Resolve project + safe absolute path for any project-scoped route. */
async function resolveProjectPath(
  c: RouteContext,
  adapter: StudioApiAdapter,
  pathPrefix: (projectId: string) => string,
  opts?: { mustExist?: boolean },
) {
  const id = c.req.param("id");
  const project = await adapter.resolveProject(id);
  if (!project) {
    return { error: c.json({ error: "not found" }, 404) } as const;
  }

  const filePath = decodeURIComponent(c.req.path.replace(pathPrefix(project.id), ""));
  if (filePath.includes("\0")) {
    return { error: c.json({ error: "forbidden" }, 403) } as const;
  }

  const absPath = resolveWithinProject(project.dir, filePath);
  if (!absPath) {
    return { error: c.json({ error: "forbidden" }, 403) } as const;
  }

  if (opts?.mustExist && !existsSync(absPath)) {
    return { error: c.json({ error: "not found" }, 404) } as const;
  }

  return { project, filePath, absPath } as const;
}

function resolveProjectFile(
  c: RouteContext,
  adapter: StudioApiAdapter,
  opts?: { mustExist?: boolean },
) {
  return resolveProjectPath(c, adapter, (id) => `/projects/${id}/files/`, opts);
}

function resolveFileMutationContext(c: RouteContext, adapter: StudioApiAdapter, operation: string) {
  return resolveProjectPath(c, adapter, (id) => `/projects/${id}/file-mutations/${operation}/`);
}

type MutationTarget = {
  id?: string | null;
  hfId?: string;
  selector?: string;
  selectorIndex?: number;
};

interface ElementPatchRequest {
  target: MutationTarget;
  operations: PatchOperation[];
}

function foldElementPatches(
  originalContent: string,
  patches: ElementPatchRequest[],
): { content: string; matched: boolean[] } {
  let content = originalContent;
  const matched: boolean[] = [];
  for (const patch of patches) {
    const result = patchElementInHtml(content, patch.target, patch.operations);
    content = result.html;
    matched.push(result.matched);
  }
  return { content, matched };
}

/** Write `next` to `absPath` only if it differs from `original`, returning a standardized change response. */
function writeIfChanged(
  c: RouteContext,
  projectDir: string,
  filePath: string,
  absPath: string,
  original: string,
  next: string,
): Response {
  if (next === original) {
    return c.json({ ok: true, changed: false, content: original, path: filePath });
  }
  const backup = snapshotBeforeWrite(projectDir, absPath);
  if (backup.error) console.warn(`Failed to create backup for ${filePath}: ${backup.error}`);
  writeFileSync(absPath, next, "utf-8");
  return c.json({
    ok: true,
    changed: true,
    content: next,
    path: filePath,
    backupPath: backupPathForResponse(projectDir, backup.backupPath),
  });
}

function rejectUnsafeMutationValues(
  c: RouteContext,
  unsafeFields: UnsafeMutationValue[],
): Response {
  return c.json(
    {
      error: "mutation contains unsafe values",
      fields: unsafeFields.map((field) => field.path),
      unsafeValues: unsafeFields,
    },
    400,
  );
}

/**
 * Parse the request body and validate that `target` is present.
 * Returns `{ error }` if missing, or `{ target, body }` for the full parsed body.
 */
async function parseMutationBody<T extends { target?: MutationTarget }>(
  c: RouteContext & { req: { json(): Promise<unknown> } },
): Promise<{ error: Response } | { target: MutationTarget; body: T }> {
  const body = (await (c.req as { json(): Promise<unknown> }).json().catch(() => null)) as T | null;
  if (!body?.target) {
    return { error: c.json({ error: "target required" }, 400) };
  }
  return { target: body.target, body };
}

/** Ensure the parent directory of a path exists. */
function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Generate a copy name: foo.html → foo (copy).html → foo (copy 2).html
 */
function generateCopyPath(projectDir: string, originalPath: string): string {
  const ext = originalPath.includes(".") ? "." + originalPath.split(".").pop() : "";
  const base = ext ? originalPath.slice(0, -ext.length) : originalPath;

  // If already a copy, increment the number
  const copyMatch = base.match(/ \(copy(?: (\d+))?\)$/);
  const cleanBase = copyMatch ? base.slice(0, -copyMatch[0].length) : base;
  let num = copyMatch ? (copyMatch[1] ? parseInt(copyMatch[1]) + 1 : 2) : 1;

  let candidate = num === 1 ? `${cleanBase} (copy)${ext}` : `${cleanBase} (copy ${num})${ext}`;
  while (existsSync(resolve(projectDir, candidate))) {
    num++;
    candidate = `${cleanBase} (copy ${num})${ext}`;
  }

  return candidate;
}

/**
 * Walk a directory recursively and return all file paths matching a filter.
 */
function walkFiles(dir: string, filter: (name: string) => boolean): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".thumbnails" || entry.name === "renders")
        continue;
      results.push(...walkFiles(full, filter));
    } else if (filter(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * After a rename, update all references to the old path in project files.
 * Scans HTML, CSS, JS, and JSON files for the old filename/path and replaces.
 */
function updateReferences(projectDir: string, oldPath: string, newPath: string): number {
  const textFiles = walkFiles(projectDir, (name) =>
    /\.(html|css|js|jsx|ts|tsx|json|mjs|cjs|md|mdx)$/i.test(name),
  );

  let updatedCount = 0;
  for (const file of textFiles) {
    const content = readFileSync(file, "utf-8");

    // Only replace full relative paths — never bare filenames, which can
    // corrupt unrelated content (e.g. "logo.png" inside "my-logo.png").
    if (!content.includes(oldPath)) continue;

    const updated = content.split(oldPath).join(newPath);
    if (updated !== content) {
      writeFileSync(file, updated, "utf-8");
      updatedCount++;
    }
  }
  return updatedCount;
}

// ── GSAP script extraction ──────────────────────────────────────────────────

/**
 * Parse an HTML string with linkedom, locate the inline `<script>` that
 * contains GSAP timeline code, and return both its text content and a
 * function that replaces that script block and serialises back to HTML.
 */
function extractGsapScriptBlock(html: string): {
  scriptText: string;
  document: Document;
  replaceScript: (newText: string) => string;
} | null {
  const { document } = parseHTML(html);
  const scripts = [
    ...document.querySelectorAll("script:not([src])"),
    ...Array.from(document.querySelectorAll("template")).flatMap((tmpl) =>
      Array.from(tmpl.querySelectorAll("script:not([src])")),
    ),
  ];
  for (const script of scripts) {
    const content = script.textContent || "";
    if (
      content.includes("gsap.timeline") ||
      content.includes(".set(") ||
      content.includes(".to(")
    ) {
      return {
        scriptText: content,
        document,
        replaceScript(newText: string): string {
          script.textContent = newText;
          return document.toString();
        },
      };
    }
  }
  return null;
}

/**
 * Remove every GSAP animation that targets `selector` from an HTML string's
 * inline script. Used after unwrapping a group so its leftover `gsap.set("#id")`
 * (the wrapper is gone) doesn't throw "target not found" on every preview run.
 */
function stripGsapAnimationsForSelector(html: string, selector: string): string {
  const block = extractGsapScriptBlock(html);
  if (!block) return html;
  const parsed = parseGsapScriptAcorn(block.scriptText);
  const matching = parsed.animations.filter((a) => a.targetSelector === selector);
  if (matching.length === 0) return html;
  let script = block.scriptText;
  // Reverse so earlier removals don't shift the spans of later ones.
  for (const anim of [...matching].reverse()) {
    script = removeAnimationFromScript(script, anim.id);
  }
  return block.replaceScript(script);
}

/**
 * Bake a group's STATIC GSAP transform into each member BEFORE the group is
 * stripped on ungroup. Moving a group is stored as `gsap.set("#group-1",{x,y,…})`;
 * without distributing it to the members they snap back to their creation-time
 * positions. Translation (x/y/z) is an exact per-axis add; rotation/scale are
 * composed about the group's centre (the pivot) so off-centre members don't drift.
 * Animated group transforms (keyframes/tweens) are NOT baked — left to be stripped.
 */
function bakeGroupTransformIntoMembers(
  html: string,
  groupId: string,
  members: Array<{ id: string; cx: number; cy: number }>,
  groupCenter: { cx: number; cy: number },
): string {
  const block = extractGsapScriptBlock(html);
  if (!block) return html;
  const parsed = parseGsapScriptAcorn(block.scriptText);
  const groupSel = `#${groupId}`;
  const groupSets = parsed.animations.filter(
    (a) => a.targetSelector === groupSel && a.method === "set",
  );
  if (groupSets.length === 0) return html;
  // Merge the group's sets (later per-prop wins) → its effective static transform.
  const gt: Record<string, number> = {};
  for (const s of groupSets) {
    for (const [k, v] of Object.entries(s.properties)) if (typeof v === "number") gt[k] = v;
  }
  const gx = gt.x ?? 0;
  const gy = gt.y ?? 0;
  const gz = gt.z ?? 0;
  const grot = gt.rotation ?? 0;
  const gscale = gt.scale ?? 1;
  // Identity across ALL axes (incl. the extras baked below) — else a group whose
  // only transform is e.g. scaleX would skip the bake and silently drop it.
  const isScaleAxis = (k: string) => k === "scale" || k === "scaleX" || k === "scaleY";
  const groupIsIdentity = Object.entries(gt).every(([k, v]) =>
    isScaleAxis(k) ? v === 1 : v === 0,
  );
  if (groupIsIdentity) return html;

  const rad = (grot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const round3 = (n: number) => Math.round(n * 1000) / 1000;

  let script = block.scriptText;
  for (const m of members) {
    const memberSel = `#${m.id}`;
    const sets = parsed.animations.filter(
      (a) => a.targetSelector === memberSel && a.method === "set",
    );
    // Effective member transform (merge its sets — last per-prop wins).
    const mProps: Record<string, number | string> = {};
    for (const s of sets) Object.assign(mProps, s.properties);
    const mx = typeof mProps.x === "number" ? mProps.x : 0;
    const my = typeof mProps.y === "number" ? mProps.y : 0;
    // Compose the group transform onto the member's centre, then back to an offset.
    const dx = m.cx + mx - groupCenter.cx;
    const dy = m.cy + my - groupCenter.cy;
    const visX = groupCenter.cx + gscale * (cos * dx - sin * dy) + gx;
    const visY = groupCenter.cy + gscale * (sin * dx + cos * dy) + gy;
    const newProps: Record<string, number | string> = {
      ...mProps,
      x: round3(visX - m.cx),
      y: round3(visY - m.cy),
    };
    if (gz !== 0) newProps.z = (typeof mProps.z === "number" ? mProps.z : 0) + gz;
    if (grot !== 0) {
      newProps.rotation = round3(
        (typeof mProps.rotation === "number" ? mProps.rotation : 0) + grot,
      );
    }
    if (gscale !== 1) {
      newProps.scale = round3((typeof mProps.scale === "number" ? mProps.scale : 1) * gscale);
    }
    // Bake any REMAINING group transform axis so nothing is silently dropped on
    // ungroup. The pivot-composed axes (x/y/z/rotation/scale) are handled above;
    // these extras (scaleX/Y, rotationX/Y/Z, skewX/Y, transformPerspective) compose
    // about the member's own origin — exact for a member at the group centre, a
    // close approximation otherwise (groups rarely carry these).
    const pivoted = new Set(["x", "y", "z", "rotation", "scale"]);
    for (const [k, v] of Object.entries(gt)) {
      if (pivoted.has(k) || typeof v !== "number") continue;
      if (k === "scaleX" || k === "scaleY") {
        if (v !== 1) newProps[k] = round3((typeof mProps[k] === "number" ? mProps[k] : 1) * v);
      } else if (k === "transformPerspective") {
        // Adopt the group's lens only if the member has none of its own — never
        // silently overwrite a member's existing perspective.
        if (typeof mProps[k] !== "number") newProps[k] = v;
      } else if (v !== 0) {
        newProps[k] = round3((typeof mProps[k] === "number" ? mProps[k] : 0) + v);
      }
    }

    // Strip ALL the member's existing sets and write ONE fresh gsap.set at position
    // 0. The baked transform is the member's static base — writing it to an arbitrary
    // "last" set could land it at a non-zero timeline position, or leave stale earlier
    // sets that override it. Reverse-remove so spans don't shift, then add fresh.
    for (const s of [...sets].reverse()) {
      script = removeAnimationFromScript(script, s.id);
    }
    script = addAnimationToScript(script, {
      targetSelector: memberSel,
      method: "set",
      position: 0,
      properties: newProps,
      global: true,
    }).script;
  }
  return block.replaceScript(script);
}

function stripStudioEditsFromTarget(document: Document, selector: string): number {
  if (!selector) return 0;
  let stripped = 0;
  try {
    for (const el of document.querySelectorAll(selector)) {
      if (!isHTMLElement(el)) continue;
      const htmlEl = el;
      let touched = false;
      // Manual path offset (--hf-studio-offset / translate) — a GSAP position tween
      // now owns position, so the stale offset channel must go.
      if (el.getAttribute("data-hf-studio-path-offset")) {
        const originalTranslate = el.getAttribute("data-hf-studio-original-inline-translate");
        htmlEl.style.removeProperty("--hf-studio-offset-x");
        htmlEl.style.removeProperty("--hf-studio-offset-y");
        if (originalTranslate) {
          htmlEl.style.setProperty("translate", originalTranslate);
        } else {
          htmlEl.style.removeProperty("translate");
        }
        el.removeAttribute("data-hf-studio-path-offset");
        el.removeAttribute("data-hf-studio-original-translate");
        el.removeAttribute("data-hf-studio-original-inline-translate");
        touched = true;
      }
      // Manual rotation (--hf-studio-rotation / rotate) — likewise, a GSAP rotation
      // set/tween now owns rotation, so clear the legacy CSS-var channel.
      if (el.getAttribute("data-hf-studio-rotation")) {
        const originalRotate = el.getAttribute("data-hf-studio-original-inline-rotate");
        const originalOrigin = el.getAttribute("data-hf-studio-original-rotation-transform-origin");
        htmlEl.style.removeProperty("--hf-studio-rotation");
        if (originalRotate) {
          htmlEl.style.setProperty("rotate", originalRotate);
        } else {
          htmlEl.style.removeProperty("rotate");
        }
        if (originalOrigin) {
          htmlEl.style.setProperty("transform-origin", originalOrigin);
        } else {
          htmlEl.style.removeProperty("transform-origin");
        }
        el.removeAttribute("data-hf-studio-rotation");
        el.removeAttribute("data-hf-studio-rotation-draft");
        el.removeAttribute("data-hf-studio-original-rotate");
        el.removeAttribute("data-hf-studio-original-inline-rotate");
        el.removeAttribute("data-hf-studio-original-rotation-transform-origin");
        touched = true;
      }
      if (touched) stripped++;
    }
  } catch {
    // Invalid selector — skip silently.
  }
  return stripped;
}

// A studio path-offset (--hf-studio-offset / data-hf-studio-path-offset) and a GSAP
// position tween both drive translate — keeping both stacks the offsets (a gesture or
// drag recorded over a stale offset plays shoved off-position). When a committed tween
// writes a position property, the tween owns position, so the stale offset must go.
function keyframesWritePosition(
  keyframes: Array<{ properties: Record<string, number | string> }>,
): boolean {
  return keyframes.some((kf) =>
    Object.keys(kf.properties).some((k) => classifyPropertyGroup(k) === "position"),
  );
}

// A studio rotation edit (--hf-studio-rotation / data-hf-studio-rotation) and a GSAP
// rotation tween both drive rotate — keeping both stacks them. When a committed keyframe
// set writes a rotation property, the tween owns rotation, so the stale CSS-var channel
// must go (the position twin of this is `keyframesWritePosition`).
function keyframesWriteRotation(
  keyframes: Array<{ properties: Record<string, number | string> }>,
): boolean {
  return keyframes.some((kf) =>
    Object.keys(kf.properties).some((k) => classifyPropertyGroup(k) === "rotation"),
  );
}

function lastKeyframeOpacity(kfs: GsapAnimation["keyframes"]): number | string | undefined {
  if (!kfs) return undefined;
  for (let i = kfs.keyframes.length - 1; i >= 0; i--) {
    if ("opacity" in kfs.keyframes[i]!.properties) return kfs.keyframes[i]!.properties.opacity;
  }
  return undefined;
}

function resolveFinalOpacity(anim: GsapAnimation): number | null {
  if (anim.method === "from") return null;
  const raw = anim.keyframes ? lastKeyframeOpacity(anim.keyframes) : anim.properties.opacity;
  if (raw == null) return null;
  if (typeof raw === "string" && /^[+\-*]=/.test(raw)) return null;
  const num = Number(raw);
  return Number.isFinite(num) && num !== 0 ? num : null;
}

function bakeVisibilityOnDelete(document: Document, anim: GsapAnimation): void {
  const opacity = resolveFinalOpacity(anim);
  if (opacity === null) return;
  try {
    for (const el of document.querySelectorAll(anim.targetSelector)) {
      if (isHTMLElement(el)) el.style.setProperty("opacity", String(opacity));
    }
  } catch {
    // Invalid selector — skip silently.
  }
}

// ── GSAP mutation types ─────────────────────────────────────────────────────

type GsapMutationRequest =
  | {
      type: "update-property";
      animationId: string;
      property: string;
      value: number | string;
    }
  | {
      // Merge MULTIPLE properties into an animation in ONE call. A per-property
      // loop on a `set` can shift its group-derived id mid-way (e.g. adding `scale`
      // to a rotation set), 404-ing the next update; this lands them all at once.
      type: "update-properties";
      animationId: string;
      properties: Record<string, number | string>;
    }
  | {
      type: "update-from-property";
      animationId: string;
      property: string;
      value: number | string;
    }
  | {
      type: "update-meta";
      animationId: string;
      updates: {
        duration?: number;
        ease?: string;
        easeEach?: string;
        position?: number;
        resetKeyframeEases?: boolean;
      };
    }
  | {
      type: "add";
      targetSelector: string;
      method: "to" | "from" | "set" | "fromTo";
      position: number;
      duration?: number;
      ease?: string;
      properties: Record<string, number | string>;
      fromProperties?: Record<string, number | string>;
      /** Emit a base `gsap.set` (off-timeline, no keyframe marker) instead of `tl.set`. */
      global?: boolean;
    }
  | { type: "delete"; animationId: string; stripStudioEdits?: boolean }
  | {
      type: "add-property";
      animationId: string;
      property: string;
      defaultValue: number | string;
    }
  | {
      type: "add-from-property";
      animationId: string;
      property: string;
      defaultValue: number | string;
    }
  | { type: "remove-property"; animationId: string; property: string }
  | { type: "remove-from-property"; animationId: string; property: string }
  | {
      type: "add-keyframe";
      animationId: string;
      percentage: number;
      properties: Record<string, number | string>;
      ease?: string;
      backfillDefaults?: Record<string, number | string>;
    }
  | { type: "remove-keyframe"; animationId: string; percentage: number }
  | {
      type: "move-keyframe";
      animationId: string;
      fromPercentage: number;
      toPercentage: number;
    }
  | {
      // Boundary drag-to-retime: grow/shift a keyframed tween's window and re-key
      // its existing keyframes in place (preserves _auto / per-keyframe ease /
      // easeEach / outer ease, unlike the array-rebuild replace-with-keyframes).
      type: "resize-keyframed-tween";
      animationId: string;
      position: number;
      duration: number;
      pctRemap: Array<{ from: number; to: number }>;
    }
  | {
      type: "update-keyframe";
      animationId: string;
      percentage: number;
      properties: Record<string, number | string>;
      ease?: string;
    }
  | {
      type: "convert-to-keyframes";
      animationId: string;
      resolvedFromValues?: Record<string, number | string>;
      /** Duration (s) to give a converted static `set`, which has none. */
      duration?: number;
    }
  | { type: "remove-all-keyframes"; animationId: string }
  | {
      type: "materialize-keyframes";
      animationId: string;
      keyframes: Array<{
        percentage: number;
        properties: Record<string, number | string>;
        ease?: string;
      }>;
      easeEach?: string;
      resolvedSelector?: string;
      allElements?: Array<{
        selector: string;
        keyframes: Array<{ percentage: number; properties: Record<string, number | string> }>;
        easeEach?: string;
      }>;
    }
  | {
      type: "set-arc-path";
      animationId: string;
      enabled: boolean;
      autoRotate?: boolean | number;
      segments?: Array<{
        curviness: number;
        cp1?: { x: number; y: number };
        cp2?: { x: number; y: number };
      }>;
    }
  | {
      type: "update-arc-segment";
      animationId: string;
      segmentIndex: number;
      curviness?: number;
      cp1?: { x: number; y: number };
      cp2?: { x: number; y: number };
    }
  | {
      type: "update-motion-path-point";
      animationId: string;
      pointIndex: number;
      x: number;
      y: number;
    }
  | { type: "add-motion-path-point"; animationId: string; index: number; x: number; y: number }
  | { type: "remove-motion-path-point"; animationId: string; index: number }
  | {
      type: "add-motion-path";
      targetSelector: string;
      position: number;
      duration: number;
      x: number;
      y: number;
      ease?: string;
    }
  | { type: "remove-arc-path"; animationId: string }
  | {
      type: "add-with-keyframes";
      targetSelector: string;
      position: number;
      duration: number;
      keyframes: Array<{
        percentage: number;
        properties: Record<string, number | string>;
        ease?: string;
        auto?: boolean;
      }>;
      ease?: string;
      easeEach?: string;
    }
  | {
      type: "replace-with-keyframes";
      animationId: string;
      targetSelector: string;
      position: number;
      duration: number;
      keyframes: Array<{
        percentage: number;
        properties: Record<string, number | string>;
        ease?: string;
        auto?: boolean;
      }>;
      ease?: string;
    }
  | {
      type: "split-animations";
      originalId: string;
      newId: string;
      splitTime: number;
      elementStart: number;
      elementDuration: number;
    }
  | {
      type: "split-into-property-groups";
      animationId: string;
    }
  | {
      type: "delete-all-for-selector";
      targetSelector: string;
    }
  | {
      // Enforce "exactly one position write per element": keep `keepAnimationId`
      // (the write the commit is editing) and strip every other pure-position
      // write for the selector. Self-heals files that already have duplicates.
      type: "consolidate-position-writes";
      targetSelector: string;
      keepAnimationId?: string;
    }
  | {
      // Rewrite all top-level helper/loop constructs into literal tweens so
      // computed keyframes become directly editable (visual no-op).
      type: "unroll-timeline";
    }
  | {
      type: "shift-positions";
      targetSelector: string;
      delta: number;
    }
  | {
      // Batched shift: fold shiftPositionsInScript over N selectors in one write.
      // Lets a multi-clip timeline move (ripple / insert) shift every affected
      // clip's tweens atomically instead of one racing server round-trip per clip.
      type: "shift-positions-batch";
      shifts: Array<{ targetSelector: string; delta: number }>;
    }
  | {
      type: "scale-positions";
      targetSelector: string;
      oldStart: number;
      oldDuration: number;
      newStart: number;
      newDuration: number;
    };

// ── GSAP mutation executor ──────────────────────────────────────────────────

type GsapMutationResult = string | { script: string; skippedSelectors: string[] };

// Mutations that can change a position tween's first keyframe (value/existence/timing)
// and therefore require the pre-keyframe hold-`set`s to be re-synced afterwards.
// `syncPositionHoldsBeforeKeyframes` rebuilds all `hf-hold` sets from scratch: it acts
// on every tween that has keyframes whose first percentage carries a position prop and
// whose start is > 0. So any mutation that creates such a tween, retargets it, or moves
// its start across the t=0 boundary must trigger a re-sync.
const HOLD_SYNC_MUTATION_TYPES = new Set<string>([
  "add-keyframe",
  "update-keyframe",
  "remove-keyframe",
  "move-keyframe",
  "resize-keyframed-tween",
  "remove-all-keyframes",
  "add-with-keyframes",
  "replace-with-keyframes",
  "convert-to-keyframes",
  "materialize-keyframes",
  "update-motion-path-point",
  "add-motion-path-point",
  "remove-motion-path-point",
  // Authors a fresh motionPath tween whose parsed first keyframe is (0,0); if it lands
  // at position > 0 the element snaps home at t=0 without a pre-tween hold-`set`.
  "add-motion-path",
  // Can move a tween's `position` (start) across the t=0 boundary, which flips whether a
  // keyframed position tween needs a hold (started at 0 → moved later, or vice versa).
  "update-meta",
  // Time-shift / time-scale tweens, which can move a keyframed position tween's start
  // across t=0, flipping hold need; stale holds are not repositioned by these ops.
  "shift-positions",
  "shift-positions-batch",
  "scale-positions",
  // Retargets keyframed position tweens to a cloned element's selector; the old hold is
  // keyed to the prior selector, so holds must be rebuilt for the new target.
  "split-animations",
  "delete",
  "delete-all-for-selector",
]);

async function executeGsapMutation(
  body: GsapMutationRequest,
  block: NonNullable<ReturnType<typeof extractGsapScriptBlock>>,
  respond: (data: unknown, status?: number) => Response,
): Promise<GsapMutationResult | Response> {
  // When the server cutover flag is enabled, delegate to the acorn writer;
  // otherwise use the recast writer (gsapParser.ts) as the default.
  if (!isAcornGsapWriterEnabled()) {
    return executeGsapMutationRecast(body, block, respond);
  }
  return executeGsapMutationAcorn(body, block, respond);
}

function validateGsapMutationRequest(
  c: RouteContext,
  body: GsapMutationRequest | null,
): Response | null {
  if (!body || typeof body !== "object" || !("type" in body) || !body.type) {
    return c.json({ error: "mutation type required" }, 400);
  }
  const unsafeFields = findUnsafeMutationValues(body);
  if (unsafeFields.length > 0) return rejectUnsafeMutationValues(c, unsafeFields);
  if (
    body.type === "shift-positions-batch" &&
    (!("shifts" in body) || !Array.isArray(body.shifts))
  ) {
    return c.json({ error: "shift-positions-batch requires a `shifts` array" }, 400);
  }
  return null;
}

async function prepareGsapMutationScript(
  c: RouteContext,
  res: ResolvedGsapFile,
  firstMutation: GsapMutationRequest,
): Promise<
  | Response
  | {
      html: string;
      block: NonNullable<ReturnType<typeof extractGsapScriptBlock>>;
    }
> {
  let html = readFileSync(res.absPath, "utf-8");
  let block = extractGsapScriptBlock(html);
  if (!block && (firstMutation.type === "add" || firstMutation.type === "add-with-keyframes")) {
    const compId = html.match(/data-composition-id="([^"]+)"/)?.[1] ?? "main";
    const { GSAP_CDN } = await import("@hyperframes/core");
    const bootstrap = [
      `<script src="${GSAP_CDN}"></script>`,
      "<script>",
      "window.__timelines = window.__timelines || {};",
      "const tl = gsap.timeline({ paused: true });",
      `window.__timelines["${compId}"] = tl;`,
      "</script>",
    ].join("\n");
    html = html.includes("</body>")
      ? html.replace("</body>", `${bootstrap}\n</body>`)
      : `${html}\n${bootstrap}`;
    block = extractGsapScriptBlock(html);
  }
  if (
    !block &&
    (firstMutation.type === "shift-positions" ||
      firstMutation.type === "scale-positions" ||
      firstMutation.type === "shift-positions-batch")
  ) {
    return c.json({
      ok: true,
      changed: false,
      mutated: false,
      parsed: { animations: [], timelineVar: "tl", preamble: "", postamble: "" },
      before: html,
      after: html,
      scriptText: "",
      path: res.filePath,
      backupPath: null,
    });
  }
  if (!block) return c.json({ error: "no GSAP script found in file" }, 400);
  return { html, block };
}

async function applyGsapMutations(
  c: RouteContext,
  res: ResolvedGsapFile,
  mutations: GsapMutationRequest[],
): Promise<Response> {
  const firstMutation = mutations[0];
  if (!firstMutation) return c.json({ error: "mutations array required" }, 400);
  const prepared = await prepareGsapMutationScript(c, res, firstMutation);
  if (prepared instanceof Response) return prepared;
  const { html, block } = prepared;

  const initialScript = block.scriptText;
  const skippedSelectors = new Set<string>();
  const respond = (data: unknown, status?: number) =>
    status ? c.json(data, status) : c.json(data);

  for (const mutation of mutations) {
    const result = await executeGsapMutation(mutation, block, respond);
    if (result instanceof Response) return result;
    let newScript = typeof result === "string" ? result : result.script;
    if (typeof result !== "string") {
      for (const selector of result.skippedSelectors) skippedSelectors.add(selector);
    }
    if (HOLD_SYNC_MUTATION_TYPES.has(mutation.type)) {
      const parser = await loadGsapParser();
      newScript = parser.syncPositionHoldsBeforeKeyframes(newScript);
    }
    block.scriptText = newScript;
  }

  const changed = block.scriptText !== initialScript;
  const newHtml = changed ? block.replaceScript(block.scriptText) : html;
  let backupPath: string | null = null;
  if (changed) {
    const backup = snapshotBeforeWrite(res.project.dir, res.absPath);
    if (backup.error) console.warn(`Failed to create backup for ${res.filePath}: ${backup.error}`);
    backupPath = backupPathForResponse(res.project.dir, backup.backupPath);
    writeFileSync(res.absPath, newHtml, "utf-8");
  }

  const responsePayload: Record<string, unknown> = {
    ok: true,
    changed,
    mutated: changed,
    parsed: parseGsapScriptAcorn(block.scriptText),
    before: html,
    after: newHtml,
    scriptText: block.scriptText,
    path: res.filePath,
    backupPath,
  };
  if (skippedSelectors.size > 0) responsePayload.skippedSelectors = [...skippedSelectors];
  return c.json(responsePayload);
}

function executeGsapMutationAcorn(
  body: GsapMutationRequest,
  block: NonNullable<ReturnType<typeof extractGsapScriptBlock>>,
  respond: (data: unknown, status?: number) => Response,
): GsapMutationResult | Response {
  function requireAnimation(
    scriptText: string,
    animationId: string,
  ): { anim: GsapAnimation } | { err: Response } {
    const parsed = parseGsapScriptAcorn(scriptText);
    const anim = parsed.animations.find((a) => a.id === animationId);
    if (!anim) return { err: respond({ error: "animation not found" }, 404) };
    return { anim };
  }

  function requireFromToAnimation(
    scriptText: string,
    animationId: string,
  ): { anim: GsapAnimation } | { err: Response } {
    const result = requireAnimation(scriptText, animationId);
    if ("err" in result) return result;
    if (result.anim.method !== "fromTo")
      return { err: respond({ error: "animation is not a fromTo" }, 400) };
    return result;
  }

  switch (body.type) {
    case "update-property":
    case "add-property": {
      const r = requireAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      const val = body.type === "update-property" ? body.value : body.defaultValue;
      return updateAnimationInScript(block.scriptText, body.animationId, {
        properties: { ...r.anim.properties, [body.property]: val },
      });
    }
    case "update-properties": {
      const r = requireAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      return updateAnimationInScript(block.scriptText, body.animationId, {
        properties: { ...r.anim.properties, ...body.properties },
      });
    }
    case "update-from-property":
    case "add-from-property": {
      const r = requireFromToAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      const val = body.type === "update-from-property" ? body.value : body.defaultValue;
      return updateAnimationInScript(block.scriptText, body.animationId, {
        fromProperties: { ...(r.anim.fromProperties ?? {}), [body.property]: val },
      });
    }
    case "update-meta": {
      return updateAnimationInScript(block.scriptText, body.animationId, body.updates);
    }
    case "add": {
      if (body.fromProperties && body.method !== "fromTo") {
        return respond({ error: "fromProperties is only valid for method=fromTo" }, 400);
      }
      const result = addAnimationToScript(block.scriptText, {
        targetSelector: body.targetSelector,
        method: body.method,
        position: body.position,
        duration: body.duration,
        ease: body.ease,
        properties: body.properties,
        fromProperties: body.fromProperties,
        ...(body.global ? { global: true } : {}),
      });
      return result.script;
    }
    case "delete": {
      const delTarget = requireAnimation(block.scriptText, body.animationId);
      if (!("err" in delTarget) && body.stripStudioEdits) {
        stripStudioEditsFromTarget(block.document, delTarget.anim.targetSelector);
        bakeVisibilityOnDelete(block.document, delTarget.anim);
      }
      return removeAnimationFromScript(block.scriptText, body.animationId);
    }
    case "delete-all-for-selector": {
      const parsed = parseGsapScriptAcorn(block.scriptText);
      const matching = parsed.animations.filter((a) => a.targetSelector === body.targetSelector);
      if (matching.length === 0) return block.scriptText;
      stripStudioEditsFromTarget(block.document, body.targetSelector);
      let script = block.scriptText;
      for (const anim of matching.reverse()) {
        script = removeAnimationFromScript(script, anim.id);
      }
      return script;
    }
    case "consolidate-position-writes": {
      if (!body.targetSelector) return block.scriptText;
      return dedupePositionWritesInScript(
        block.scriptText,
        body.targetSelector,
        body.keepAnimationId,
      );
    }
    case "remove-property": {
      const r = requireAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      const filtered = { ...r.anim.properties };
      delete filtered[body.property];
      return updateAnimationInScript(block.scriptText, body.animationId, {
        properties: filtered,
      });
    }
    case "remove-from-property": {
      const r = requireFromToAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      const filtered = { ...(r.anim.fromProperties ?? {}) };
      delete filtered[body.property];
      return updateAnimationInScript(block.scriptText, body.animationId, {
        fromProperties: filtered,
      });
    }
    case "add-keyframe": {
      return addKeyframeToScript(
        block.scriptText,
        body.animationId,
        body.percentage,
        body.properties,
        body.ease,
        body.backfillDefaults,
      );
    }
    case "remove-keyframe": {
      return removeKeyframeFromScript(block.scriptText, body.animationId, body.percentage);
    }
    case "move-keyframe": {
      return moveKeyframeInScript(
        block.scriptText,
        body.animationId,
        body.fromPercentage,
        body.toPercentage,
      );
    }
    case "resize-keyframed-tween": {
      return resizeKeyframedTweenInScript(
        block.scriptText,
        body.animationId,
        body.position,
        body.duration,
        body.pctRemap,
      );
    }
    case "update-keyframe": {
      return updateKeyframeInScript(
        block.scriptText,
        body.animationId,
        body.percentage,
        body.properties,
        body.ease,
      );
    }
    case "convert-to-keyframes": {
      return convertToKeyframesFromScript(
        block.scriptText,
        body.animationId,
        body.resolvedFromValues,
        body.duration,
      );
    }
    case "remove-all-keyframes": {
      const preCollapse = requireAnimation(block.scriptText, body.animationId);
      if (!("err" in preCollapse)) {
        bakeVisibilityOnDelete(block.document, preCollapse.anim);
      }
      return removeAllKeyframesFromScript(block.scriptText, body.animationId);
    }
    case "materialize-keyframes": {
      if (body.allElements && body.allElements.length > 0) {
        return unrollDynamicAnimations(block.scriptText, body.animationId, body.allElements);
      }
      return materializeKeyframesFromScript(
        block.scriptText,
        body.animationId,
        body.keyframes,
        body.easeEach,
        body.resolvedSelector,
      );
    }
    case "set-arc-path": {
      return setArcPathInScript(block.scriptText, body.animationId, {
        enabled: body.enabled,
        autoRotate: body.autoRotate ?? false,
        segments: body.segments ?? [],
      });
    }
    case "update-arc-segment": {
      return updateArcSegmentInScript(block.scriptText, body.animationId, body.segmentIndex, {
        ...(body.curviness !== undefined ? { curviness: body.curviness } : {}),
        ...(body.cp1 ? { cp1: body.cp1 } : {}),
        ...(body.cp2 ? { cp2: body.cp2 } : {}),
      });
    }
    case "remove-arc-path": {
      return removeArcPathFromScript(block.scriptText, body.animationId);
    }
    case "add-with-keyframes": {
      const result = addAnimationWithKeyframesToScript(
        block.scriptText,
        body.targetSelector,
        body.position,
        body.duration,
        body.keyframes,
        body.ease,
        body.easeEach,
      );
      return result.script;
    }
    case "replace-with-keyframes": {
      const script = removeAnimationFromScript(block.scriptText, body.animationId);
      const added = addAnimationWithKeyframesToScript(
        script,
        body.targetSelector,
        body.position,
        body.duration,
        body.keyframes,
        body.ease,
      );
      return added.script;
    }
    case "split-animations": {
      if (
        typeof body.originalId !== "string" ||
        !body.originalId ||
        typeof body.newId !== "string" ||
        !body.newId ||
        typeof body.splitTime !== "number" ||
        !Number.isFinite(body.splitTime) ||
        typeof body.elementStart !== "number" ||
        !Number.isFinite(body.elementStart) ||
        typeof body.elementDuration !== "number" ||
        !Number.isFinite(body.elementDuration) ||
        body.elementDuration <= 0
      ) {
        return respond(
          {
            error:
              "split-animations requires originalId, newId (non-empty strings), splitTime, elementStart (finite numbers), and elementDuration (positive number)",
          },
          400,
        );
      }
      return splitAnimationsInScript(block.scriptText, {
        originalId: body.originalId,
        newId: body.newId,
        splitTime: body.splitTime,
        elementStart: body.elementStart,
        elementDuration: body.elementDuration,
      });
    }
    case "split-into-property-groups": {
      const result = splitIntoPropertyGroupsFromScript(block.scriptText, body.animationId);
      return result.script;
    }
    case "unroll-timeline": {
      return unrollComputedTimeline(block.scriptText);
    }
    case "shift-positions": {
      const { targetSelector, delta } = body;
      if (!targetSelector || !Number.isFinite(delta) || delta === 0) return block.scriptText;
      return shiftPositionsInScript(block.scriptText, targetSelector, delta);
    }
    case "shift-positions-batch": {
      let script = block.scriptText;
      for (const s of body.shifts) {
        if (!s.targetSelector || !Number.isFinite(s.delta) || s.delta === 0) continue;
        script = shiftPositionsInScript(script, s.targetSelector, s.delta);
      }
      return script;
    }
    case "scale-positions": {
      const { targetSelector, oldStart, oldDuration, newStart, newDuration } = body;
      if (
        !targetSelector ||
        !Number.isFinite(oldStart) ||
        !Number.isFinite(oldDuration) ||
        !Number.isFinite(newStart) ||
        !Number.isFinite(newDuration) ||
        oldDuration <= 0 ||
        newDuration <= 0
      )
        return block.scriptText;
      if (oldStart === newStart && oldDuration === newDuration) return block.scriptText;
      return scalePositionsInScript(
        block.scriptText,
        targetSelector,
        oldStart,
        oldDuration,
        newStart,
        newDuration,
      );
    }
    default:
      return respond({ error: `unknown mutation type: ${(body as { type: string }).type}` }, 400);
  }
}

async function executeGsapMutationRecast(
  body: GsapMutationRequest,
  block: NonNullable<ReturnType<typeof extractGsapScriptBlock>>,
  respond: (data: unknown, status?: number) => Response,
): Promise<GsapMutationResult | Response> {
  const parser = await loadGsapParser();
  const {
    updateAnimationInScript,
    addAnimationToScript,
    removeAnimationFromScript,
    addKeyframeToScript,
    removeKeyframeFromScript,
    moveKeyframeInScript,
    resizeKeyframedTweenInScript,
    updateKeyframeInScript,
    convertToKeyframesInScript,
    removeAllKeyframesFromScript,
    materializeKeyframesInScript,
    unrollDynamicAnimations,
    setArcPathInScript,
    updateArcSegmentInScript,
    updateMotionPathPointInScript,
    addMotionPathPointInScript,
    removeMotionPathPointInScript,
    addMotionPathToScript,
    removeArcPathFromScript,
    addAnimationWithKeyframesToScript,
    splitAnimationsInScript,
    splitIntoPropertyGroups,
    dedupePositionWritesInScript,
  } = parser;

  function requireAnimation(
    scriptText: string,
    animationId: string,
  ): { anim: GsapAnimation } | { err: Response } {
    const parsed = parseGsapScriptAcorn(scriptText);
    const anim = parsed.animations.find((a) => a.id === animationId);
    if (!anim) return { err: respond({ error: "animation not found" }, 404) };
    return { anim };
  }

  function requireFromToAnimation(
    scriptText: string,
    animationId: string,
  ): { anim: GsapAnimation } | { err: Response } {
    const result = requireAnimation(scriptText, animationId);
    if ("err" in result) return result;
    if (result.anim.method !== "fromTo")
      return { err: respond({ error: "animation is not a fromTo" }, 400) };
    return result;
  }

  switch (body.type) {
    case "update-property":
    case "add-property": {
      const r = requireAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      const val = body.type === "update-property" ? body.value : body.defaultValue;
      return updateAnimationInScript(block.scriptText, body.animationId, {
        properties: { ...r.anim.properties, [body.property]: val },
      });
    }
    case "update-properties": {
      const r = requireAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      return updateAnimationInScript(block.scriptText, body.animationId, {
        properties: { ...r.anim.properties, ...body.properties },
      });
    }
    case "update-from-property":
    case "add-from-property": {
      const r = requireFromToAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      const val = body.type === "update-from-property" ? body.value : body.defaultValue;
      return updateAnimationInScript(block.scriptText, body.animationId, {
        fromProperties: { ...(r.anim.fromProperties ?? {}), [body.property]: val },
      });
    }
    case "update-meta": {
      return updateAnimationInScript(block.scriptText, body.animationId, body.updates);
    }
    case "add": {
      if (body.fromProperties && body.method !== "fromTo") {
        return respond({ error: "fromProperties is only valid for method=fromTo" }, 400);
      }
      // A new position/rotation animation owns that channel — strip the matching
      // legacy studio CSS var (--hf-studio-offset / --hf-studio-rotation) so it can't
      // double with the tween, matching add-with-keyframes/replace-with-keyframes.
      if (
        Object.keys(body.properties).some((k) => {
          const group = classifyPropertyGroup(k);
          return group === "position" || group === "rotation";
        })
      ) {
        stripStudioEditsFromTarget(block.document, body.targetSelector);
      }
      const result = addAnimationToScript(block.scriptText, {
        targetSelector: body.targetSelector,
        method: body.method,
        position: body.position,
        duration: body.duration,
        ease: body.ease,
        properties: body.properties,
        fromProperties: body.fromProperties,
        ...(body.global ? { global: true } : {}),
      });
      return result.script;
    }
    case "delete": {
      const delTarget = requireAnimation(block.scriptText, body.animationId);
      if (!("err" in delTarget) && body.stripStudioEdits) {
        stripStudioEditsFromTarget(block.document, delTarget.anim.targetSelector);
        bakeVisibilityOnDelete(block.document, delTarget.anim);
      }
      return removeAnimationFromScript(block.scriptText, body.animationId);
    }
    case "delete-all-for-selector": {
      const parsed = parseGsapScriptAcorn(block.scriptText);
      const matching = parsed.animations.filter((a) => a.targetSelector === body.targetSelector);
      if (matching.length === 0) return block.scriptText;
      stripStudioEditsFromTarget(block.document, body.targetSelector);
      let script = block.scriptText;
      for (const anim of matching.reverse()) {
        script = removeAnimationFromScript(script, anim.id);
      }
      return script;
    }
    case "consolidate-position-writes": {
      if (!body.targetSelector) return block.scriptText;
      return dedupePositionWritesInScript(
        block.scriptText,
        body.targetSelector,
        body.keepAnimationId,
      );
    }
    case "remove-property": {
      const r = requireAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      const filtered = { ...r.anim.properties };
      delete filtered[body.property];
      return updateAnimationInScript(block.scriptText, body.animationId, {
        properties: filtered,
      });
    }
    case "remove-from-property": {
      const r = requireFromToAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      const filtered = { ...(r.anim.fromProperties ?? {}) };
      delete filtered[body.property];
      return updateAnimationInScript(block.scriptText, body.animationId, {
        fromProperties: filtered,
      });
    }
    case "add-keyframe": {
      return addKeyframeToScript(
        block.scriptText,
        body.animationId,
        body.percentage,
        body.properties,
        body.ease,
        body.backfillDefaults,
      );
    }
    case "remove-keyframe": {
      return removeKeyframeFromScript(block.scriptText, body.animationId, body.percentage);
    }
    case "move-keyframe": {
      return moveKeyframeInScript(
        block.scriptText,
        body.animationId,
        body.fromPercentage,
        body.toPercentage,
      );
    }
    case "resize-keyframed-tween": {
      return resizeKeyframedTweenInScript(
        block.scriptText,
        body.animationId,
        body.position,
        body.duration,
        body.pctRemap,
      );
    }
    case "update-keyframe": {
      return updateKeyframeInScript(
        block.scriptText,
        body.animationId,
        body.percentage,
        body.properties,
        body.ease,
      );
    }
    case "convert-to-keyframes": {
      return convertToKeyframesInScript(
        block.scriptText,
        body.animationId,
        body.resolvedFromValues,
        body.duration,
      );
    }
    case "remove-all-keyframes": {
      const preCollapse = requireAnimation(block.scriptText, body.animationId);
      if (!("err" in preCollapse)) {
        bakeVisibilityOnDelete(block.document, preCollapse.anim);
      }
      return removeAllKeyframesFromScript(block.scriptText, body.animationId);
    }
    case "materialize-keyframes": {
      if (body.allElements && body.allElements.length > 0) {
        return unrollDynamicAnimations(block.scriptText, body.animationId, body.allElements);
      }
      return materializeKeyframesInScript(
        block.scriptText,
        body.animationId,
        body.keyframes,
        body.easeEach,
        body.resolvedSelector,
      );
    }
    case "set-arc-path": {
      return setArcPathInScript(block.scriptText, body.animationId, {
        enabled: body.enabled,
        autoRotate: body.autoRotate ?? false,
        segments: body.segments ?? [],
      });
    }
    case "update-arc-segment": {
      return updateArcSegmentInScript(block.scriptText, body.animationId, body.segmentIndex, {
        ...(body.curviness !== undefined ? { curviness: body.curviness } : {}),
        ...(body.cp1 ? { cp1: body.cp1 } : {}),
        ...(body.cp2 ? { cp2: body.cp2 } : {}),
      });
    }
    case "update-motion-path-point": {
      return updateMotionPathPointInScript(block.scriptText, body.animationId, body.pointIndex, {
        x: body.x,
        y: body.y,
      });
    }
    case "add-motion-path-point": {
      return addMotionPathPointInScript(block.scriptText, body.animationId, body.index, {
        x: body.x,
        y: body.y,
      });
    }
    case "remove-motion-path-point": {
      return removeMotionPathPointInScript(block.scriptText, body.animationId, body.index);
    }
    case "add-motion-path": {
      const result = addMotionPathToScript(
        block.scriptText,
        body.targetSelector,
        body.position,
        body.duration,
        { x: body.x, y: body.y },
        body.ease,
      );
      return result.script;
    }
    case "remove-arc-path": {
      return removeArcPathFromScript(block.scriptText, body.animationId);
    }
    case "add-with-keyframes": {
      if (keyframesWritePosition(body.keyframes) || keyframesWriteRotation(body.keyframes)) {
        stripStudioEditsFromTarget(block.document, body.targetSelector);
      }
      const result = addAnimationWithKeyframesToScript(
        block.scriptText,
        body.targetSelector,
        body.position,
        body.duration,
        body.keyframes,
        body.ease,
      );
      return result.script;
    }
    case "replace-with-keyframes": {
      if (keyframesWritePosition(body.keyframes) || keyframesWriteRotation(body.keyframes)) {
        stripStudioEditsFromTarget(block.document, body.targetSelector);
      }
      const script = removeAnimationFromScript(block.scriptText, body.animationId);
      const added = addAnimationWithKeyframesToScript(
        script,
        body.targetSelector,
        body.position,
        body.duration,
        body.keyframes,
        body.ease,
      );
      return added.script;
    }
    case "split-animations": {
      if (
        typeof body.originalId !== "string" ||
        !body.originalId ||
        typeof body.newId !== "string" ||
        !body.newId ||
        typeof body.splitTime !== "number" ||
        !Number.isFinite(body.splitTime) ||
        typeof body.elementStart !== "number" ||
        !Number.isFinite(body.elementStart) ||
        typeof body.elementDuration !== "number" ||
        !Number.isFinite(body.elementDuration) ||
        body.elementDuration <= 0
      ) {
        return respond(
          {
            error:
              "split-animations requires originalId, newId (non-empty strings), splitTime, elementStart (finite numbers), and elementDuration (positive number)",
          },
          400,
        );
      }
      return splitAnimationsInScript(block.scriptText, {
        originalId: body.originalId,
        newId: body.newId,
        splitTime: body.splitTime,
        elementStart: body.elementStart,
        elementDuration: body.elementDuration,
      });
    }
    case "split-into-property-groups": {
      const result = splitIntoPropertyGroups(block.scriptText, body.animationId);
      return result.script;
    }
    case "unroll-timeline": {
      return unrollComputedTimeline(block.scriptText);
    }
    case "shift-positions": {
      const { targetSelector, delta } = body;
      if (!targetSelector || !Number.isFinite(delta) || delta === 0) return block.scriptText;
      const { shiftPositionsInScript } = parser;
      return shiftPositionsInScript(block.scriptText, targetSelector, delta);
    }
    case "shift-positions-batch": {
      const { shiftPositionsInScript } = parser;
      let script = block.scriptText;
      for (const s of body.shifts) {
        if (!s.targetSelector || !Number.isFinite(s.delta) || s.delta === 0) continue;
        script = shiftPositionsInScript(script, s.targetSelector, s.delta);
      }
      return script;
    }
    case "scale-positions": {
      const { targetSelector, oldStart, oldDuration, newStart, newDuration } = body;
      if (
        !targetSelector ||
        !Number.isFinite(oldStart) ||
        !Number.isFinite(oldDuration) ||
        !Number.isFinite(newStart) ||
        !Number.isFinite(newDuration) ||
        oldDuration <= 0 ||
        newDuration <= 0
      )
        return block.scriptText;
      if (oldStart === newStart && oldDuration === newDuration) return block.scriptText;
      const { scalePositionsInScript } = parser;
      return scalePositionsInScript(
        block.scriptText,
        targetSelector,
        oldStart,
        oldDuration,
        newStart,
        newDuration,
      );
    }
    default:
      return respond({ error: `unknown mutation type: ${(body as { type: string }).type}` }, 400);
  }
}

// ── Upload file processing ──────────────────────────────────────────────────

async function processUploadedFiles(
  formData: FormData,
  targetDir: string,
  projectDir: string,
): Promise<{
  uploaded: string[];
  skipped: string[];
  invalid: Array<{ name: string; reason: string }>;
}> {
  const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB per file
  const uploaded: string[] = [];
  const skipped: string[] = [];
  const invalid: Array<{ name: string; reason: string }> = [];

  // @types/node v25 narrows the ambient `FormData.entries()` to
  // `[string, string]` in workspaces where another dep declares an
  // `onmessage` global (it trips the worker branch of v25's conditional
  // File type). At runtime the value is still `File | string` — cast the
  // iterator so the rest of this block keeps type-checking on every
  // bun-install layout (hoisted on Windows surfaces this; isolated on
  // Linux happens to keep v24 in scope).
  type FileLike = {
    readonly name: string;
    readonly size: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  };
  const entries = formData.entries() as unknown as Iterable<[string, FileLike | string]>;

  // Derive the subdirectory prefix from targetDir relative to projectDir
  const subDir = targetDir === projectDir ? "" : targetDir.slice(projectDir.length + 1);

  for (const [, value] of entries) {
    if (typeof value === "string") continue;

    // Strip path separators — browsers may include directory components
    const name = value.name.split("/").pop()?.split("\\").pop() ?? "";
    if (!name || name.includes("\0") || name.includes("..")) continue;

    // Reject individual files that exceed the size limit
    if (value.size > MAX_UPLOAD_BYTES) {
      skipped.push(name);
      continue;
    }

    const destPath = resolve(targetDir, name);
    if (!isSafePath(projectDir, destPath)) continue;

    // Don't overwrite — append (2), (3), etc.
    let finalPath = destPath;
    let finalName = name;
    if (existsSync(finalPath)) {
      // Handle dotfiles correctly: .gitignore → ext="", base=".gitignore"
      const dotIdx = name.indexOf(".", name.startsWith(".") ? 1 : 0);
      const ext = dotIdx > 0 ? name.slice(dotIdx) : "";
      const base = dotIdx > 0 ? name.slice(0, dotIdx) : name;
      let n = 2;
      const MAX_COPY_INDEX = 10000;
      while (n < MAX_COPY_INDEX && existsSync(resolve(targetDir, `${base} (${n})${ext}`))) n++;
      if (n >= MAX_COPY_INDEX) {
        skipped.push(name);
        continue;
      }
      finalName = `${base} (${n})${ext}`;
      finalPath = resolve(targetDir, finalName);
    }

    const buffer = Buffer.from(await value.arrayBuffer());
    const validation = validateUploadedMediaBuffer(finalName, buffer);
    if (!validation.ok) {
      invalid.push({ name: finalName, reason: validation.reason });
      continue;
    }

    writeFileSync(finalPath, buffer);
    const relativePath = subDir ? join(subDir, finalName) : finalName;
    uploaded.push(relativePath);
    if (isAudioFile(finalName)) {
      generateWaveformCache(projectDir, relativePath).catch(() => {});
    }
  }

  return { uploaded, skipped, invalid };
}

// ── Route registration ──────────────────────────────────────────────────────

export function registerFileRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // ── Read ──

  api.get("/projects/:id/files/*", async (c) => {
    const res = await resolveProjectFile(c, adapter);
    if ("error" in res) return res.error;

    if (!existsSync(res.absPath)) {
      if (c.req.query("optional") === "1") {
        return c.json({ filename: res.filePath, content: "" });
      }
      return c.json({ error: "not found" }, 404);
    }

    const content = readFileSync(res.absPath, "utf-8");
    return c.json({ filename: res.filePath, content });
  });

  // ── Write (overwrite) ──

  api.put("/projects/:id/files/*", async (c) => {
    const res = await resolveProjectFile(c, adapter);
    if ("error" in res) return res.error;

    ensureDir(res.absPath);
    const body = await c.req.text();
    const backup = snapshotBeforeWrite(res.project.dir, res.absPath);
    if (backup.error) console.warn(`Failed to create backup for ${res.filePath}: ${backup.error}`);
    writeFileSync(res.absPath, body, "utf-8");

    return c.json({
      ok: true,
      path: res.filePath,
      backupPath: backupPathForResponse(res.project.dir, backup.backupPath),
    });
  });

  // ── Create (fail if exists) ──

  api.post("/projects/:id/files/*", async (c) => {
    const res = await resolveProjectFile(c, adapter);
    if ("error" in res) return res.error;

    if (existsSync(res.absPath)) {
      return c.json({ error: "already exists" }, 409);
    }

    ensureDir(res.absPath);
    const body = await c.req.text().catch(() => "");
    writeFileSync(res.absPath, body, "utf-8");

    return c.json({ ok: true, path: res.filePath }, 201);
  });

  // ── Delete ──

  api.delete("/projects/:id/files/*", async (c) => {
    const res = await resolveProjectFile(c, adapter, { mustExist: true });
    if ("error" in res) return res.error;

    const stat = statSync(res.absPath);
    const backup = snapshotBeforeWrite(res.project.dir, res.absPath);
    if (backup.error) console.warn(`Failed to create backup for ${res.filePath}: ${backup.error}`);
    if (stat.isDirectory()) {
      rmSync(res.absPath, { recursive: true });
    } else {
      unlinkSync(res.absPath);
    }

    return c.json({
      ok: true,
      backupPath: backupPathForResponse(res.project.dir, backup.backupPath),
    });
  });

  api.post("/projects/:id/file-mutations/remove-element/*", async (c) => {
    const ctx = await resolveFileMutationContext(c, adapter, "remove-element");
    if ("error" in ctx) return ctx.error;

    if (!existsSync(ctx.absPath)) {
      return c.json({ error: "not found" }, 404);
    }

    const parsed = await parseMutationBody<{ target?: MutationTarget }>(c);
    if ("error" in parsed) return parsed.error;

    const originalContent = readFileSync(ctx.absPath, "utf-8");
    return writeIfChanged(
      c,
      ctx.project.dir,
      ctx.filePath,
      ctx.absPath,
      originalContent,
      removeElementFromHtml(originalContent, parsed.target),
    );
  });

  api.post("/projects/:id/file-mutations/split-element/*", async (c) => {
    const ctx = await resolveFileMutationContext(c, adapter, "split-element");
    if ("error" in ctx) return ctx.error;

    const parsed = await parseMutationBody<{
      target?: { id?: string; selector?: string; selectorIndex?: number };
      splitTime?: number;
      newId?: string;
      elementStart?: number;
      elementDuration?: number;
    }>(c);
    if ("error" in parsed) return parsed.error;
    if (typeof parsed.body.splitTime !== "number" || !parsed.body.newId) {
      return c.json({ error: "target, splitTime, and newId required" }, 400);
    }
    const fallbackTiming =
      typeof parsed.body.elementStart === "number" &&
      typeof parsed.body.elementDuration === "number"
        ? { start: parsed.body.elementStart, duration: parsed.body.elementDuration }
        : undefined;

    let originalContent: string;
    try {
      originalContent = readFileSync(ctx.absPath, "utf-8");
    } catch {
      return c.json({ error: "not found" }, 404);
    }
    const result = splitElementInHtml(
      originalContent,
      parsed.target,
      parsed.body.splitTime,
      parsed.body.newId,
      fallbackTiming,
    );
    if (!result.matched) {
      return c.json({ ok: false, changed: false, content: originalContent, path: ctx.filePath });
    }
    const backup = snapshotBeforeWrite(ctx.project.dir, ctx.absPath);
    if (backup.error) console.warn(`Failed to create backup for ${ctx.filePath}: ${backup.error}`);
    writeFileSync(ctx.absPath, result.html, "utf-8");
    return c.json({
      ok: true,
      changed: true,
      content: result.html,
      newId: result.newId,
      path: ctx.filePath,
      backupPath: backupPathForResponse(ctx.project.dir, backup.backupPath),
    });
  });

  api.post("/projects/:id/file-mutations/patch-element/*", async (c) => {
    const ctx = await resolveFileMutationContext(c, adapter, "patch-element");
    if ("error" in ctx) return ctx.error;

    const parsed = await parseMutationBody<{
      target?: MutationTarget;
      operations?: PatchOperation[];
    }>(c);
    if ("error" in parsed) return parsed.error;
    if (!Array.isArray(parsed.body.operations) || parsed.body.operations.length === 0) {
      return c.json({ error: "target and operations required" }, 400);
    }
    const unsafeFields = findUnsafeDomPatchValues(parsed.body);
    if (unsafeFields.length > 0) {
      return rejectUnsafeMutationValues(c, unsafeFields);
    }

    let originalContent: string;
    try {
      originalContent = readFileSync(ctx.absPath, "utf-8");
    } catch {
      return c.json({ error: "not found" }, 404);
    }
    const { html: patched, matched } = patchElementInHtml(
      originalContent,
      parsed.target,
      parsed.body.operations,
    );
    if (patched === originalContent) {
      return c.json({
        ok: true,
        changed: false,
        matched,
        content: originalContent,
        path: ctx.filePath,
      });
    }
    const backup = snapshotBeforeWrite(ctx.project.dir, ctx.absPath);
    if (backup.error) console.warn(`Failed to create backup for ${ctx.filePath}: ${backup.error}`);
    writeFileSync(ctx.absPath, patched, "utf-8");
    return c.json({
      ok: true,
      changed: true,
      matched,
      content: patched,
      path: ctx.filePath,
      backupPath: backupPathForResponse(ctx.project.dir, backup.backupPath),
    });
  });

  api.post("/projects/:id/file-mutations/patch-elements-batch/*", async (c) => {
    const ctx = await resolveFileMutationContext(c, adapter, "patch-elements-batch");
    if ("error" in ctx) return ctx.error;

    const body = (await c.req.json().catch(() => null)) as {
      patches?: ElementPatchRequest[];
    } | null;
    if (
      !body ||
      !Array.isArray(body.patches) ||
      body.patches.length === 0 ||
      body.patches.some(
        (patch) =>
          !patch?.target || !Array.isArray(patch.operations) || patch.operations.length === 0,
      )
    ) {
      return c.json({ error: "patches with target and operations required" }, 400);
    }
    const unsafeFields = body.patches.flatMap((patch) => findUnsafeDomPatchValues(patch));
    if (unsafeFields.length > 0) {
      return rejectUnsafeMutationValues(c, unsafeFields);
    }

    let originalContent: string;
    try {
      originalContent = readFileSync(ctx.absPath, "utf-8");
    } catch {
      return c.json({ error: "not found" }, 404);
    }
    const result = foldElementPatches(originalContent, body.patches);
    if (result.content === originalContent) {
      return c.json({
        ok: true,
        changed: false,
        matched: result.matched,
        content: originalContent,
        path: ctx.filePath,
      });
    }
    const backup = snapshotBeforeWrite(ctx.project.dir, ctx.absPath);
    if (backup.error) console.warn(`Failed to create backup for ${ctx.filePath}: ${backup.error}`);
    writeFileSync(ctx.absPath, result.content, "utf-8");
    return c.json({
      ok: true,
      changed: true,
      matched: result.matched,
      content: result.content,
      path: ctx.filePath,
      backupPath: backupPathForResponse(ctx.project.dir, backup.backupPath),
    });
  });

  api.post("/projects/:id/file-mutations/wrap-elements/*", async (c) => {
    const ctx = await resolveFileMutationContext(c, adapter, "wrap-elements");
    if ("error" in ctx) return ctx.error;

    const body = (await c.req.json().catch(() => null)) as {
      targets?: MutationTarget[];
      groupId?: string;
      bbox?: { left?: number; top?: number; width?: number; height?: number };
      rebases?: ElementRebase[];
    } | null;
    if (!Array.isArray(body?.targets) || body.targets.length === 0 || !body.groupId) {
      return c.json({ error: "targets and groupId required" }, 400);
    }
    // left/top/width/height are interpolated into inline style strings; reject
    // anything non-numeric so a crafted value can't inject extra declarations.
    const bbox = body.bbox ?? {};
    const bboxNums = [bbox.left, bbox.top, bbox.width, bbox.height];
    const rebases = body.rebases ?? [];
    const allNumeric =
      bboxNums.every((n) => typeof n === "number" && Number.isFinite(n)) &&
      rebases.every(
        (r) =>
          typeof r?.left === "number" &&
          Number.isFinite(r.left) &&
          typeof r?.top === "number" &&
          Number.isFinite(r.top),
      );
    if (!allNumeric) {
      return c.json({ error: "bbox and rebase coordinates must be finite numbers" }, 400);
    }

    let originalContent: string;
    try {
      originalContent = readFileSync(ctx.absPath, "utf-8");
    } catch {
      return c.json({ error: "not found" }, 404);
    }
    const result = wrapElementsInHtml(
      originalContent,
      body.targets,
      body.groupId,
      { left: bbox.left!, top: bbox.top!, width: bbox.width!, height: bbox.height! },
      rebases,
    );
    if (!result.matched) {
      return c.json(
        {
          ok: false,
          changed: false,
          content: originalContent,
          path: ctx.filePath,
          error: result.error,
        },
        result.error === "grouped elements must share a single parent" ? 422 : 400,
      );
    }
    const backup = snapshotBeforeWrite(ctx.project.dir, ctx.absPath);
    if (backup.error) console.warn(`Failed to create backup for ${ctx.filePath}: ${backup.error}`);
    writeFileSync(ctx.absPath, result.html, "utf-8");
    return c.json({
      ok: true,
      changed: true,
      groupId: result.groupId,
      content: result.html,
      path: ctx.filePath,
      backupPath: backupPathForResponse(ctx.project.dir, backup.backupPath),
    });
  });

  api.post("/projects/:id/file-mutations/unwrap-elements/*", async (c) => {
    const ctx = await resolveFileMutationContext(c, adapter, "unwrap-elements");
    if ("error" in ctx) return ctx.error;

    const parsed = await parseMutationBody<{ target?: MutationTarget }>(c);
    if ("error" in parsed) return parsed.error;

    let originalContent: string;
    try {
      originalContent = readFileSync(ctx.absPath, "utf-8");
    } catch {
      return c.json({ error: "not found" }, 404);
    }
    const result = unwrapElementsFromHtml(originalContent, parsed.target);
    if (!result.unwrapped) {
      return c.json({ ok: false, changed: false, content: originalContent, path: ctx.filePath });
    }
    // BAKE the group's static transform into the members FIRST, so the group's
    // accumulated moves are preserved (otherwise members snap back to their
    // creation-time positions), THEN strip the group's GSAP — a leftover
    // `gsap.set("#group-1")` throws "target not found" every preview run.
    let cleaned = result.html;
    if (result.unwrappedGroupId && result.members && result.groupCenter) {
      cleaned = bakeGroupTransformIntoMembers(
        cleaned,
        result.unwrappedGroupId,
        result.members,
        result.groupCenter,
      );
    }
    if (result.unwrappedGroupId) {
      cleaned = stripGsapAnimationsForSelector(cleaned, `#${result.unwrappedGroupId}`);
    }
    return writeIfChanged(c, ctx.project.dir, ctx.filePath, ctx.absPath, originalContent, cleaned);
  });

  api.post("/projects/:id/file-mutations/probe-element/*", async (c) => {
    const ctx = await resolveFileMutationContext(c, adapter, "probe-element");
    if ("error" in ctx) return ctx.error;

    const parsed = await parseMutationBody<{ target?: MutationTarget }>(c);
    if ("error" in parsed) return parsed.error;

    let content: string;
    try {
      content = readFileSync(ctx.absPath, "utf-8");
    } catch {
      return c.json({ exists: false });
    }

    const exists = probeElementInSource(content, parsed.target);
    return c.json({ exists });
  });

  // ── Rename / Move ──

  api.patch("/projects/:id/files/*", async (c) => {
    const res = await resolveProjectFile(c, adapter, { mustExist: true });
    if ("error" in res) return res.error;

    const body = (await c.req.json()) as { newPath?: string };
    if (!body.newPath || body.newPath.includes("\0")) {
      return c.json({ error: "newPath required" }, 400);
    }

    const newAbs = resolveWithinProject(res.project.dir, body.newPath);
    if (!newAbs) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (existsSync(newAbs)) {
      return c.json({ error: "already exists" }, 409);
    }

    ensureDir(newAbs);
    renameSync(res.absPath, newAbs);

    // Update references to the old path across all project files
    const updatedFiles = updateReferences(res.project.dir, res.filePath, body.newPath);

    return c.json({ ok: true, path: body.newPath, updatedReferences: updatedFiles });
  });

  // ── Duplicate ──

  api.post("/projects/:id/duplicate-file", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const body = (await c.req.json()) as { path: string };
    if (!body.path || body.path.includes("\0")) {
      return c.json({ error: "path required" }, 400);
    }

    const srcAbs = resolveWithinProject(project.dir, body.path);
    if (!srcAbs || !existsSync(srcAbs)) {
      return c.json({ error: "not found" }, 404);
    }

    const copyPath = generateCopyPath(project.dir, body.path);
    const destAbs = resolveWithinProject(project.dir, copyPath);
    if (!destAbs) {
      return c.json({ error: "forbidden" }, 403);
    }

    ensureDir(destAbs);
    writeFileSync(destAbs, readFileSync(srcAbs));

    return c.json({ ok: true, path: copyPath }, 201);
  });

  // ── Upload (binary assets via multipart form) ──

  const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB per file

  api.post(
    "/projects/:id/upload",
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: (c) => c.json({ error: "payload too large" }, 413),
    }),
    async (c) => {
      const project = await adapter.resolveProject(c.req.param("id"));
      if (!project) return c.json({ error: "not found" }, 404);

      // Optional subdirectory within the project (e.g. "assets/audio")
      const subDir = c.req.query("dir") ?? "";
      const targetDir = subDir ? resolveWithinProject(project.dir, subDir) : project.dir;
      if (!targetDir) return c.json({ error: "forbidden" }, 403);
      if (subDir && !existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

      const formData = await c.req.formData();
      const result = await processUploadedFiles(formData, targetDir, project.dir);

      return c.json(
        { ok: true, files: result.uploaded, skipped: result.skipped, invalid: result.invalid },
        201,
      );
    },
  );

  // ── GSAP Animations (parse) ──

  api.get("/projects/:id/gsap-animations/*", async (c) => {
    const res = await resolveProjectPath(c, adapter, (id) => `/projects/${id}/gsap-animations/`, {
      mustExist: true,
    });
    if ("error" in res) return res.error;

    const html = readFileSync(res.absPath, "utf-8");
    const block = extractGsapScriptBlock(html);
    if (!block) {
      return c.json({
        animations: [],
        timelineVar: "tl",
        preamble: "",
        postamble: "",
      });
    }

    const parsed = parseGsapScriptAcorn(block.scriptText);
    return c.json(parsed);
  });

  // ── GSAP Mutations ──

  api.post("/projects/:id/gsap-mutations/*", async (c) => {
    const res = await resolveProjectPath(c, adapter, (id) => `/projects/${id}/gsap-mutations/`, {
      mustExist: true,
    });
    if ("error" in res) return res.error;

    const body = (await c.req.json().catch(() => null)) as GsapMutationRequest | null;
    if (!body) return c.json({ error: "mutation type required" }, 400);
    const error = validateGsapMutationRequest(c, body);
    if (error) return error;
    return applyGsapMutations(c, res, [body]);
  });

  api.post("/projects/:id/gsap-mutations-batch/*", async (c) => {
    const res = await resolveProjectPath(
      c,
      adapter,
      (id) => `/projects/${id}/gsap-mutations-batch/`,
      { mustExist: true },
    );
    if ("error" in res) return res.error;

    const body = (await c.req.json().catch(() => null)) as {
      mutations?: GsapMutationRequest[];
    } | null;
    if (!body || !Array.isArray(body.mutations) || body.mutations.length === 0) {
      return c.json({ error: "mutations array required" }, 400);
    }
    for (const mutation of body.mutations) {
      const error = validateGsapMutationRequest(c, mutation);
      if (error) return error;
    }
    return applyGsapMutations(c, res, body.mutations);
  });
}
