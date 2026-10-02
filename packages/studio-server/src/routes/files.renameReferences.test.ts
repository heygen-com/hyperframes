import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { registerFileRoutes, replaceReferences } from "./files";
import type { StudioApiAdapter } from "../types";

const rewrite = (text: string, from: string, to: string, folder: boolean) =>
  replaceReferences(text, from, to, folder);

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
    ) => replaceReferences(text, from, to, folder, existing);
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
    writeFileSync(join(project, "other assets", "a.png"), "x");
    writeFileSync(join(project, "assets", "a.png"), "x");
    const html =
      '<img src="assets/a.png"><img src="assets-backup/a.png"><img src="other assets/a.png"><p>The assets folder</p>';
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
      '<img src="brand/a.png"><img src="assets-backup/a.png"><img src="other assets/a.png"><p>The assets folder</p>',
    );
  });
});
