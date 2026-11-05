import { afterEach, describe, expect, it } from "vitest";
import {
  closeSync,
  mkdirSync,
  fstatSync,
  ftruncateSync,
  futimesSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  affectsProjectSignature,
  createProjectSignature,
  createProjectSignatureAsync,
  listProjectFiles,
} from "./projectSignature.js";

const temporaryProjects: string[] = [];

afterEach(() => {
  for (const project of temporaryProjects.splice(0)) rmSync(project, { recursive: true });
});

const PROJECT = resolve("/projects/demo");
const affects = (relativePath: string) =>
  affectsProjectSignature(PROJECT, resolve(PROJECT, relativePath));

describe("affectsProjectSignature", () => {
  it("accepts a file the signature walk collects", () => {
    expect(affects("index.html")).toBe(true);
    expect(affects("assets/logo.png")).toBe(true);
  });

  it("rejects the caches the walk skips", () => {
    // .thumbnails is the one that matters: the thumbnail route writes a capture
    // there and reads the preview on the next one, so invalidating on it throws
    // the memo away on roughly every request of the workload it exists for.
    expect(affects(".thumbnails/frame-0.jpg")).toBe(false);
    expect(affects("node_modules/pkg/index.js")).toBe(false);
    expect(affects("renders/out.mp4")).toBe(false);
  });

  it("rejects a directory event on an excluded dir itself", () => {
    expect(affects(".thumbnails")).toBe(false);
  });

  it("accepts the two manifest files the signature reads back out of .hyperframes", () => {
    // The reload watcher's exclusion set is character-identical to the walk's but
    // drops all of .hyperframes/. Filtering with it would stop a motion-state save
    // from ever invalidating — the same stale-ETag bug in a new place.
    expect(affects(".hyperframes/studio-motion.json")).toBe(true);
    expect(affects(".hyperframes/studio-manual-edits.json")).toBe(true);
  });

  it("rejects everything else inside .hyperframes", () => {
    expect(affects(".hyperframes/cache/blob.bin")).toBe(false);
  });

  it("rejects the temp file of a save in flight, but not a user's own .tmp file", () => {
    expect(affects("index.html.hf0a1b2c.tmp")).toBe(false);
    expect(affects("foo.12345678.tmp")).toBe(true);
  });

  it("rejects a path outside the project", () => {
    expect(affectsProjectSignature(PROJECT, resolve("/projects/other/index.html"))).toBe(false);
    expect(affectsProjectSignature(PROJECT, PROJECT)).toBe(false);
  });
});

describe("listProjectFiles", () => {
  it("leaves out the temp file of a save in flight", () => {
    const project = mkdtempSync(resolve(tmpdir(), "hf-signature-"));
    temporaryProjects.push(project);
    writeFileSync(resolve(project, "index.html"), "<h1>Hello</h1>");
    writeFileSync(resolve(project, "index.html.hf0a1b2c.tmp"), "<h1>Bye</h1>");
    writeFileSync(resolve(project, "foo.12345678.tmp"), "mine");

    expect(listProjectFiles(project).map((file) => file.path)).toEqual([
      "foo.12345678.tmp",
      "index.html",
    ]);
  });
});

describe("createProjectSignature", () => {
  it("changes after same-size content is written with the original mtime restored", () => {
    const project = mkdtempSync(resolve(tmpdir(), "hf-signature-"));
    temporaryProjects.push(project);
    const file = resolve(project, "index.html");
    const descriptor = openSync(file, "w+");
    try {
      writeSync(descriptor, "first");
      const originalMtime = fstatSync(descriptor).mtime;
      const before = createProjectSignature(project);

      ftruncateSync(descriptor, 0);
      writeSync(descriptor, "other", 0, "utf8");
      futimesSync(descriptor, originalMtime, originalMtime);

      expect(createProjectSignature(project)).not.toBe(before);
    } finally {
      closeSync(descriptor);
    }
  });
});

describe("createProjectSignatureAsync", () => {
  function fixture(): string {
    const project = mkdtempSync(resolve(tmpdir(), "hf-signature-async-"));
    temporaryProjects.push(project);
    for (const dir of ["scenes", "assets/img", ".thumbnails", ".hyperframes"]) {
      mkdirSync(resolve(project, dir), { recursive: true });
    }
    writeFileSync(resolve(project, "index.html"), "<html>root</html>");
    writeFileSync(resolve(project, "scenes/a.html"), "<div>a</div>");
    writeFileSync(resolve(project, "scenes/b.js"), "export const b = 1;");
    writeFileSync(resolve(project, "assets/img/logo.png"), Buffer.from([1, 2, 3, 4]));
    writeFileSync(resolve(project, ".thumbnails/skipped.png"), "capture");
    writeFileSync(resolve(project, ".hyperframes/studio-motion.json"), "{}");
    return project;
  }

  it("returns the signature the synchronous walk returns", async () => {
    const project = fixture();
    expect(await createProjectSignatureAsync(project)).toBe(createProjectSignature(project));
    const excluded = new Set(["scenes/a.html"]);
    expect(await createProjectSignatureAsync(project, excluded)).toBe(
      createProjectSignature(project, excluded),
    );
  });

  it("changes when a text file changes, and ignores a skipped directory", async () => {
    const project = fixture();
    const before = await createProjectSignatureAsync(project);
    writeFileSync(resolve(project, ".thumbnails/skipped.png"), "another capture");
    expect(await createProjectSignatureAsync(project)).toBe(before);
    writeFileSync(resolve(project, "scenes/a.html"), "<div>A</div>");
    expect(await createProjectSignatureAsync(project)).not.toBe(before);
  });

  it("lets the event loop run while it walks and reads", async () => {
    const project = fixture();
    for (let i = 0; i < 60; i++) writeFileSync(resolve(project, `scenes/s${i}.html`), `${i}`);
    let turns = 0;
    const tick = setInterval(() => turns++, 0);
    try {
      await createProjectSignatureAsync(project);
    } finally {
      clearInterval(tick);
    }
    expect(turns).toBeGreaterThan(1);
  });
});
