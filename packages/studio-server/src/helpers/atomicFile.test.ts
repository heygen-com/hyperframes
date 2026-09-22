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

    expect(events).toEqual([`write:${file}.tmp`, `rename:${file}.tmp:${file}`]);
    expect(readFileSync(file, "utf-8")).toBe("new complete html");
    expect(fs.statSync(file).mode & 0o777).toBe(0o640);
  });
});
