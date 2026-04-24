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
import { validateUploadedMediaBuffer } from "../helpers/mediaValidation.js";
import { isSafePath } from "../helpers/safePath.js";
import { removeElementFromHtml } from "../helpers/sourceMutation.js";

// ── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Resolve the project and file path from the request, validating safety.
 * Returns null (and sends an error response) if anything is invalid.
 */
interface RouteContext {
  req: { param: (name: string) => string; path: string };
  json: (data: unknown, status?: number) => Response;
}

async function resolveProjectFile(
  c: RouteContext,
  adapter: StudioApiAdapter,
  opts?: { mustExist?: boolean },
) {
  const id = c.req.param("id");
  const project = await adapter.resolveProject(id);
  if (!project) {
    return { error: c.json({ error: "not found" }, 404) } as const;
  }

  const filePath = decodeURIComponent(c.req.path.replace(`/projects/${project.id}/files/`, ""));
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

// ── Route registration ──────────────────────────────────────────────────────

export function registerFileRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // ── Read ──

  api.get("/projects/:id/files/*", async (c) => {
    const res = await resolveProjectFile(c, adapter, { mustExist: true });
    if ("error" in res) return res.error;

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
    const id = c.req.param("id");
    const project = await adapter.resolveProject(id);
    if (!project) return c.json({ error: "not found" }, 404);

    const filePath = decodeURIComponent(
      c.req.path.replace(`/projects/${project.id}/file-mutations/remove-element/`, ""),
    );
    if (filePath.includes("\0")) {
      return c.json({ error: "forbidden" }, 403);
    }

    const absPath = resolve(project.dir, filePath);
    if (!isSafePath(project.dir, absPath)) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (!existsSync(absPath)) {
      return c.json({ error: "not found" }, 404);
    }

    const body = (await c.req.json().catch(() => null)) as {
      target?: { id?: string | null; selector?: string; selectorIndex?: number };
    } | null;
    if (!body?.target) {
      return c.json({ error: "target required" }, 400);
    }

    const originalContent = readFileSync(absPath, "utf-8");
    const patchedContent = removeElementFromHtml(originalContent, body.target);
    if (patchedContent === originalContent) {
      return c.json({ ok: true, changed: false, content: originalContent });
    }

    writeFileSync(absPath, patchedContent, "utf-8");
    return c.json({ ok: true, changed: true, content: patchedContent });
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

      for (const [, value] of formData.entries()) {
        if (!(value instanceof File)) continue;

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
        uploaded.push(subDir ? join(subDir, finalName) : finalName);
      }

      return c.json({ ok: true, files: uploaded, skipped, invalid }, 201);
    },
  );
}
