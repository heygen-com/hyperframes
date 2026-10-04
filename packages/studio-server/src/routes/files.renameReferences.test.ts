import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { referenceRewriter, registerFileRoutes } from "./files";
import type { StudioApiAdapter } from "../types";

const rewrite = (text: string, from: string, to: string, folder: boolean) =>
  referenceRewriter(from, to, folder)(text);

describe("rename references", () => {
  it("rewrites a folder where files under it are named, in every form a project writes them", () => {
    const text = [
      '<img src="assets/a.png">',
      "url(./assets/a.png)",
      '"../assets/a.png"',
      '{"poster":"assets/b/c.png"}',
    ].join("\n");
    expect(rewrite(text, "assets", "brand", true)).toBe(
      [
        '<img src="brand/a.png">',
        "url(./brand/a.png)",
        '"../brand/a.png"',
        '{"poster":"brand/b/c.png"}',
      ].join("\n"),
    );
  });

  it("leaves a sibling folder with the same beginning, another folder's path and prose alone", () => {
    const text = 'assets-backup/b.png my-assets/x.png other/assets/y.png "The assets folder"';
    expect(rewrite(text, "assets", "brand", true)).toBe(text);
  });

  it("rewrites a file's path whole, not a longer name that starts with it", () => {
    const text = '"assets/a.png" "assets/a.png2" "assets/a.png-old"';
    expect(rewrite(text, "assets/a.png", "assets/b.png", false)).toBe(
      '"assets/b.png" "assets/a.png2" "assets/a.png-old"',
    );
    expect(
      rewrite('url(assets/a.png) srcset="assets/a.png 2x"', "assets/a.png", "x/b.png", false),
    ).toBe('url(x/b.png) srcset="x/b.png 2x"');
  });

  it("keeps a root-relative lead, and reads JSON-escaped and Windows separators", () => {
    const text = [
      '<img src="/assets/a.png">',
      "url(/assets/a.png)",
      '{"src":"assets\\/a.png"}',
      '{"path":"assets\\\\a.png"}',
    ].join("\n");
    expect(rewrite(text, "assets", "brand", true)).toBe(
      [
        '<img src="/brand/a.png">',
        "url(/brand/a.png)",
        '{"src":"brand\\/a.png"}',
        '{"path":"brand\\\\a.png"}',
      ].join("\n"),
    );
  });

  it("leaves a longer path that exists alone, whatever characters its name holds", () => {
    const rewriteWith = (
      text: string,
      from: string,
      to: string,
      folder: boolean,
      existing: string[],
    ) => referenceRewriter(from, to, folder, existing)(text);
    const folders = '<img src="other assets/a.png"> <img src="other,assets/a.png">';
    expect(
      rewriteWith(folders, "assets", "brand", true, ["other assets", "other,assets", "assets"]),
    ).toBe(folders);
    const files =
      '<img src="assets/a.png&backup.png"><img src="assets/a.png 2x.png"><img src="assets/a.png).png">';
    expect(
      rewriteWith(files, "assets/a.png", "assets/b.png", false, [
        "assets/a.png&backup.png",
        "assets/a.png 2x.png",
        "assets/a.png).png",
      ]),
    ).toBe(files);
  });

  it("sees an existing path the match sits in the middle of, and in escaped spellings", () => {
    const middle = '<img src="other a.png&backup.png">';
    expect(referenceRewriter("a.png", "b.png", false, ["other a.png&backup.png"])(middle)).toBe(
      middle,
    );
    const escaped = String.raw`{"path":"assets\\a.png&backup.png"} {"path":"assets\/a.png&backup.png"}`;
    expect(
      referenceRewriter("assets/a.png", "assets/b.png", false, ["assets/a.png&backup.png"])(
        escaped,
      ),
    ).toBe(escaped);
  });

  it("compares escaped spellings by their text, not by offsets", () => {
    const text = String.raw`"dir\/other a.png&backup.png" "dir\\other a.png&backup.png"`;
    expect(referenceRewriter("a.png", "b.png", false, ["dir/other a.png&backup.png"])(text)).toBe(
      text,
    );
  });

  it("stays fast with thousands of existing paths and references", () => {
    const existing = Array.from({ length: 5000 }, (_, i) => `archive/assets/image-${i}.png`);
    const text = Array.from(
      { length: 5000 },
      (_, i) => `"assets/a${i}.png" "archive/assets/image-${i}.png"`,
    ).join("\n");
    const started = Date.now();
    const out = referenceRewriter("assets", "brand", true, existing)(text);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out).toContain('"brand/a0.png" "archive/assets/image-0.png"');
  });

  it("does not multiply suffix and prefix lengths", () => {
    const existing = Array.from(
      { length: 200 },
      (_, i) => `${"z".repeat(i + 1)} a/${"x".repeat(i + 1)}`,
    );
    const text = Array.from({ length: 3000 }, () => `"a/${"x".repeat(210)}.png"`).join("\n");
    const started = Date.now();
    referenceRewriter("a", "brand", true, existing)(text);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("rewrites references a bare scan could mistake: unquoted attributes, a space before a paren, srcset", () => {
    const text =
      '<img src=assets/a.png alt="x"> url(assets/a.png ) srcset="assets/a.png 1x, assets/a.png 2x"';
    expect(rewrite(text, "assets/a.png", "x/b.png", false)).toBe(
      '<img src=x/b.png alt="x"> url(x/b.png ) srcset="x/b.png 1x, x/b.png 2x"',
    );
  });

  it("takes no path that is part of a longer one by its start: another root, a plus, a backslash", () => {
    const text = String.raw`other\assets\a.png other\/assets\/a.png my+assets/a.png`;
    expect(rewrite(text, "assets", "brand", true)).toBe(text);
  });

  it("does not stall on a long run of backslashes", () => {
    const text = `${"\\".repeat(200)}unrelated`;
    const started = Date.now();
    expect(rewrite(text, "assets", "brand", true)).toBe(text);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("does not take another folder's path whose middle matches", () => {
    const text = "other/./assets/a.png other/../assets/a.png";
    expect(rewrite(text, "assets", "brand", true)).toBe(text);
  });
});

describe("renaming a folder over the route", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it("rewrites references under it and leaves a sibling folder's, and prose, alone", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-refs-"));
    dirs.push(project);
    mkdirSync(join(project, "assets"));
    mkdirSync(join(project, "assets-backup"));
    mkdirSync(join(project, "other assets"));
    mkdirSync(join(project, "empty assets"));
    writeFileSync(join(project, "other assets", "a.png"), "x");
    writeFileSync(join(project, "assets", "a.png"), "x");
    const html =
      '<img src="assets/a.png"><img src="assets-backup/a.png"><img src="other assets/a.png"><a href="empty assets/">x</a><p>The assets folder</p>';
    writeFileSync(join(project, "index.html"), html);
    const adapter = {
      resolveProject: async (id: string) => ({ id, dir: project }),
    } as unknown as StudioApiAdapter;
    const app = new Hono();
    registerFileRoutes(app, adapter);

    const response = await app.request("/projects/p/files/assets", {
      method: "PATCH",
      body: JSON.stringify({ newPath: "brand" }),
    });

    expect(response.status).toBe(200);
    expect(readFileSync(join(project, "index.html"), "utf8")).toBe(
      '<img src="brand/a.png"><img src="assets-backup/a.png"><img src="other assets/a.png"><a href="empty assets/">x</a><p>The assets folder</p>',
    );
  });

  it("leaves a path reached through a linked folder alone", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-link-"));
    dirs.push(project);
    mkdirSync(join(project, "assets"));
    mkdirSync(join(project, "shared"));
    writeFileSync(join(project, "assets", "a.png"), "x");
    writeFileSync(join(project, "shared", "a.png"), "y");
    symlinkSync(join(project, "shared"), join(project, "other assets"), "dir");
    writeFileSync(
      join(project, "index.html"),
      '<img src="assets/a.png"><img src="other assets/a.png">',
    );
    const adapter = {
      resolveProject: async (id: string) => ({ id, dir: project }),
    } as unknown as StudioApiAdapter;
    const app = new Hono();
    registerFileRoutes(app, adapter);

    await app.request("/projects/p/files/assets/a.png", {
      method: "PATCH",
      body: JSON.stringify({ newPath: "assets/b.png" }),
    });

    expect(readFileSync(join(project, "index.html"), "utf8")).toBe(
      '<img src="assets/b.png"><img src="other assets/a.png">',
    );
  });

  it("moves a relative link whose target the move leaves behind, and still rewrites references", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-relink-"));
    dirs.push(project);
    mkdirSync(join(project, "assets"));
    mkdirSync(join(project, "shared"));
    writeFileSync(join(project, "shared", "logo.png"), "x");
    symlinkSync("../shared/logo.png", join(project, "assets", "logo.png"), "file");
    writeFileSync(join(project, "index.html"), '<img src="assets/logo.png">');
    const adapter = {
      resolveProject: async (id: string) => ({ id, dir: project }),
    } as unknown as StudioApiAdapter;
    const app = new Hono();
    registerFileRoutes(app, adapter);

    const response = await app.request("/projects/p/files/assets/logo.png", {
      method: "PATCH",
      body: JSON.stringify({ newPath: "logo.png" }),
    });

    expect(response.status).toBe(200);
    expect(readFileSync(join(project, "index.html"), "utf8")).toBe('<img src="logo.png">');
  });

  it("rewrites a path a file in the renamed folder's parent names relative to itself", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-refs-"));
    dirs.push(project);
    mkdirSync(join(project, "assets", "clips"), { recursive: true });
    writeFileSync(join(project, "assets", "clips", "a.png"), "x");
    writeFileSync(
      join(project, "assets", "style.css"),
      "a{background:url(clips/a.png)} b{x:url(./clips/a.png)}",
    );
    writeFileSync(
      join(project, "index.html"),
      '<img src="assets/clips/a.png"><img src="clips/a.png">',
    );
    const adapter = {
      resolveProject: async (id: string) => ({ id, dir: project }),
    } as unknown as StudioApiAdapter;
    const app = new Hono();
    registerFileRoutes(app, adapter);

    const response = await app.request("/projects/p/files/assets/clips", {
      method: "PATCH",
      body: JSON.stringify({ newPath: "assets/takes" }),
    });

    expect(response.status).toBe(200);
    expect(readFileSync(join(project, "assets", "style.css"), "utf8")).toBe(
      "a{background:url(takes/a.png)} b{x:url(./takes/a.png)}",
    );
    expect(readFileSync(join(project, "index.html"), "utf8")).toBe(
      '<img src="assets/takes/a.png"><img src="clips/a.png">',
    );
  });

  const renameIn = async (project: string, from: string, to: string) => {
    const adapter = {
      resolveProject: async (id: string) => ({ id, dir: project }),
    } as unknown as StudioApiAdapter;
    const app = new Hono();
    registerFileRoutes(app, adapter);
    return app.request(`/projects/p/files/${from}`, {
      method: "PATCH",
      body: JSON.stringify({ newPath: to }),
    });
  };

  it("leaves a root path, a path through another folder, and a sibling's relative path alone", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-refs-"));
    dirs.push(project);
    mkdirSync(join(project, "assets", "clips"), { recursive: true });
    mkdirSync(join(project, "assets", "other"));
    mkdirSync(join(project, "clips"));
    writeFileSync(join(project, "assets", "clips", "a.png"), "x");
    writeFileSync(join(project, "clips", "a.png"), "x");
    writeFileSync(join(project, "assets", "style.css"), "url(/clips/a.png) url(other/clips/a.png)");
    writeFileSync(
      join(project, "assets", "other", "x.css"),
      "url(../clips/a.png) url(../../clips/a.png)",
    );

    expect((await renameIn(project, "assets/clips", "assets/takes")).status).toBe(200);
    expect(readFileSync(join(project, "assets", "style.css"), "utf8")).toBe(
      "url(/clips/a.png) url(other/clips/a.png)",
    );
    expect(readFileSync(join(project, "assets", "other", "x.css"), "utf8")).toBe(
      "url(../clips/a.png) url(../../clips/a.png)",
    );
  });

  it("rewrites each reference once when the new path holds the old folder's name", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-refs-"));
    dirs.push(project);
    mkdirSync(join(project, "a", "b"), { recursive: true });
    mkdirSync(join(project, "b"));
    writeFileSync(join(project, "a", "b", "image.png"), "x");
    writeFileSync(join(project, "a", "style.css"), "url(/a/b/image.png) url(b/image.png)");

    expect((await renameIn(project, "a/b", "b/c")).status).toBe(200);
    expect(readFileSync(join(project, "a", "style.css"), "utf8")).toBe(
      "url(/b/c/image.png) url(../b/c/image.png)",
    );
  });

  it("reads a path in a folder's file as relative to that folder where both readings match", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-refs-"));
    dirs.push(project);
    mkdirSync(join(project, "a", "a", "a"), { recursive: true });
    writeFileSync(join(project, "a", "a", "a", "image.png"), "x");
    writeFileSync(join(project, "a", "style.css"), "url(a/a/image.png)");

    expect((await renameIn(project, "a/a", "a/b")).status).toBe(200);
    expect(readFileSync(join(project, "a", "style.css"), "utf8")).toBe("url(b/a/image.png)");
  });

  it("leaves a path that climbs back out of the renamed folder alone", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-refs-"));
    dirs.push(project);
    mkdirSync(join(project, "a", "b"), { recursive: true });
    writeFileSync(join(project, "a", "b", "image.png"), "x");
    writeFileSync(join(project, "a", "logo.png"), "x");
    writeFileSync(
      join(project, "a", "style.css"),
      'url(b/../logo.png) url(b/sub/../../logo.png) url(b\\.\\..\\logo.png) url("b/../in/logo.png") url("b/sub dir/../../logo.png") url("b/s,(;)/../../logo.png") url(b/image.png)',
    );

    expect((await renameIn(project, "a/b", "b/c")).status).toBe(200);
    expect(readFileSync(join(project, "a", "style.css"), "utf8")).toBe(
      'url(b/../logo.png) url(b/sub/../../logo.png) url(b\\.\\..\\logo.png) url("b/../in/logo.png") url("b/sub dir/../../logo.png") url("b/s,(;)/../../logo.png") url(../b/c/image.png)',
    );
  });

  it("in HTML takes the folder reading only where its file exists, else leaves the root path to the root pass", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-refs-"));
    dirs.push(project);
    mkdirSync(join(project, "assets"));
    mkdirSync(join(project, "compositions", "assets"), { recursive: true });
    writeFileSync(join(project, "assets", "logo.png"), "x");
    mkdirSync(join(project, "compositions", "assets", "logo"));
    writeFileSync(join(project, "compositions", "assets", "logo", "mark.png"), "x");
    writeFileSync(join(project, "assets", "logo final.png"), "x");
    writeFileSync(join(project, "assets", "bg.png final.png"), "x");
    writeFileSync(join(project, "assets", "bg.png)final.png"), "x");
    writeFileSync(join(project, "compositions", "app.js"), 'fetch("assets/bg.png")');
    writeFileSync(join(project, "compositions", "assets", "bg.png"), "x");
    writeFileSync(
      join(project, "compositions", "hero.html"),
      '<img src="assets/logo.png"><img src="assets/logo final.png"><img src="assets/bg.png final.png"><img src="assets/bg.png)final.png"><img srcset="assets/bg.png 2x" src="assets/bg.png"><script>fetch("assets/bg.png")</script ><script>fetch("assets/bg.png")</script\n>',
    );

    expect((await renameIn(project, "compositions/assets", "compositions/media")).status).toBe(200);
    expect(readFileSync(join(project, "compositions", "hero.html"), "utf8")).toBe(
      '<img src="assets/logo.png"><img src="assets/logo final.png"><img src="assets/bg.png final.png"><img src="assets/bg.png)final.png"><img srcset="media/bg.png 2x" src="media/bg.png"><script>fetch("assets/bg.png")</script ><script>fetch("assets/bg.png")</script\n>',
    );
    expect(readFileSync(join(project, "compositions", "app.js"), "utf8")).toBe(
      'fetch("assets/bg.png")',
    );
  });

  it("in HTML gives a path the runtime reads from the root to the root pass, where both readings match", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-refs-"));
    dirs.push(project);
    mkdirSync(join(project, "scenes", "scenes"), { recursive: true });
    writeFileSync(join(project, "scenes", "scenes", "clip.mp4"), "x");
    writeFileSync(join(project, "scenes", "intro.html"), '<video src="scenes/scenes/clip.mp4">');

    expect((await renameIn(project, "scenes/scenes", "scenes/shots")).status).toBe(200);
    expect(readFileSync(join(project, "scenes", "intro.html"), "utf8")).toBe(
      '<video src="scenes/shots/clip.mp4">',
    );
  });

  it("edits each reference once when the new path ends in the old one, and keeps a longer folder's path", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-refs-"));
    dirs.push(project);
    mkdirSync(join(project, "a", "b"), { recursive: true });
    mkdirSync(join(project, "assets", "clips"), { recursive: true });
    mkdirSync(join(project, "assets", "old clips"), { recursive: true });
    writeFileSync(join(project, "a", "b", "x.png"), "x");
    writeFileSync(join(project, "assets", "clips", "a.png"), "x");
    writeFileSync(join(project, "assets", "old clips", "a.png"), "x");
    writeFileSync(join(project, "a", "s.css"), "url(b/x.png)");
    writeFileSync(join(project, "assets", "s.css"), 'url("old clips/a.png") url(clips/a.png)');

    expect((await renameIn(project, "a/b", "a/a/b")).status).toBe(200);
    expect(readFileSync(join(project, "a", "s.css"), "utf8")).toBe("url(a/b/x.png)");
    expect((await renameIn(project, "assets/clips", "assets/takes")).status).toBe(200);
    expect(readFileSync(join(project, "assets", "s.css"), "utf8")).toBe(
      'url("old clips/a.png") url(takes/a.png)',
    );
  });
});
