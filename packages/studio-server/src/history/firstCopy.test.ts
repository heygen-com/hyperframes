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
  appendFileSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile), open: vi.fn(actual.open) };
});

import * as fsp from "node:fs/promises";
import { blobPath } from "./blobStore.js";
import { START } from "./historyLog.js";
import { openProjectHistory } from "./projectHistory.js";

const { writeFile: realWriteFile, open: realOpen } =
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
  vi.mocked(fsp.open).mockImplementation(realOpen);
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

  // fails without the fix: a file whose read never answered held the first copy, so the project never opened.
  it("leaves a file whose read never answers owed past its deadline, and the open finishes", async () => {
    const projectDir = projectOf(6, "stuck");
    const stuck = join(projectDir, "parts", "p1.js");
    const releases: (() => void)[] = [];
    let stuckReads = 0;
    vi.mocked(fsp.open).mockImplementation(async (...args: Parameters<typeof realOpen>) => {
      if (String(args[0]) === stuck) {
        stuckReads += 1;
        await new Promise<void>((answer) => releases.push(answer));
      }
      return realOpen(...args);
    });
    const historyRoot = tempDir("hf-first-copy-root-");
    try {
      const history = await openProjectHistory({ projectDir, historyRoot, firstCopyFileMs: 100 });
      closes.push(() => history.close());
      expect(stuckReads).toBe(1);
      const owed = JSON.parse(readFileSync(join(homeIn(historyRoot), "adopting.json"), "utf8"));
      expect(owed).toContain("parts/p1.js");
    } finally {
      for (const answer of releases) answer();
    }
  });

  it("keeps a first copy that lands past its deadline as the file's start, and an edit since as a change", async () => {
    const projectDir = projectOf(4, "late");
    const late = join(projectDir, "parts", "p1.js");
    const original = readFileSync(late);
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let heldWrites = 0;
    vi.mocked(fsp.writeFile).mockImplementation(
      async (...args: Parameters<typeof realWriteFile>) => {
        const [path, bytes] = args;
        if (
          String(path).includes("incoming-") &&
          Buffer.isBuffer(bytes) &&
          bytes.equals(original)
        ) {
          heldWrites += 1;
          await held;
        }
        return realWriteFile(...args);
      },
    );
    const historyRoot = tempDir("hf-first-copy-root-");
    const history = await openProjectHistory({
      projectDir,
      historyRoot,
      firstCopyFileMs: 50,
      quietMs: 30,
    });
    closes.push(() => history.close());
    expect(heldWrites).toBe(1);
    // An editor saves the file after the open, while its first copy is still being written.
    writeFileSync(late, "// saved after the open\n");
    release();
    await vi.waitFor(() => expect(history.peek(START)).toHaveProperty(["parts/p1.js"]), {
      timeout: 10_000,
    });
    expect(history.peek(START)!["parts/p1.js"]).toBe(sha256(original));
    await vi.waitFor(
      () =>
        expect(history.list().flatMap((entry) => entry.files.map((file) => file.path))).toContain(
          "parts/p1.js",
        ),
      { timeout: 10_000 },
    );
  });

  it("keeps a late first copy through a prune while another file's read is still stalled", async () => {
    const projectDir = projectOf(4, "late-two");
    const stalled = join(projectDir, "parts", "p0.js");
    const late = join(projectDir, "parts", "p2.js");
    const original = readFileSync(late);
    const edited = Buffer.from("<html>edited</html>");
    const saved = Buffer.from("// saved after the open\n");
    const stalls: (() => void)[] = [];
    vi.mocked(fsp.open).mockImplementation(async (...args: Parameters<typeof realOpen>) => {
      if (String(args[0]) === stalled) await new Promise<void>((answer) => stalls.push(answer));
      return realOpen(...args);
    });
    const holds = new Map<Buffer, { held: number; release: () => void; gate: Promise<void> }>();
    for (const bytes of [original, edited, saved]) {
      let release = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      holds.set(bytes, { held: 0, release, gate });
    }
    vi.mocked(fsp.writeFile).mockImplementation(
      async (...args: Parameters<typeof realWriteFile>) => {
        const [path, bytes] = args;
        const hold = [...holds].find(
          ([held]) =>
            String(path).includes("incoming-") && Buffer.isBuffer(bytes) && bytes.equals(held),
        )?.[1];
        if (hold) {
          hold.held += 1;
          await hold.gate;
        }
        return realWriteFile(...args);
      },
    );
    const historyRoot = tempDir("hf-first-copy-root-");
    try {
      const history = await openProjectHistory({
        projectDir,
        historyRoot,
        firstCopyFileMs: 50,
        quietMs: 30,
        budgetBytes: 1,
      });
      closes.push(() => history.close());
      // A sweep holds the history's queue while it stores the edited index; the late copy lands meanwhile.
      writeFileSync(join(projectDir, "index.html"), edited);
      const sweep = history.checkpoint();
      await vi.waitFor(() => expect(holds.get(edited)!.held).toBe(1));
      writeFileSync(late, saved);
      holds.get(original)!.release();
      const home = homeIn(historyRoot);
      await vi.waitFor(() =>
        expect(existsSync(blobPath(join(home, "blobs"), sha256(original)))).toBe(true),
      );
      const claimed = history.claim({ kind: "person", name: "You" }, "Typed", ["parts/p2.js"]);
      // The sweep's record prunes everything past the 1-byte budget that history does not still need.
      holds.get(edited)!.release();
      await sweep;
      // Read START before the sweep that takes in the edit: a 1-byte budget folds that change into START.
      await vi.waitFor(() => expect(history.peek(START)).toHaveProperty(["parts/p2.js"]), {
        timeout: 10_000,
      });
      expect(history.peek(START)!["parts/p2.js"]).toBe(sha256(original));
      expect(stalls).toHaveLength(1);
      holds.get(saved)!.release();
      await claimed;
    } finally {
      for (const answer of stalls) answer();
    }
  });

  it("keeps an in-budget edit while a late first copy waits to be adopted", async () => {
    const projectDir = projectOf(2, "budget");
    const late = join(projectDir, "parts", "p1.js");
    writeFileSync(late, "x".repeat(768));
    const original = readFileSync(late);
    const edited = Buffer.from("<html>budget edited</html>");
    const holds = new Map<Buffer, { held: number; release: () => void; gate: Promise<void> }>();
    for (const bytes of [original, edited]) {
      let release = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      holds.set(bytes, { held: 0, release, gate });
    }
    vi.mocked(fsp.writeFile).mockImplementation(
      async (...args: Parameters<typeof realWriteFile>) => {
        const [path, bytes] = args;
        const hold = [...holds].find(
          ([held]) =>
            String(path).includes("incoming-") && Buffer.isBuffer(bytes) && bytes.equals(held),
        )?.[1];
        if (hold) {
          hold.held += 1;
          await hold.gate;
        }
        return realWriteFile(...args);
      },
    );
    const historyRoot = tempDir("hf-first-copy-root-");
    const history = await openProjectHistory({
      projectDir,
      historyRoot,
      firstCopyFileMs: 50,
      quietMs: 30,
      budgetBytes: 128,
    });
    closes.push(() => history.close());
    writeFileSync(join(projectDir, "index.html"), edited);
    const sweep = history.checkpoint();
    await vi.waitFor(() => expect(holds.get(edited)!.held).toBe(1));
    holds.get(original)!.release();
    const blobs = join(homeIn(historyRoot), "blobs");
    await vi.waitFor(() => expect(existsSync(blobPath(blobs, sha256(original)))).toBe(true));
    holds.get(edited)!.release();
    await sweep;
    await vi.waitFor(() => expect(history.peek(START)).toHaveProperty(["parts/p1.js"]), {
      timeout: 10_000,
    });
    expect(history.list().flatMap((entry) => entry.files.map((file) => file.path))).toContain(
      "index.html",
    );
  });

  // Each of the first `changing` reads of a file sees it change under it; every read after that is a fresh one.
  async function freshReadsAtOnce(changing: number) {
    const projectDir = projectOf(12, "fan");
    const parts = join(projectDir, "parts") + sep;
    const opens = new Map<string, number>();
    let waiting = 0;
    let most = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(fsp.open).mockImplementation(async (...args: Parameters<typeof realOpen>) => {
      const path = String(args[0]);
      if (!path.startsWith(parts)) return realOpen(...args);
      const count = (opens.get(path) ?? 0) + 1;
      opens.set(path, count);
      if (count > changing) {
        most = Math.max(most, ++waiting);
        await gate;
        waiting -= 1;
        return realOpen(...args);
      }
      const handle = await realOpen(...args);
      const readFile = handle.readFile.bind(handle);
      handle.readFile = (async (...options: Parameters<typeof readFile>) => {
        const bytes = await readFile(...options);
        appendFileSync(path, "// saved while read\n");
        return bytes;
      }) as typeof handle.readFile;
      return handle;
    });
    try {
      const history = await open(projectDir, tempDir("hf-first-copy-root-"));
      await vi.waitFor(() => expect(waiting).toBe(4), { timeout: 10_000 });
      release();
      await vi.waitFor(
        () =>
          expect(
            Object.keys(history.peek(START) ?? {}).filter((path) => path.startsWith("parts/")),
          ).toHaveLength(12),
        { timeout: 20_000 },
      );
      return most;
    } finally {
      release();
    }
  }

  it("reads files whose first copy kept changing a few at a time", async () => {
    expect(await freshReadsAtOnce(3)).toBe(4);
  });

  it("keeps later rereads of those files a few at a time too", async () => {
    expect(await freshReadsAtOnce(6)).toBe(4);
  }, 30_000);

  it("keeps a reread copy from pruning while it waits to be adopted", async () => {
    const projectDir = projectOf(2, "reread");
    const late = join(projectDir, "parts", "p1.js");
    const edited = Buffer.from("<html>reread edited</html>");
    const saved = Buffer.from("// saved after the reread\n");
    let reads = 0;
    let letReread = () => {};
    const rereadGate = new Promise<void>((resolve) => (letReread = resolve));
    vi.mocked(fsp.open).mockImplementation(async (...args: Parameters<typeof realOpen>) => {
      const path = String(args[0]);
      if (path === late && ++reads === 4) await rereadGate;
      const handle = await realOpen(...args);
      if (path !== late || reads > 3) return handle;
      const readFile = handle.readFile.bind(handle);
      handle.readFile = (async (...options: Parameters<typeof readFile>) => {
        const bytes = await readFile(...options);
        appendFileSync(path, "// saved while read\n");
        return bytes;
      }) as typeof handle.readFile;
      return handle;
    });
    const holds = new Map<Buffer, { held: number; release: () => void; gate: Promise<void> }>();
    for (const bytes of [edited, saved]) {
      let release = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      holds.set(bytes, { held: 0, release, gate });
    }
    vi.mocked(fsp.writeFile).mockImplementation(
      async (...args: Parameters<typeof realWriteFile>) => {
        const [path, bytes] = args;
        const hold = [...holds].find(
          ([held]) =>
            String(path).includes("incoming-") && Buffer.isBuffer(bytes) && bytes.equals(held),
        )?.[1];
        if (hold) {
          hold.held += 1;
          await hold.gate;
        }
        return realWriteFile(...args);
      },
    );
    const historyRoot = tempDir("hf-first-copy-root-");
    try {
      const history = await openProjectHistory({
        projectDir,
        historyRoot,
        quietMs: 30,
        budgetBytes: 1,
      });
      closes.push(() => history.close());
      // A sweep holds the history's queue while it stores the edited index; the reread lands meanwhile.
      writeFileSync(join(projectDir, "index.html"), edited);
      const sweep = history.checkpoint();
      await vi.waitFor(() => expect(holds.get(edited)!.held).toBe(1));
      const reread = readFileSync(late);
      letReread();
      const blobs = join(homeIn(historyRoot), "blobs");
      await vi.waitFor(() => expect(existsSync(blobPath(blobs, sha256(reread)))).toBe(true), {
        timeout: 10_000,
      });
      writeFileSync(late, saved);
      holds.get(edited)!.release();
      await sweep;
      // Read START before the sweep that takes in the edit: a 1-byte budget folds that change into START.
      await vi.waitFor(() => expect(history.peek(START)).toHaveProperty(["parts/p1.js"]), {
        timeout: 10_000,
      });
      expect(history.peek(START)!["parts/p1.js"]).toBe(sha256(reread));
    } finally {
      letReread();
      for (const { release } of holds.values()) release();
    }
  });

  it("adopts a file that grew past the copy limit before its reread, by reference", async () => {
    const projectDir = projectOf(2, "grew");
    const grows = join(projectDir, "parts", "p1.js");
    let reads = 0;
    vi.mocked(fsp.open).mockImplementation(async (...args: Parameters<typeof realOpen>) => {
      const handle = await realOpen(...args);
      if (String(args[0]) !== grows || ++reads > 3) return handle;
      const readFile = handle.readFile.bind(handle);
      handle.readFile = (async (...options: Parameters<typeof readFile>) => {
        const bytes = await readFile(...options);
        if (reads < 3) appendFileSync(grows, "// saved while read\n");
        else truncateSync(grows, 65 * 1024 ** 2);
        return bytes;
      }) as typeof handle.readFile;
      return handle;
    });
    const history = await open(projectDir, tempDir("hf-first-copy-root-"));
    await vi.waitFor(() => expect(history.peek(START)).toHaveProperty(["parts/p1.js"]), {
      timeout: 10_000,
    });
  });
});
