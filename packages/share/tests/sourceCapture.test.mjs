import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { captureProject, hashListedFile, hashMemo } from "../src/sources/capture.mjs";

/** A project folder holding `files` (path to contents). @param {Record<string, string>} files */
async function project(files) {
  const root = await mkdtemp(join(tmpdir(), "hf-sync-capture-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const sha = (/** @type {string} */ text) => createHash("sha256").update(text).digest("hex");

/** @param {Awaited<ReturnType<typeof captureProject>>} capture */
function captured(capture) {
  assert.equal(capture.at, "captured", JSON.stringify(capture));
  return /** @type {Extract<typeof capture, { at: "captured" }>} */ (capture);
}

test("a capture lists portable files with their hashes and leaves out what the policy excludes", async () => {
  const root = await project({
    "index.html": "<html></html>",
    "assets/logo.png": "png",
    ".hyperframes/brand-kit.json": "{}",
    ".hyperframes/comments.jsonl": "{}",
    ".hyperframes/share.json": "{}",
    "node_modules/x/index.js": "x",
    ".env": "SECRET=1",
    ".DS_Store": "",
    "renders/out.mp4": "mp4",
    "Icon\r": "",
  });
  const { manifest, waiting, skippedLinks } = captured(await captureProject(root));
  assert.deepEqual(manifest.document.files, [
    { path: ".hyperframes/brand-kit.json", sha256: sha("{}"), size: 2 },
    { path: "assets/logo.png", sha256: sha("png"), size: 3 },
    { path: "index.html", sha256: sha("<html></html>"), size: 13 },
  ]);
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual([waiting, skippedLinks], [[], []]);
});

test("a render output the CLI recorded outside renders/ stays out", async () => {
  const root = await project({
    "index.html": "x",
    "exports/cut.mp4": "mp4",
    "exports/keep.txt": "keep",
    "stills/a/b.png": "png",
    ".hyperframes/render-outputs.json": JSON.stringify({
      version: 1,
      paths: ["exports/cut.mp4", "stills"],
    }),
  });
  const { manifest } = captured(await captureProject(root));
  assert.deepEqual(
    manifest.document.files.map((file) => file.path),
    ["exports/keep.txt", "index.html"],
  );
});

test("a link fails the capture, except one under assets/podcast/, which is skipped", async () => {
  const root = await project({ "index.html": "x", "outside.mov": "mov" });
  await mkdir(join(root, "assets/podcast"), { recursive: true });
  await symlink(join(root, "outside.mov"), join(root, "assets/podcast/cam.mov"));
  const skipped = captured(await captureProject(root));
  assert.deepEqual(skipped.skippedLinks, ["assets/podcast/cam.mov"]);
  await symlink(join(root, "outside.mov"), join(root, "assets/cam.mov"));
  assert.deepEqual(await captureProject(root), {
    at: "problems",
    problems: [{ path: "assets/cam.mov", problem: "symlink" }],
  });
});

test("a name no client can store fails the capture with its code", async () => {
  const root = await project({ "index.html": "x", "scenes/con.html": "x", "a?.txt": "x" });
  const capture = await captureProject(root);
  assert.equal(capture.at, "problems");
  assert.deepEqual(
    capture.at === "problems" ? capture.problems.map((p) => [p.path, p.code]).sort() : [],
    [
      ["a?.txt", "path_invalid_character"],
      ["scenes/con.html", "reserved_name"],
    ],
  );
});

test("a project without index.html cannot be captured", async () => {
  const root = await project({ "scene.html": "x" });
  assert.deepEqual(await captureProject(root), {
    at: "problems",
    problems: [{ path: "index.html", problem: "no-entrypoint" }],
  });
});

test("over a limit, the capture says which and names the biggest files before hashing any", async () => {
  const root = await project({ "index.html": "x", "big.bin": "0123456789", "mid.bin": "01234" });
  const limits = { maxFiles: 10, maxFileBytes: 6, maxProjectBytes: 100, maxManifestBytes: 10_000 };
  const capture = await captureProject(root, { limits });
  assert.equal(capture.at, "too-big");
  if (capture.at !== "too-big") return;
  assert.deepEqual(
    { limit: capture.over.limit, actual: capture.over.actual, maximum: capture.over.maximum },
    { limit: "file_size", actual: 10, maximum: 6 },
  );
  assert.deepEqual(
    capture.over.biggest.map((file) => file.path),
    ["big.bin", "mid.bin", "index.html"],
  );
});

test("a media reservation is waited on and left out, and an open agent turn is reported", async () => {
  const root = await project({
    "index.html": "x",
    ".media/images/a.hf0a1b2c.tmp": "",
    ".hyperframes/history-turn.json": "{}",
  });
  const capture = captured(await captureProject(root));
  assert.deepEqual(capture.waiting, [".media/images/a.hf0a1b2c.tmp"]);
  assert.deepEqual(capture.settled, { agentTurnOpen: true, projectLocked: false });
});

test("a project lock held by a running process is reported; a dead holder's is not", async () => {
  const root = await project({ "index.html": "x" });
  const lock = join(root, ".hyperframes/project.lock");
  await mkdir(dirname(lock), { recursive: true });
  await writeFile(lock, JSON.stringify({ pid: process.pid, startedAt: 1, command: "render" }));
  assert.equal(captured(await captureProject(root)).settled.projectLocked, true);
  await writeFile(lock, JSON.stringify({ pid: 2 ** 30, startedAt: 1, command: "render" }));
  assert.equal(captured(await captureProject(root)).settled.projectLocked, false);
});

test("a file over 4 MiB is hashed as a bounded stream, to the same digest", async () => {
  const big = "x".repeat(5 * 1024 * 1024);
  const root = await project({ "index.html": "x", "assets/big.bin": big });
  const { manifest } = captured(await captureProject(root));
  assert.deepEqual(manifest.document.files[0], {
    path: "assets/big.bin",
    sha256: sha(big),
    size: big.length,
  });
});

test("a kept hash is reused only while the file's size and time are unchanged", async () => {
  const root = await project({ "index.html": "one" });
  const memo = hashMemo();
  const first = captured(await captureProject(root, { memo }));
  await writeFile(join(root, "index.html"), "two");
  await utimes(join(root, "index.html"), new Date(2030, 0, 1), new Date(2030, 0, 1));
  const second = captured(await captureProject(root, { memo }));
  assert.equal(first.manifest.document.files[0]?.sha256, sha("one"));
  assert.equal(second.manifest.document.files[0]?.sha256, sha("two"));
});

test("a same-size edit inside the file time's granularity is hashed again, never read from a kept hash", async () => {
  const root = await project({ "index.html": "one" });
  const file = join(root, "index.html");
  const tick = new Date();
  await utimes(file, tick, tick);
  const memo = hashMemo();
  const first = captured(await captureProject(root, { memo }));
  await writeFile(file, "two");
  await utimes(file, tick, tick);
  const second = captured(await captureProject(root, { memo }));
  assert.equal(first.manifest.document.files[0]?.sha256, sha("one"));
  assert.equal(second.manifest.document.files[0]?.sha256, sha("two"));
});

test("a settled file's hash is kept, so a check after a focus reads no bytes", async () => {
  const root = await project({ "index.html": "one" });
  const memo = hashMemo();
  captured(await captureProject(root, { memo }));
  await writeFile(join(root, "index.html"), "two");
  const settled = new Date(2020, 0, 1);
  await utimes(join(root, "index.html"), settled, settled);
  captured(await captureProject(root, { memo }));
  await writeFile(join(root, "index.html"), "six");
  await utimes(join(root, "index.html"), settled, settled);
  const kept = captured(await captureProject(root, { memo }));
  assert.equal(kept.manifest.document.files[0]?.sha256, sha("two"));
});

/** A file as the walk lists it, read from disk now. @param {string} root @param {string} path */
async function listed(root, path) {
  const full = join(root, path);
  const { size, mtimeMs, ino, dev } = await lstat(full);
  return { path, full, size, mtimeMs, ino, dev };
}

test("a file swapped for a link of the same size after the walk is refused, never followed", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "hf-sync-swap-")));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "hf-sync-outside-")));
  await writeFile(join(root, "a.txt"), "inside");
  await writeFile(join(outside, "secret"), "SECRET");
  // The same size and time as the file listed: only the file's identity tells them apart.
  await utimes(join(root, "a.txt"), 1_700_000_000, 1_700_000_000);
  await utimes(join(outside, "secret"), 1_700_000_000, 1_700_000_000);
  const file = await listed(root, "a.txt");
  assert.match(String(await hashListedFile(root, file)), /^[0-9a-f]{64}$/);
  await rm(join(root, "a.txt"));
  await symlink(join(outside, "secret"), join(root, "a.txt"));
  assert.equal(await hashListedFile(root, file), null);
});

