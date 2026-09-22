import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceFileAtomically } from "./atomicFile.js";

describe("replaceFileAtomically", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("writes the sibling completely before replacing the project file", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-file-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, "old", { mode: 0o640 });
    const events: string[] = [];
    const operations = {
      writeFileSync: (path: fs.PathLike, ...args: any[]) => {
        events.push(`write:${String(path)}`);
        return fs.writeFileSync(path, ...args);
      },
      chmodSync: fs.chmodSync,
      renameSync: (from: fs.PathLike, to: fs.PathLike) => {
        events.push(`rename:${String(from)}:${String(to)}`);
        expect(readFileSync(from, "utf-8")).toBe("new complete html");
        return fs.renameSync(from, to);
      },
      unlinkSync: fs.unlinkSync,
    };

    replaceFileAtomically(file, "new complete html", 0o640, operations);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatch(new RegExp(`^write:${file}\\.\\d+\\.[0-9a-f-]+\\.tmp$`));
    const tempPath = events[0]!.slice("write:".length);
    expect(events[1]).toBe(`rename:${tempPath}:${file}`);
    expect(readFileSync(file, "utf-8")).toBe("new complete html");
    expect(fs.statSync(file).mode & 0o777).toBe(0o640);
  });

  it("allocates a distinct temporary sibling for each writer", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-file-unique-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, "old");
    const tempPaths: string[] = [];
    const operations = {
      writeFileSync: (path: fs.PathLike, ...args: any[]) => {
        tempPaths.push(String(path));
        return fs.writeFileSync(path, ...args);
      },
      chmodSync: fs.chmodSync,
      renameSync: fs.renameSync,
      unlinkSync: fs.unlinkSync,
    };

    replaceFileAtomically(file, "first", 0o640, operations);
    replaceFileAtomically(file, "second", 0o640, operations);

    expect(tempPaths).toHaveLength(2);
    expect(tempPaths[0]).not.toBe(tempPaths[1]);
  });

  it("uses a unique temporary sibling and removes it when publication fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "atomic-file-failure-test-"));
    dirs.push(dir);
    const file = join(dir, "index.html");
    writeFileSync(file, "old");
    const tempPaths: string[] = [];
    const removed: string[] = [];
    const operations = {
      writeFileSync: (path: fs.PathLike, ...args: any[]) => {
        tempPaths.push(String(path));
        return fs.writeFileSync(path, ...args);
      },
      chmodSync: fs.chmodSync,
      renameSync: () => {
        throw new Error("publish failed");
      },
      unlinkSync: (path: fs.PathLike) => {
        removed.push(String(path));
        return fs.unlinkSync(path);
      },
    };

    expect(() => replaceFileAtomically(file, "new", 0o640, operations)).toThrow("publish failed");
    expect(tempPaths).toHaveLength(1);
    expect(tempPaths[0]).toMatch(new RegExp(`^${file}\\.\\d+\\.[0-9a-f-]+\\.tmp$`));
    expect(removed).toEqual(tempPaths);
  });
});
