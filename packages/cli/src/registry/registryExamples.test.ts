import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const examplesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../registry/examples",
);

// Outside hosts the starters already load from: the script CDN, the font
// service, and HeyGen's own asset host. Anything else a starter shows has to
// ship with it, so a new project keeps rendering the same frames whatever
// happens to an outside site. Do not grow this list for a new starter.
const knownHosts = new Set([
  "cdn.jsdelivr.net",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "static.heygen.ai",
]);

const scannedFile = /\.(?:html|css|svg|js|mjs)$/i;
// Bundled third-party builds cite outside pages in their license comments.
const vendoredDir = /(?:^|\/)vendor\//i;
const minifiedFile = /\.min\.js$/i;

function remoteHosts(text: string): string[] {
  // XML namespace names are identifiers, never fetched.
  const withoutNamespaces = text
    .replace(/\bxmlns(?::[\w-]+)?=(["'])[^"']*\1/gi, "")
    .replace(/http:\/\/www\.w3\.org\/(?:1998|1999|2000)\/[\w/]+/g, "");
  const hosts: string[] = [];
  // A scheme, or a protocol-relative "//" that opens a quoted or url() value.
  const pattern = /(?:https?:\\?\/\\?\/|(?<=["'`(=]\s*)\/\/)(?:[^\s/"'()?#\\@]*@)?([a-z0-9.-]+)/gi;
  for (const match of withoutNamespaces.matchAll(pattern)) {
    hosts.push((match[1] ?? "").toLowerCase());
  }
  return hosts;
}

function starterFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? starterFiles(path) : [path];
  });
}

describe("registry examples", () => {
  it("finds a host in each way a starter file can name one", () => {
    expect(remoteHosts(`background: url("https://textures.example/paper.png");`)).toEqual([
      "textures.example",
    ]);
    expect(remoteHosts(`<img src='//Images.Example/a.png'>`)).toEqual(["images.example"]);
    expect(remoteHosts(`url(//img.example/a.png)`)).toEqual(["img.example"]);
    expect(remoteHosts("const src = `//img.example/a.png`;")).toEqual(["img.example"]);
    expect(remoteHosts(`<img src="https://img.example?x=1">`)).toEqual(["img.example"]);
    expect(remoteHosts(`url(https://img.example#a)`)).toEqual(["img.example"]);
    expect(remoteHosts(`"https:\\/\\/img.example\\/a.png"`)).toEqual(["img.example"]);
    expect(remoteHosts(`<img src="http://203.0.113.9/a.png">`)).toEqual(["203.0.113.9"]);
    expect(remoteHosts(`fetch("http://localhost:3000/a.png")`)).toEqual(["localhost"]);
    expect(remoteHosts(`<img src="https://user@img.example/a.png">`)).toEqual(["img.example"]);
  });

  it("does not take a local path, a comment or a namespace name for a host", () => {
    expect(remoteHosts(`<img src="assets/a.png">`)).toEqual([]);
    expect(remoteHosts(`<img src="assets//paper.png">`)).toEqual([]);
    expect(remoteHosts(`//el.style is set below`)).toEqual([]);
    expect(remoteHosts(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`)).toEqual([]);
    expect(remoteHosts(`document.createElementNS("http://www.w3.org/2000/svg", "rect")`)).toEqual(
      [],
    );
    expect(remoteHosts(`<script src="https://www.w3.org/a.js"></script>`)).toEqual(["www.w3.org"]);
    expect(
      remoteHosts(`<svg xmlns:inkscape='http://www.inkscape.org/namespaces/inkscape'></svg>`),
    ).toEqual([]);
  });

  it("load nothing from an outside host that is not already known", () => {
    const files = starterFiles(examplesDir)
      .map((path) => relative(examplesDir, path).split("\\").join("/"))
      .filter(
        (path) => scannedFile.test(path) && !vendoredDir.test(path) && !minifiedFile.test(path),
      );
    expect(files.some((path) => path.endsWith(".html"))).toBe(true);

    const unexpected: string[] = [];
    for (const path of files) {
      for (const host of remoteHosts(readFileSync(join(examplesDir, path), "utf8"))) {
        if (!knownHosts.has(host)) unexpected.push(`${path}: ${host}`);
      }
    }

    expect(unexpected).toEqual([]);
  });
});