test("a folder swapped for a link to elsewhere after the walk is refused, even holding the same file", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "hf-sync-swap-")));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "hf-sync-outside-")));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "assets", "logo.txt"), "inside");
  const file = await listed(root, "assets/logo.txt");
  await rename(join(root, "assets"), join(outside, "assets"));
  await symlink(join(outside, "assets"), join(root, "assets"));
  assert.equal(await hashListedFile(root, file), null, "the moved folder's own file was followed");
});

test("a file whose folder cannot be resolved once opened is refused, and its handle is closed", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "hf-sync-close-")));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "assets", "logo.txt"), "inside");
  const file = await listed(root, "assets/logo.txt");
  const openFiles = async () => (await readdir("/dev/fd")).length;
  const before = await openFiles();
  const gone = async () => {
    throw Object.assign(new Error("ENOENT: the folder was renamed"), { code: "ENOENT" });
  };
  await assert.rejects(hashListedFile(root, file, gone), /ENOENT/);
  assert.equal(await openFiles(), before, "the opened file was left open");
});

test("explicit exclusions remove scratch files from capture and render fingerprints", async (t) => {
  const { projectFingerprint } = await import("../src/projectSnapshot.mjs");
  const root = await project({
    "index.html": "<html></html>",
    ".hyperframesignore": "# Scratch files\nout.json\nscratch/\n",
    "out.json": "private",
    "scratch/nested.txt": "private",
    "assets/data.json": "asset",
    ".env": "secret",
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = captured(await captureProject(root));
  assert.deepEqual(
    first.manifest.document.files.map((file) => file.path),
    [".hyperframesignore", "assets/data.json", "index.html"],
  );
  const before = await projectFingerprint(root);
  await rm(join(root, "out.json"));
  await writeFile(join(root, "scratch/nested.txt"), "changed");
  assert.equal(await projectFingerprint(root), before);
  assert.deepEqual(captured(await captureProject(root)).manifest, first.manifest);
  await writeFile(join(root, "assets/data.json"), "changed asset");
  assert.notEqual(await projectFingerprint(root), before);
});

test("ignore rules fail closed for unsupported patterns, entrypoint exclusions, and symlinks", async (t) => {
  const root = await project({ "index.html": "<html></html>" });
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const rule of ["index.html", "../secret", "*.json", "!out.json"]) {
    await writeFile(join(root, ".hyperframesignore"), rule);
    await assert.rejects(captureProject(root), /literal project-relative/);
  }
  await rm(join(root, ".hyperframesignore"));
  await symlink(join(root, "index.html"), join(root, ".hyperframesignore"));
  await assert.rejects(captureProject(root), /regular file/);
});

test("ignore configuration rejects oversized files, directories and dangling symlinks", async (t) => {
  const root = await project({ "index.html": "<html></html>" });
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, ".hyperframesignore");
  await writeFile(file, "a".repeat(65536));
  await assert.rejects(captureProject(root), /regular file/);
  await rm(file);
  await mkdir(file);
  await assert.rejects(captureProject(root), /regular file/);
  await rm(file, { recursive: true });
  await symlink(join(root, "missing"), file);
  await assert.rejects(captureProject(root), /regular file/);
});
