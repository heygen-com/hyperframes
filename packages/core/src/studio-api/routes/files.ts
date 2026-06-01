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

type MutationTarget = { id?: string | null; selector?: string; selectorIndex?: number };

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
function extractGsapScriptBlock(
  html: string,
): { scriptText: string; replaceScript: (newText: string) => string } | null {
  const { document } = parseHTML(html);
  // linkedom's querySelectorAll doesn't descend into <template> content, but
  // sub-compositions wrap their markup (and the GSAP <script>) in a <template>.
  // Search top-level scripts first, then each template's own scripts. Operate
  // on the template element directly (NOT .content) so textContent writes are
  // reflected in document.toString().
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
        replaceScript(newText: string): string {
          script.textContent = newText;
          return document.toString();
        },
      };
    }
  }
  return null;
}

/** Lazy-load gsapParser to avoid pulling recast into every file-route import. */
async function loadGsapParser() {
  return import("../../parsers/gsapParser.js");
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
        if (!isSafePath(project.dir, destPath)) continue;

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
          generateWaveformCache(project.dir, relativePath).catch(() => {});
        }
      }

      return c.json({ ok: true, files: uploaded, skipped, invalid }, 201);
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
    | { type: "delete"; animationId: string }
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
    | { type: "remove-from-property"; animationId: string; property: string };

  api.post("/projects/:id/gsap-mutations/*", async (c) => {
    const res = await resolveProjectPath(c, adapter, (id) => `/projects/${id}/gsap-mutations/`, {
      mustExist: true,
    });
    if ("error" in res) return res.error;

    const body = (await c.req.json().catch(() => null)) as GsapMutationRequest | null;
    if (!body || !body.type) {
      return c.json({ error: "mutation type required" }, 400);
    }

    const html = readFileSync(res.absPath, "utf-8");
    const block = extractGsapScriptBlock(html);
    if (!block) {
      return c.json({ error: "no GSAP script found in file" }, 400);
    }

    const {
      parseGsapScript,
      updateAnimationInScript,
      addAnimationToScript,
      removeAnimationFromScript,
    } = await loadGsapParser();

    function requireAnimation(
      scriptText: string,
      animationId: string,
    ): { anim: GsapAnimation } | { err: Response } {
      const parsed = parseGsapScript(scriptText);
      const anim = parsed.animations.find((a) => a.id === animationId);
      if (!anim) return { err: c.json({ error: "animation not found" }, 404) };
      return { anim };
    }

    function requireFromToAnimation(
      scriptText: string,
      animationId: string,
    ): { anim: GsapAnimation } | { err: Response } {
      const result = requireAnimation(scriptText, animationId);
      if ("err" in result) return result;
      if (result.anim.method !== "fromTo")
        return { err: c.json({ error: "animation is not a fromTo" }, 400) };
      return result;
    }

    let newScript: string;

    // fallow-ignore-next-line complexity
    switch (body.type) {
      case "update-property": {
        const r = requireAnimation(block.scriptText, body.animationId);
        if ("err" in r) return r.err;
        newScript = updateAnimationInScript(block.scriptText, body.animationId, {
          properties: { ...r.anim.properties, [body.property]: body.value },
        });
        break;
      }
      case "update-from-property": {
        const r = requireFromToAnimation(block.scriptText, body.animationId);
        if ("err" in r) return r.err;
        newScript = updateAnimationInScript(block.scriptText, body.animationId, {
          fromProperties: { ...(r.anim.fromProperties ?? {}), [body.property]: body.value },
        });
        break;
      }
      case "update-meta": {
        newScript = updateAnimationInScript(block.scriptText, body.animationId, body.updates);
        break;
      }
      case "add": {
        if (body.fromProperties && body.method !== "fromTo") {
          return c.json({ error: "fromProperties is only valid for method=fromTo" }, 400);
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
        newScript = result.script;
        break;
      }
      case "delete": {
        newScript = removeAnimationFromScript(block.scriptText, body.animationId);
        break;
      }
      case "add-property": {
        const r = requireAnimation(block.scriptText, body.animationId);
        if ("err" in r) return r.err;
        newScript = updateAnimationInScript(block.scriptText, body.animationId, {
          properties: { ...r.anim.properties, [body.property]: body.defaultValue },
        });
        break;
      }
      case "add-from-property": {
        const r = requireFromToAnimation(block.scriptText, body.animationId);
        if ("err" in r) return r.err;
        newScript = updateAnimationInScript(block.scriptText, body.animationId, {
          fromProperties: { ...(r.anim.fromProperties ?? {}), [body.property]: body.defaultValue },
        });
        break;
      }
      case "remove-property": {
        const r = requireAnimation(block.scriptText, body.animationId);
        if ("err" in r) return r.err;
        const filtered = { ...r.anim.properties };
        delete filtered[body.property];
        newScript = updateAnimationInScript(block.scriptText, body.animationId, {
          properties: filtered,
        });
        break;
      }
      case "remove-from-property": {
        const r = requireFromToAnimation(block.scriptText, body.animationId);
        if ("err" in r) return r.err;
        const filtered = { ...(r.anim.fromProperties ?? {}) };
        delete filtered[body.property];
        newScript = updateAnimationInScript(block.scriptText, body.animationId, {
          fromProperties: filtered,
        });
        break;
      }
      default:
        return c.json({ error: `unknown mutation type: ${(body as { type: string }).type}` }, 400);
    }

    const newHtml = block.replaceScript(newScript);
    if (newHtml !== html) {
      writeFileSync(res.absPath, newHtml, "utf-8");
    }

    // Re-parse the mutated script so the UI gets fresh state
    const freshParsed = parseGsapScript(newScript);
    return c.json({
      ok: true,
      parsed: freshParsed,
      before: html,
      after: newHtml,
      scriptText: newScript,
    });
  });
}
