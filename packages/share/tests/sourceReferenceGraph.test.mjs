import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { retainReferencedFiles } from "../src/sources/referencedFiles.mjs";

function sourceGraph(text) {
  const directoryEntries = new Map();
  const files = Object.entries(text).map(([path, content]) => {
    let parent = "";
    for (const name of path.split("/")) {
      if (!directoryEntries.has(parent)) directoryEntries.set(parent, new Set());
      directoryEntries.get(parent).add(name);
      parent = parent ? parent + "/" + name : name;
    }
    return {
      path,
      size: Buffer.byteLength(content),
      mtimeMs: 1,
      include_hidden: path.split("/").some((segment) => segment.startsWith(".")),
    };
  });
  const reads = new Map();
  async function openListed(_root, file) {
    reads.set(file.path, (reads.get(file.path) ?? 0) + 1);
    const bytes = Buffer.from(text[file.path]);
    return {
      read: async (target, offset, length, position) => ({
        bytesRead: bytes.copy(target, offset, position, position + length),
      }),
      stat: async () => ({ size: bytes.length, mtimeMs: 1 }),
      close: async () => {},
    };
  }
  const walk = { files, directoryEntries, problems: [] };
  return { run: () => retainReferencedFiles("", walk, openListed), walk, reads };
}

test("shared and cyclic scripts are scanned once and resolve media in each document context", async () => {
  const shared = 'import "./shared.js"; fetch(".icons/logo.png");';
  const graph = sourceGraph({
    "index.html":
      '<div data-composition-src="a/page.html"></div><div data-composition-src="b/page.html"></div>',
    "a/page.html": '<script type="module" src="../shared.js"></script>',
    "b/page.html": '<script type="module" src="../shared.js"></script>',
    "shared.js": shared,
    "a/.icons/logo.png": "first",
    "b/.icons/logo.png": "second",
    "b/.icons/other.png": "unreferenced",
  });
  const hashes = await graph.run();
  assert.deepEqual(graph.walk.problems, []);
  assert.deepEqual(
    graph.walk.files.filter((f) => f.include_hidden).map((f) => f.path),
    ["a/.icons/logo.png", "b/.icons/logo.png"],
  );
  assert.equal(graph.reads.get("shared.js"), 1);
  assert.equal(hashes.get("shared.js"), createHash("sha256").update(shared).digest("hex"));
});

test("the scan bounds cumulative reference expansions across document contexts", async () => {
  const pages = Array.from({ length: 320 }, (_, index) => "scenes/" + index + ".html");
  const graph = sourceGraph({
    "index.html": pages.map((page) => '<div data-composition-src="' + page + '"></div>').join(""),
    ...Object.fromEntries(pages.map((page) => [page, '<script src="../shared.js"></script>'])),
    "shared.js": Array.from({ length: 320 }, (_, i) => 'fetch("image-' + i + '.png");').join("\n"),
    "art/.icons/candidate.png": "candidate",
  });
  await graph.run();
  assert.deepEqual(graph.walk.problems, [{ path: "shared.js", problem: "unreadable" }]);
  assert.equal(graph.reads.get("shared.js"), 1);
});

test("literal FontFace sources resolve against the loading document", async () => {
  const graph = sourceGraph({
    "index.html": '<script src="scripts/load.js"></script>',
    "scripts/load.js": 'new FontFace("Brand", "local(Brand), url(.fonts/Brand.woff2)");',
    ".fonts/Brand.woff2": "used font",
    "scripts/.fonts/Brand.woff2": "unused sibling",
  });
  await graph.run();
  assert.deepEqual(graph.walk.problems, []);
  assert.deepEqual(
    graph.walk.files.filter((file) => file.include_hidden).map((file) => file.path),
    [".fonts/Brand.woff2"],
  );
});

test("a remote document base does not select a matching local asset", async () => {
  const graph = sourceGraph({
    "index.html": '<base href="https://static.example.test/"><img src="art/.icons/logo.png">',
    "art/.icons/logo.png": "local logo",
  });
  await graph.run();
  assert.deepEqual(graph.walk.problems, []);
  assert.deepEqual(
    graph.walk.files.map((file) => file.path),
    ["index.html"],
  );
});

test("an encoded separator cannot select a hidden folder", async () => {
  const graph = sourceGraph({
    "index.html": '<img src="art%2f.icons/logo.png"><img src="art/.icons/used%20logo.png">',
    "art/.icons/logo.png": "unused logo",
    "art/.icons/used logo.png": "used logo",
  });
  await graph.run();
  assert.deepEqual(graph.walk.problems, []);
  assert.deepEqual(
    graph.walk.files.map((file) => file.path),
    ["index.html", "art/.icons/used logo.png"],
  );
});
