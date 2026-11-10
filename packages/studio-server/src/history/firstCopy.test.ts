// @vitest-environment node
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

import * as fsp from "node:fs/promises";
import { blobPath } from "./blobStore.js";
import { START } from "./historyLog.js";
import { openProjectHistory } from "./projectHistory.js";

const { writeFile: realWriteFile } =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const temps: string[] = [];
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
const closes: (() => Promise<void>)[] = [];

afterEach(async () => {
  vi.mocked(fsp.writeFile).mockImplementation(realWriteFile);
  for (const close of closes.splice(0)) await close();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectOf(count: number, tag: string): string {
  const dir = tempDir("hf-first-copy-");
  mkdirSync(join(dir, "parts"));
  writeFileSync(join(dir, "index.html"), `<html>${tag}</html>`);
  for (let i = 0; i < count; i++) writeFileSync(join(dir, "parts", `p${i}.js`), `// ${tag} ${i}\n`);
  return dir;
}
const homeIn = (historyRoot: string) => {
  const homes = readdirSync(historyRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  return join(historyRoot, homes.find((e) => existsSync(join(historyRoot, e.name, "blobs")))!.name);
};
async function open(projectDir: string, historyRoot: string) {
  const history = await openProjectHistory({ projectDir, historyRoot });
  closes.push(() => history.close());
  return history;
}
/** Every file of the project is in the baseline, and its blob holds exactly the file's bytes. */
function expectAllKept(
  baseline: Record<string, string> | null,
  projectDir: string,
  blobs: string,
  paths: string[],
) {
  expect(Object.keys(baseline ?? {}).sort()).toEqual([...paths].sort());
  for (const path of paths) {
    const bytes = readFileSync(join(projectDir, path));
    expect(baseline![path]).toBe(sha256(bytes));
    expect(readFileSync(blobPath(blobs, sha256(bytes))).equals(bytes)).toBe(true);
  }
}
const pathsOf = (count: number) => [
  "index.html",
  ...Array.from({ length: count }, (_, i) => `parts/p${i}.js`),
];

describe("a project's first history copy", () => {
  it("loses nothing when the process dies midway: the next open finishes it", async () => {
    const projectDir = projectOf(120, "dies");
    const historyRoot = tempDir("hf-first-copy-root-");
    const before = readFileSync(join(projectDir, "parts", "p7.js"));
    const died = await new Promise<NodeJS.Signals | number | null>((done) => {
      const fixture = join(import.meta.dirname, "__fixtures__", "dieMidFirstCopy.ts");
      fork(fixture, [projectDir, historyRoot, "40"], { execArgv: ["--import", "tsx"] }).once(
        "exit",
        (code, signal) => done(signal ?? code),
      );
    });
    expect(died).toBe("SIGKILL");
    const home = homeIn(historyRoot);
    expect(existsSync(join(home, "log.jsonl")), "the copy finished before the death").toBe(false);
    const leftovers = () =>
      readdirSync(join(home, "blobs")).filter((name) => name.startsWith("incoming-"));
    expect(leftovers().length, "the death left no half-written copy").toBeGreaterThan(0);

    const history = await open(projectDir, historyRoot);

    expectAllKept(history.peek(START), projectDir, join(home, "blobs"), pathsOf(120));
    expect(leftovers()).toEqual([]);
    for (const shard of readdirSync(join(home, "blobs")))
      for (const hash of readdirSync(join(home, "blobs", shard)))
        expect(sha256(readFileSync(join(home, "blobs", shard, hash)))).toBe(hash);
    expect(readFileSync(join(projectDir, "parts", "p7.js")).equals(before)).toBe(true);
  });

  it("keeps the same contents and permissions, small files and large, under a strict umask", async () => {
    const umask = process.umask(0o077);
    onTestFinished(() => void process.umask(umask));
    const projectDir = projectOf(3, "kept");
    writeFileSync(join(projectDir, "large.js"), "x".repeat(200 * 1024));
    writeFileSync(join(projectDir, "same-a.js"), "same bytes");
    writeFileSync(join(projectDir, "same-b.js"), "same bytes");
    writeFileSync(join(projectDir, "run.sh"), "#!/bin/sh\n");
    chmodSync(join(projectDir, "run.sh"), 0o755);
    const historyRoot = tempDir("hf-first-copy-root-");

    const history = await open(projectDir, historyRoot);

    const blobs = join(homeIn(historyRoot), "blobs");
    const paths = [...pathsOf(3), "large.js", "same-a.js", "same-b.js", "run.sh"];
    expectAllKept(history.peek(START), projectDir, blobs, paths);
    const script = readFileSync(join(projectDir, "run.sh"));
    expect(statSync(blobPath(blobs, sha256(script))).mode & 0o111).toBe(
      statSync(join(projectDir, "run.sh")).mode & 0o111,
    );
  });

  it("copies a few files at a time across every project opening together", async () => {
    let writing = 0;
    let most = 0;
    vi.mocked(fsp.writeFile).mockImplementation(async (...args) => {
      const counted = String(args[0]).includes("incoming-");
      if (counted) most = Math.max(most, ++writing);
      await realWriteFile(...args);
      if (counted) writing -= 1;
    });
    const historyRoot = tempDir("hf-first-copy-root-");

    await Promise.all(["a", "b", "c"].map((tag) => open(projectOf(30, tag), historyRoot)));

    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(4);
  });
});
