import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFileRoutes } from "./files";
import type { StudioApiAdapter } from "../types";

// Path-safety coverage for the file routes: render.test.ts pins the traversal /
// symlink-escape guards for its render-file route, but the files route surface
// (read, write, rename, duplicate) had none even though every handler funnels
// user-supplied paths through the same resolveWithinProject chokepoint. These
// tests lock that containment in so a future refactor of the chokepoint can't
// silently reopen an escape.

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Make a tracked temp dir, optionally seeding one file into it.
function makeDir(prefix: string, seed?: { name: string; content: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  if (seed) writeFileSync(join(dir, seed.name), seed.content);
  return dir;
}

const createProjectDir = (): string =>
  makeDir("hf-files-pathsafety-", {
    name: "index.html",
    content: "<html><body>Preview</body></html>",
  });

const createExternalDir = (secret: string): string =>
  makeDir("hf-files-external-", { name: "secret.txt", content: secret });

// registerFileRoutes only calls adapter.resolveProject, so a minimal stub keeps
// these tests focused on path containment rather than the full adapter surface.
function appFor(projectDir: string): Hono {
  const adapter = {
    resolveProject: async (id: string) => ({ id, dir: projectDir }),
  } as unknown as StudioApiAdapter;
  const app = new Hono();
  registerFileRoutes(app, adapter);
  return app;
}

function trySymlink(target: string, linkPath: string, type: "dir" | "file"): boolean {
  try {
    symlinkSync(target, linkPath, type);
    return true;
  } catch {
    return false;
  }
}

// `..` segments in a real URL get collapsed by the WHATWG parser before routing,
// so percent-encode the dots/slashes to deliver the traversal verbatim to the
// handler (which decodeURIComponent()s the path itself).
const TRAVERSAL = "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd";

// Percent-encode a relative path so its separators survive WHATWG URL
// normalization and reach the handler intact.
function encodeRel(relPath: string): string {
  return encodeURIComponent(relPath).replace(/%2F/gi, "%2f");
}

// A project-relative path that resolves to `target` (an absolute path outside
// the project), both living under tmpdir().
function escapingPathTo(target: string): string {
  return `../${target.slice(tmpdir().length + 1)}`;
}

describe("registerFileRoutes path safety", () => {
  it("rejects a percent-encoded traversal on file read with 403", async () => {
    const app = appFor(createProjectDir());
    const res = await app.request(`http://localhost/projects/demo/files/${TRAVERSAL}`);
    expect(res.status).toBe(403);
  });

  it("rejects a NUL byte in the read path with 403", async () => {
    const app = appFor(createProjectDir());
    const res = await app.request("http://localhost/projects/demo/files/index.html%00.txt");
    expect(res.status).toBe(403);
  });

  it("rejects a traversal on PUT write with 403 and writes nothing outside the project", async () => {
    const projectDir = createProjectDir();
    const external = createExternalDir("ORIGINAL");
    const app = appFor(projectDir);
    const escaped = encodeRel(escapingPathTo(join(external, "secret.txt")));
    const res = await app.request(`http://localhost/projects/demo/files/${escaped}`, {
      method: "PUT",
      body: "PWNED",
    });
    expect(res.status).toBe(403);
    expect(readFileSync(join(external, "secret.txt"), "utf-8")).toBe("ORIGINAL");
  });

  it("rejects a traversal in the rename newPath with 403", async () => {
    const projectDir = createProjectDir();
    const app = appFor(projectDir);
    const res = await app.request("http://localhost/projects/demo/files/index.html", {
      method: "PATCH",
      body: JSON.stringify({ newPath: "../../../tmp/escaped.html" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a NUL byte in the rename newPath with 400", async () => {
    const projectDir = createProjectDir();
    const app = appFor(projectDir);
    const res = await app.request("http://localhost/projects/demo/files/index.html", {
      method: "PATCH",
      body: JSON.stringify({ newPath: "evil\u0000.html" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects a traversal in the duplicate-file path (source escapes) with 404", async () => {
    const projectDir = createProjectDir();
    const external = createExternalDir("SECRET");
    const app = appFor(projectDir);
    const res = await app.request("http://localhost/projects/demo/duplicate-file", {
      method: "POST",
      body: JSON.stringify({ path: escapingPathTo(join(external, "secret.txt")) }),
      headers: { "content-type": "application/json" },
    });
    // resolveWithinProject returns null -> route reports the source as not found
    expect(res.status).toBe(404);
  });

  it("rejects a NUL byte in the duplicate-file path with 400", async () => {
    const projectDir = createProjectDir();
    const app = appFor(projectDir);
    const res = await app.request("http://localhost/projects/demo/duplicate-file", {
      method: "POST",
      body: JSON.stringify({ path: "index.html\u0000" }),
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects a read through an in-project symlink that points outside the project", async () => {
    const projectDir = createProjectDir();
    const external = createExternalDir("TOP-SECRET");
    const app = appFor(projectDir);
    if (!trySymlink(join(external, "secret.txt"), join(projectDir, "leak.txt"), "file")) return;
    const res = await app.request("http://localhost/projects/demo/files/leak.txt");
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("TOP-SECRET");
  });

  it("still serves a legitimate nested file inside the project (no over-rejection)", async () => {
    const projectDir = createProjectDir();
    writeFileSync(join(projectDir, "index.html"), "<html></html>");
    const app = appFor(projectDir);
    // create the nested file via the write route, then read it back
    const put = await app.request("http://localhost/projects/demo/files/scenes/intro.html", {
      method: "PUT",
      body: "<section>intro</section>",
    });
    expect(put.status).toBe(200);
    expect(existsSync(join(projectDir, "scenes", "intro.html"))).toBe(true);
    const get = await app.request("http://localhost/projects/demo/files/scenes/intro.html");
    expect(get.status).toBe(200);
    const payload = (await get.json()) as { content?: string };
    expect(payload.content).toBe("<section>intro</section>");
  });
});
