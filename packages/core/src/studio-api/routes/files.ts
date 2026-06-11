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
import { isSafePath } from "../helpers/safePath.js";
import type { GsapAnimation } from "../../parsers/gsapSerialize.js";
import {
  removeElementFromHtml,
  patchElementInHtml,
  probeElementInSource,
  splitElementInHtml,
  type PatchOperation,
} from "../helpers/sourceMutation.js";
import { parseHTML } from "linkedom";

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

  const absPath = resolve(project.dir, filePath);
  if (!isSafePath(project.dir, absPath)) {
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

/** Write `next` to `absPath` only if it differs from `original`, returning a standardized change response. */
function writeIfChanged(
  c: RouteContext,
  absPath: string,
  original: string,
  next: string,
): Response {
  if (next === original) {
    return c.json({ ok: true, changed: false, content: original });
  }
  writeFileSync(absPath, next, "utf-8");
  return c.json({ ok: true, changed: true, content: next });
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

function stripStudioEditsFromTarget(document: Document, selector: string): number {
  if (!selector) return 0;
  let stripped = 0;
  try {
    for (const el of document.querySelectorAll(selector)) {
      if (!el.getAttribute("data-hf-studio-path-offset")) continue;
      const htmlEl = el as unknown as HTMLElement;
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
      stripped++;
    }
  } catch {
    // Invalid selector — skip silently.
  }
  return stripped;
}

function bakeVisibilityOnDelete(document: Document, anim: GsapAnimation): void {
  let finalOpacity: number | string | undefined;
  if (anim.method === "from") {
    return;
  }
  if (anim.keyframes) {
    const kfs = anim.keyframes.keyframes;
    for (let i = kfs.length - 1; i >= 0; i--) {
      if ("opacity" in kfs[i]!.properties) {
        finalOpacity = kfs[i]!.properties.opacity;
        break;
      }
    }
  } else if ("opacity" in anim.properties) {
    finalOpacity = anim.properties.opacity;
  }
  if (finalOpacity == null) {
    return;
  }
  if (typeof finalOpacity === "string" && /^[+\-*]=/.test(finalOpacity)) {
    return;
  }
  const numOpacity = Number(finalOpacity);
  if (!Number.isFinite(numOpacity) || numOpacity === 0) return;
  try {
    for (const el of document.querySelectorAll(anim.targetSelector)) {
      (el as unknown as HTMLElement).style.setProperty("opacity", String(numOpacity));
    }
  } catch {
    // Invalid selector — skip silently.
  }
}

/** Lazy-load gsapParser to avoid pulling recast into every file-route import. */
async function loadGsapParser() {
  return import("../../parsers/gsapParser.js");
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
      type: "update-from-property";
      animationId: string;
      property: string;
      value: number | string;
    }
  | {
      type: "update-meta";
      animationId: string;
      updates: { duration?: number; ease?: string; position?: number };
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
    };

// ── GSAP mutation executor ──────────────────────────────────────────────────

type GsapMutationResult = string | { script: string; skippedSelectors: string[] };

async function executeGsapMutation(
  body: GsapMutationRequest,
  block: NonNullable<ReturnType<typeof extractGsapScriptBlock>>,
  respond: (data: unknown, status?: number) => Response,
): Promise<GsapMutationResult | Response> {
  const parser = await loadGsapParser();
  const {
    parseGsapScript,
    updateAnimationInScript,
    addAnimationToScript,
    removeAnimationFromScript,
    addKeyframeToScript,
    removeKeyframeFromScript,
    updateKeyframeInScript,
    convertToKeyframesInScript,
    removeAllKeyframesFromScript,
    materializeKeyframesInScript,
    unrollDynamicAnimations,
    setArcPathInScript,
    updateArcSegmentInScript,
    removeArcPathFromScript,
    addAnimationWithKeyframesToScript,
    splitAnimationsInScript,
    splitIntoPropertyGroups,
  } = parser;

  function requireAnimation(
    scriptText: string,
    animationId: string,
  ): { anim: GsapAnimation } | { err: Response } {
    const parsed = parseGsapScript(scriptText);
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
    case "update-property": {
      const r = requireAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      return updateAnimationInScript(block.scriptText, body.animationId, {
        properties: { ...r.anim.properties, [body.property]: body.value },
      });
    }
    case "update-from-property": {
      const r = requireFromToAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      return updateAnimationInScript(block.scriptText, body.animationId, {
        fromProperties: { ...(r.anim.fromProperties ?? {}), [body.property]: body.value },
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
      const parsed = parseGsapScript(block.scriptText);
      const matching = parsed.animations.filter((a) => a.targetSelector === body.targetSelector);
      if (matching.length === 0) return block.scriptText;
      stripStudioEditsFromTarget(block.document, body.targetSelector);
      let script = block.scriptText;
      for (const anim of matching.reverse()) {
        script = removeAnimationFromScript(script, anim.id);
      }
      return script;
    }
    case "add-property": {
      const r = requireAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      return updateAnimationInScript(block.scriptText, body.animationId, {
        properties: { ...r.anim.properties, [body.property]: body.defaultValue },
      });
    }
    case "add-from-property": {
      const r = requireFromToAnimation(block.scriptText, body.animationId);
      if ("err" in r) return r.err;
      return updateAnimationInScript(block.scriptText, body.animationId, {
        fromProperties: { ...(r.anim.fromProperties ?? {}), [body.property]: body.defaultValue },
      });
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
      const result = splitIntoPropertyGroups(block.scriptText, body.animationId);
      return result.script;
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
      while (n < 10000 && existsSync(resolve(targetDir, `${base} (${n})${ext}`))) n++;
      if (n >= 10000) {
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
    writeFileSync(res.absPath, body, "utf-8");

    return c.json({ ok: true });
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
    if (stat.isDirectory()) {
      rmSync(res.absPath, { recursive: true });
    } else {
      unlinkSync(res.absPath);
    }

    return c.json({ ok: true });
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
    }>(c);
    if ("error" in parsed) return parsed.error;
    if (typeof parsed.body.splitTime !== "number" || !parsed.body.newId) {
      return c.json({ error: "target, splitTime, and newId required" }, 400);
    }

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
    );
    if (!result.matched) {
      return c.json({ ok: false, changed: false, content: originalContent });
    }
    writeFileSync(ctx.absPath, result.html, "utf-8");
    return c.json({ ok: true, changed: true, content: result.html, newId: result.newId });
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
      return c.json({ ok: true, changed: false, matched, content: originalContent });
    }
    writeFileSync(ctx.absPath, patched, "utf-8");
    return c.json({ ok: true, changed: true, matched, content: patched });
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

    const newAbs = resolve(res.project.dir, body.newPath);
    if (!isSafePath(res.project.dir, newAbs)) {
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

    const srcAbs = resolve(project.dir, body.path);
    if (!isSafePath(project.dir, srcAbs) || !existsSync(srcAbs)) {
      return c.json({ error: "not found" }, 404);
    }

    const copyPath = generateCopyPath(project.dir, body.path);
    const destAbs = resolve(project.dir, copyPath);
    if (!isSafePath(project.dir, destAbs)) {
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
      const targetDir = subDir ? resolve(project.dir, subDir) : project.dir;
      if (!isSafePath(project.dir, targetDir)) return c.json({ error: "forbidden" }, 403);
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

    const { parseGsapScript } = await loadGsapParser();
    const parsed = parseGsapScript(block.scriptText);
    return c.json(parsed);
  });

  // ── GSAP Mutations ──

  api.post("/projects/:id/gsap-mutations/*", async (c) => {
    const res = await resolveProjectPath(c, adapter, (id) => `/projects/${id}/gsap-mutations/`, {
      mustExist: true,
    });
    if ("error" in res) return res.error;

    const body = (await c.req.json().catch(() => null)) as GsapMutationRequest | null;
    if (!body || !body.type) {
      return c.json({ error: "mutation type required" }, 400);
    }

    let html = readFileSync(res.absPath, "utf-8");
    let block = extractGsapScriptBlock(html);
    if (!block && (body.type === "add" || body.type === "add-with-keyframes")) {
      const compId = html.match(/data-composition-id="([^"]+)"/)?.[1] ?? "main";
      const { GSAP_CDN } = await import("../../templates/constants.js");
      const gsapCdn = `<script src="${GSAP_CDN}"></script>`;
      const bootstrap = [
        gsapCdn,
        "<script>",
        "window.__timelines = window.__timelines || {};",
        `const tl = gsap.timeline({ paused: true });`,
        `window.__timelines["${compId}"] = tl;`,
        "</script>",
      ].join("\n");
      if (html.includes("</body>")) {
        html = html.replace("</body>", `${bootstrap}\n</body>`);
      } else {
        html += `\n${bootstrap}`;
      }
      block = extractGsapScriptBlock(html);
    }
    if (!block) {
      return c.json({ error: "no GSAP script found in file" }, 400);
    }

    const respond = (data: unknown, status?: number) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bridge between generic status and Hono's literal union
      status ? c.json(data, status as any) : c.json(data);

    const result = await executeGsapMutation(body, block, respond);
    if (result instanceof Response) return result;

    const newScript = typeof result === "string" ? result : result.script;
    const changed = newScript !== block.scriptText;
    const newHtml = changed ? block.replaceScript(newScript) : html;
    if (changed) {
      writeFileSync(res.absPath, newHtml, "utf-8");
    }

    const { parseGsapScript } = await loadGsapParser();
    const freshParsed = parseGsapScript(newScript);
    const responsePayload: Record<string, unknown> = {
      ok: true,
      changed,
      parsed: freshParsed,
      before: html,
      after: newHtml,
      scriptText: newScript,
    };
    if (typeof result !== "string" && result.skippedSelectors.length > 0) {
      responsePayload.skippedSelectors = result.skippedSelectors;
    }
    return c.json(responsePayload);
  });
}
