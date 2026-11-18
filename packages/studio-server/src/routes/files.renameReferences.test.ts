import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { referenceRewriter, registerFileRoutes } from "./files";
import type { StudioApiAdapter } from "../types";

const rewrite = (text: string, from: string, to: string, folder: boolean) =>
  referenceRewriter(from, to, folder)(text);

function fileRoutesFor(project: string): Hono {
  const adapter = {
    resolveProject: async (id: string) => ({ id, dir: project }),
  } as unknown as StudioApiAdapter;
  const app = new Hono();
  registerFileRoutes(app, adapter);
  return app;
}

describe("rename references", () => {
  it.each([
    ["data:logo.png", "data%3Alogo.png"],
    ["x\\y.png", "x%5Cy.png"],
    [" a\t\n\r .png ", "%20a%09%0A%0D%20.png%20"],
  ])("keeps the renamed physical file %j representable in a raw HTML URL", (filename, url) => {
    expect(rewrite('<img src="old.png">', "old.png", filename, false)).toBe(`<img src="${url}">`);
  });

  it("renames a reference spelled percent-encoded", () => {
    expect(
      rewrite(
        '<video src="assets/My%20clip.mp4"></video>',
        "assets/My clip.mp4",
        "assets/New clip.mp4",
        false,
      ),
    ).toBe('<video src="assets/New%20clip.mp4"></video>');
  });

  it("does not classify active URL fields through script-looking comments", () => {
    expect(
      rewrite(`<!-- <script> --><img src="a.png"><!-- </script> -->`, "a.png", "a?#.png", false),
    ).toBe(`<!-- <script> --><img src="a%3F%23.png"><!-- </script> -->`);
  });
  it("keeps unquoted entity-spelled references valid when the new name contains spaces", () => {
    expect(rewrite(`<img src=a&amp;b.png>`, "a&b.png", "new file.png", false)).toBe(
      `<img src=new&#32;file.png>`,
    );
    expect(
      rewrite(`<div data-composition-src=a&amp;b.html>`, "a&b.html", "new file.html", false),
    ).toBe(`<div data-composition-src=new&#32;file.html>`);
  });

  it("keeps a URL suffix distinct from a longer physical filename that exists", () => {
    const rename = referenceRewriter("a.png", "new.png", false, ["a.png?x", "a.png#x"]);
    expect(rename(`<img src="a.png?x"><img src="a.png#x">`)).toBe(
      `<img src="new.png?x"><img src="new.png#x">`,
    );
  });

  it("does not borrow HTML decoding from a later URL field for a raw script", () => {
    const text = `<script>const p = "a&amp;b.png";</script><img src="other.png">`;
    expect(rewrite(text, "a&b.png", "new.png", false)).toBe(text);
  });

  it("encodes each srcset candidate and SVG href for its URL consumer", () => {
    const text = `<img srcset="old.png 1x, other.png 2x"><image xlink:href="old.png"/>`;
    expect(rewrite(text, "old.png", "new file%#.png", false)).toBe(
      `<img srcset="new%20file%25%23.png 1x, other.png 2x"><image xlink:href="new file%25%23.png"/>`,
    );
  });

  it("does not rename a URL query as part of the physical filename", () => {
    const text = `<img src="a.png?x"><img src="other.png?asset=a.png">`;
    expect(rewrite(text, "a.png?x", "new.png", false)).toBe(text);
    expect(rewrite(`<img src="other.png?asset=a.png">`, "a.png", "new.png", false)).toBe(
      `<img src="other.png?asset=a.png">`,
    );
  });

  it("does not treat an attribute-looking string inside a raw HTML value as a URL field", () => {
    const text = `<div data-note="src='old%20file.png'"></div>`;
    expect(rewrite(text, "old file.png", "new file.png", false)).toBe(text);
  });

  it("decodes the enclosing HTML grammar when matching a CSS URL in a style attribute", () => {
    const text = '<div style="background:url(&quot;assets/a&#39;b.png&quot;)"></div>';
    expect(rewrite(text, "assets/a'b.png", "assets/c(d).png", false)).toBe(
      '<div style="background:url(&quot;assets/c%28d%29.png&quot;)"></div>',
    );
  });

  it("does not interpret percent or entity spelling in raw script file values", () => {
    const text = '{"path":"old%20file.png","raw":"old file.png"}';
    expect(
      referenceRewriter("old file.png", "new file.png", false, ["old%20file.png"])(text, "script"),
    ).toBe('{"path":"old%20file.png","raw":"new file.png"}');
    expect(referenceRewriter("a&b.png", "new.png", false)('"a&amp;b.png"', "script")).toBe(
      '"a&amp;b.png"',
    );
  });

  it("keeps a raw percent-spelled composition sibling distinct from a space", () => {
    const text = '<div data-composition-src="scenes/old%20file.html"></div>';
    expect(referenceRewriter("scenes/old file.html", "scenes/new file.html", false)(text)).toBe(
      text,
    );
  });

  it("can rename an entity-quoted composition path containing literal percent text twice", () => {
    const first = rewrite(
      '<div data-composition-src="scenes/a.html"></div>',
      "scenes/a.html",
      'scenes/a"%20.html',
      false,
    );
    expect(first).toBe('<div data-composition-src="scenes/a&quot;%20.html"></div>');
    expect(rewrite(first, 'scenes/a"%20.html', "scenes/new file.html", false)).toBe(
      '<div data-composition-src="scenes/new file.html"></div>',
    );
  });

  it("escapes parentheses in an unquoted CSS URL", () => {
    expect(
      referenceRewriter("assets/a.png", "assets/a(b).png", false)("url(assets/a.png)", "css"),
    ).toBe("url(assets/a%28b%29.png)");
  });

  it("does not backtrack through overlapping whitespace in an unfinished CSS URL", () => {
    const text = "url(assets/a.png)\nurl(" + " ".repeat(10000);
    expect(referenceRewriter("assets/a.png", "assets/b.png", false)(text, "css")).toBe(
      "url(assets/b.png)\nurl(" + " ".repeat(10000),
    );
  });

  it("keeps the whole unquoted reference valid when renaming a folder with spaces", () => {
    expect(rewrite("<img src=assets/a.png>", "assets", "my assets", true)).toBe(
      "<img src=my&#32;assets/a.png>",
    );
    expect(referenceRewriter("assets", "my assets", true)("url(assets/a.png)", "css")).toBe(
      "url(my%20assets/a.png)",
    );
  });

  it("can rename a template-literal filename again after escaping interpolation", () => {
    const original = "`assets/a.png`";
    const first = referenceRewriter(
      "assets/a.png",
      "assets/${name}.png",
      false,
    )(original, "script");
    expect(first).toBe("`assets/\\${name}.png`");
    expect(
      referenceRewriter("assets/${name}.png", "assets/final.png", false)(first, "script"),
    ).toBe("`assets/final.png`");
  });

  it("keeps URL delimiters and literal percent signs escaped in an entity-spelled reference", () => {
    expect(
      rewrite('<img src="assets/a&amp;b.png">', "assets/a&b.png", "assets/c(?%20#).png", false),
    ).toBe('<img src="assets/c(%3F%2520%23).png">');
  });

  it("leaves encoded longer existing names alone on either side of a match", () => {
    const text =
      '<img src="assets/my%20clip.png&amp;backup.png"><img src="other%20assets/my%20clip.png"><img src="assets/my%20clip.png">';
    expect(
      referenceRewriter("assets/my clip.png", "assets/new clip.png", false, [
        "assets/my clip.png&backup.png",
        "other assets/my clip.png",
        "assets/my clip.png",
      ])(text),
    ).toBe(
      '<img src="assets/my%20clip.png&amp;backup.png"><img src="other%20assets/my%20clip.png"><img src="assets/new%20clip.png">',
    );
  });

  it("escapes a newly introduced quote even when the old reference used no escapes", () => {
    expect(rewrite('<img src="assets/a.png">', "assets/a.png", 'assets/say "hi".png', false)).toBe(
      '<img src="assets/say &quot;hi&quot;.png">',
    );
  });

  it("keeps URL delimiters and quotes encoded when renaming a percent-spelled reference", () => {
    expect(
      rewrite("<img src='assets/my%20clip.png'>", "assets/my clip.png", "assets/it's?#.png", false),
    ).toBe("<img src='assets/it%27s%3F%23.png'>");
  });

  it("can rename an apostrophe reference after it was percent-encoded", () => {
    expect(
      rewrite('<img src="assets/it%27s.png">', "assets/it's.png", "assets/their.png", false),
    ).toBe('<img src="assets/their.png">');
  });

  it("keeps both quote kinds escaped when renaming an entity-spelled reference", () => {
    expect(
      rewrite(
        "<img src='assets/it&apos;s.png'>",
        "assets/it's.png",
        `assets/that's & "ours".png`,
        false,
      ),
    ).toBe("<img src='assets/that&#39;s &amp; &quot;ours&quot;.png'>");
  });

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

  it("keeps a root-relative lead and interprets JSON separators in their consumer grammar", () => {
    const slash = '{"src":"assets\\/a.png"}';
    const backslash = '{"path":"assets\\\\a.png"}';
    expect(JSON.parse(slash).src).toBe("assets/a.png");
    expect(JSON.parse(backslash).path).toBe("assets\\a.png");
    const text = `<img src="/assets/a.png">\n<script>${slash}</script>\n<script>${backslash}</script>`;
    const backslashAfter = process.platform === "win32" ? '{"path":"brand\\\\a.png"}' : backslash;
    expect(rewrite(text, "assets", "brand", true)).toBe(
      `<img src="/brand/a.png">\n<script>{"src":"brand\\/a.png"}</script>\n<script>${backslashAfter}</script>`,
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

  it("compares escaped script spellings against both distinct physical path identities", () => {
    const slash = String.raw`"dir\/other a.png&backup.png"`;
    const backslash = String.raw`"dir\\other a.png&backup.png"`;
    expect(JSON.parse(slash)).toBe("dir/other a.png&backup.png");
    expect(JSON.parse(backslash)).toBe("dir\\other a.png&backup.png");
    const text = `${slash} ${backslash}`;
    expect(
      referenceRewriter("a.png", "b.png", false, [
        "dir/other a.png&backup.png",
        "dir\\other a.png&backup.png",
      ])(text, "script"),
    ).toBe(text);
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

  it.each([42, null, "assets/\ud800.png", "assets/\udc00.png"])(
    "rejects an unrepresentable rename path %j before moving the file",
    async (newPath) => {
      const project = mkdtempSync(join(tmpdir(), "hf-invalid-rename-"));
      dirs.push(project);
      mkdirSync(join(project, "assets"));
      writeFileSync(join(project, "assets", "a.png"), "original asset");
      const response = await fileRoutesFor(project).request("/projects/p/files/assets/a.png", {
        method: "PATCH",
        body: JSON.stringify({ newPath }),
      });
      expect(response.status).toBe(400);
      expect(readFileSync(join(project, "assets", "a.png"), "utf8")).toBe("original asset");
    },
  );

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
    const app = fileRoutesFor(project);

    const response = await app.request("/projects/p/files/assets", {
      method: "PATCH",
      body: JSON.stringify({ newPath: "brand" }),
    });

    expect(response.status).toBe(200);
    expect(readFileSync(join(project, "index.html"), "utf8")).toBe(
      '<img src="brand/a.png"><img src="assets-backup/a.png"><img src="other assets/a.png"><a href="empty assets/">x</a><p>The assets folder</p>',
    );
  });

  it("keeps raw quoted file paths usable in JSON and script strings", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-quote-"));
    dirs.push(project);
    mkdirSync(join(project, "assets"));
    writeFileSync(join(project, "assets", "a.png"), "original asset");
    writeFileSync(join(project, "config.json"), '{"path":"assets/a.png"}');
    writeFileSync(join(project, "script.js"), '"assets/a.png"');
    writeFileSync(join(project, "index.html"), '<script>"assets/a.png"</script>');
    const app = fileRoutesFor(project);
    const response = await app.request("/projects/p/files/assets/a.png", {
      method: "PATCH",
      body: JSON.stringify({ newPath: 'assets/say "hi".png' }),
    });
    expect(response.status).toBe(200);
    const config = JSON.parse(readFileSync(join(project, "config.json"), "utf8")) as {
      path: string;
    };
    expect(readFileSync(join(project, config.path), "utf8")).toBe("original asset");
    expect(JSON.parse(readFileSync(join(project, "script.js"), "utf8"))).toBe(
      'assets/say "hi".png',
    );
    expect(readFileSync(join(project, "index.html"), "utf8")).toBe(
      String.raw`<script>"assets/say \"hi\".png"</script>`,
    );
    const renamedAgain = await app.request(
      `/projects/p/files/${encodeURIComponent('assets/say "hi".png')}`,
      {
        method: "PATCH",
        body: JSON.stringify({ newPath: "assets/final.png" }),
      },
    );
    expect(renamedAgain.status).toBe(200);
    const finalConfig = JSON.parse(readFileSync(join(project, "config.json"), "utf8")) as {
      path: string;
    };
    expect(readFileSync(join(project, finalConfig.path), "utf8")).toBe("original asset");
    expect(JSON.parse(readFileSync(join(project, "script.js"), "utf8"))).toBe("assets/final.png");
  });

  it("does not retarget a distinct literal-backslash file when renaming a slash path", async () => {
    const distinctName = process.platform === "win32" ? "assets-a.png" : "assets\\a.png";
    const project = mkdtempSync(join(tmpdir(), "hf-rename-separator-identity-"));
    dirs.push(project);
    mkdirSync(join(project, "assets"));
    writeFileSync(join(project, "assets/a.png"), "asset A");
    writeFileSync(join(project, distinctName), "asset B");
    const config = JSON.stringify({ path: distinctName });
    writeFileSync(join(project, "config.json"), config);
    writeFileSync(join(project, "script.js"), JSON.stringify(distinctName));
    writeFileSync(join(project, "index.html"), '<img src="assets/a.png">');
    const response = await fileRoutesFor(project).request("/projects/p/files/assets/a.png", {
      method: "PATCH",
      body: JSON.stringify({ newPath: "assets/b.png" }),
    });
    expect(response.status).toBe(200);
    expect(readFileSync(join(project, "config.json"), "utf8")).toBe(config);
    expect(readFileSync(join(project, "script.js"), "utf8")).toBe(JSON.stringify(distinctName));
    expect(readFileSync(join(project, "index.html"), "utf8")).toBe('<img src="assets/b.png">');
    expect(readFileSync(join(project, "assets/b.png"), "utf8")).toBe("asset A");
    expect(readFileSync(join(project, distinctName), "utf8")).toBe("asset B");
    const folderResponse = await fileRoutesFor(project).request("/projects/p/files/assets", {
      method: "PATCH",
      body: JSON.stringify({ newPath: "brand" }),
    });
    expect(folderResponse.status).toBe(200);
    expect(readFileSync(join(project, "config.json"), "utf8")).toBe(config);
    expect(readFileSync(join(project, "index.html"), "utf8")).toBe('<img src="brand/b.png">');
    expect(readFileSync(join(project, "brand/b.png"), "utf8")).toBe("asset A");
    expect(readFileSync(join(project, distinctName), "utf8")).toBe("asset B");
  });

  it("renames a literal backslash filename twice through the route", async () => {
    const intermediate = process.platform === "win32" ? "x/y.png" : "x\\y.png";
    const project = mkdtempSync(join(tmpdir(), "hf-rename-backslash-"));
    dirs.push(project);
    writeFileSync(join(project, "old.png"), "image witness");
    writeFileSync(join(project, "index.html"), '<img src="old.png">');
    writeFileSync(join(project, "config.json"), '{"path":"old.png"}');
    const app = fileRoutesFor(project);
    for (const [from, to] of [
      ["old.png", intermediate],
      [intermediate, "final.png"],
    ]) {
      const response = await app.request(`/projects/p/files/${encodeURIComponent(from!)}`, {
        method: "PATCH",
        body: JSON.stringify({ newPath: to }),
      });
      expect(response.status).toBe(200);
    }
    expect(readFileSync(join(project, "index.html"), "utf8")).toBe('<img src="final.png">');
    expect(JSON.parse(readFileSync(join(project, "config.json"), "utf8")).path).toBe("final.png");
    expect(readFileSync(join(project, "final.png"), "utf8")).toBe("image witness");
  });

  it("renames references using the full native HTML entity vocabulary through the route", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-native-entities-"));
    dirs.push(project);
    writeFileSync(join(project, "a&≂̸b.png"), "image witness");
    writeFileSync(
      join(project, "index.html"),
      '<img src="a&#38;&NotEqualTilde;b.png"><img src="a&#x26;&NotEqualTilde;b.png"><div style="background:url(a&#38;&NotEqualTilde;b.png)"></div>',
    );
    const response = await fileRoutesFor(project).request(
      `/projects/p/files/${encodeURIComponent("a&≂̸b.png")}`,
      {
        method: "PATCH",
        body: JSON.stringify({ newPath: "new.png" }),
      },
    );
    expect(response.status).toBe(200);
    expect(readFileSync(join(project, "index.html"), "utf8")).toBe(
      '<img src="new.png"><img src="new.png"><div style="background:url(new.png)"></div>',
    );
    expect(readFileSync(join(project, "new.png"), "utf8")).toBe("image witness");
  });

  it("keeps a renamed scheme-looking physical filename reachable by the bundler", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-local-scheme-"));
    dirs.push(project);
    writeFileSync(join(project, "a.png"), "image witness");
    writeFileSync(
      join(project, "index.html"),
      '<html><body><main data-composition-id="root" data-width="320" data-height="180"><img src="a.png"></main></body></html>',
    );
    const response = await fileRoutesFor(project).request("/projects/p/files/a.png", {
      method: "PATCH",
      body: JSON.stringify({ newPath: "data:logo.png" }),
    });
    expect(response.status).toBe(200);
    expect(readFileSync(join(project, "data:logo.png"), "utf8")).toBe("image witness");
    expect(readFileSync(join(project, "index.html"), "utf8")).toContain('src="data%3Alogo.png"');
    const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
    expect(await bundleToSingleHtml(project)).toContain(
      "data:image/png;base64,aW1hZ2Ugd2l0bmVzcw==",
    );
  });

  it("renames URL fields to literal URL punctuation without changing raw file values", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-rename-url-fields-"));
    dirs.push(project);
    mkdirSync(join(project, "assets"));
    writeFileSync(join(project, "assets", "a.png"), "image witness");
    writeFileSync(join(project, "config.json"), '{"path":"assets/a.png"}');
    writeFileSync(
      join(project, "index.html"),
      '<html><head><style>.image{background:url(assets/a.png)}</style></head><body><main data-composition-id="root" data-width="320" data-height="180"><img src="assets/a.png"><a href="assets/a.png">image</a></main></body></html>',
    );
    const response = await fileRoutesFor(project).request("/projects/p/files/assets/a.png", {
      method: "PATCH",
      body: JSON.stringify({ newPath: "assets/c(?%20#).png" }),
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(readFileSync(join(project, "config.json"), "utf8")).path).toBe(
      "assets/c(?%20#).png",
    );
    const html = readFileSync(join(project, "index.html"), "utf8");
    expect(html).toContain('src="assets/c(%3F%2520%23).png"');
    expect(html).toContain('href="assets/c(%3F%2520%23).png"');
    expect(html).toContain("url(assets/c%28%3F%2520%23%29.png)");
    const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
    const bundled = await bundleToSingleHtml(project);
    expect(bundled).toContain("data:image/png;base64,aW1hZ2Ugd2l0bmVzcw==");
    expect(bundled).not.toContain("url(assets/c%28%3F%2520%23%29.png)");
  });

  it.each(["my intro.html", 'my "intro".html', "my ?%20#intro.html", "my 🙂 intro.html"])(
    "keeps a renamed sub-composition %s reachable by the bundler",
    async (newName) => {
      const project = mkdtempSync(join(tmpdir(), "hf-rename-composition-"));
      dirs.push(project);
      mkdirSync(join(project, "scenes"));
      writeFileSync(
        join(project, "index.html"),
        '<!doctype html><html><body><main data-composition-id="root" data-width="320" data-height="180"><div data-composition-id="intro" data-composition-src="scenes/intro.html" data-start="0" data-duration="2"></div></main></body></html>',
      );
      writeFileSync(
        join(project, "scenes", "intro.html"),
        '<template><div data-composition-id="intro" data-width="320" data-height="180"><p>Renamed scene still present</p></div></template>',
      );
      const app = fileRoutesFor(project);
      const response = await app.request("/projects/p/files/scenes/intro.html", {
        method: "PATCH",
        body: JSON.stringify({ newPath: `scenes/${newName}` }),
      });
      expect(response.status).toBe(200);
      const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
      const bundled = await bundleToSingleHtml(project);
      expect(bundled).toContain("Renamed scene still present");
    },
  );

  it.each([
    ["my clip.mp4", "next clip.mp4", "my%20clip.mp4", "next%20clip.mp4"],
    ["a&b.png", "c&d.png", "a&amp;b.png", "c&amp;d.png"],
  ])(
    "renames %s references using their authored spelling",
    async (oldName, newName, before, after) => {
      const project = mkdtempSync(join(tmpdir(), "hf-rename-spelling-"));
      dirs.push(project);
      mkdirSync(join(project, "assets"));
      writeFileSync(join(project, "assets", oldName), "x");
      writeFileSync(join(project, "index.html"), `<img src="assets/${before}">`);
      const app = fileRoutesFor(project);

      const response = await app.request(
        `/projects/p/files/assets/${encodeURIComponent(oldName)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ newPath: `assets/${newName}` }),
        },
      );

      expect(response.status).toBe(200);
      expect(readFileSync(join(project, "index.html"), "utf8")).toBe(`<img src="assets/${after}">`);
      expect(readFileSync(join(project, "assets", newName), "utf8")).toBe("x");
    },
  );

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
    const app = fileRoutesFor(project);

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
    const app = fileRoutesFor(project);

    const response = await app.request("/projects/p/files/assets/logo.png", {
      method: "PATCH",
      body: JSON.stringify({ newPath: "logo.png" }),
    });

    expect(response.status).toBe(200);
    expect(readFileSync(join(project, "index.html"), "utf8")).toBe('<img src="logo.png">');
  });
});
