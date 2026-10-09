import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { applyFileMutations, FileChangedError } from "./applyFileMutations.js";
import { fileContentVersion, identifyFileWrite, resetFileWriteReceipts } from "./fileVersion.js";

function expectStaleMutation(after: string, pinVersion = true): void {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-mutation-version-"));
  const path = join(projectDir, "index.html");
  try {
    writeFileSync(path, "before", "utf8");
    const expectedVersion = fileContentVersion(readFileSync(path, "utf8"));
    writeFileSync(path, "external", "utf8");
    expect(() =>
      applyFileMutations(projectDir, [
        {
          sourceFile: "index.html",
          absPath: path,
          before: "before",
          after,
          ...(pinVersion ? { expectedVersion } : {}),
        },
      ]),
    ).toThrow(FileChangedError);
    expect(readFileSync(path, "utf8")).toBe("external");
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

describe("applyFileMutations", () => {
  it("refuses a file whose version changed since the caller read it", () => {
    expectStaleMutation("after");
  });

  it("refuses a stale no-op instead of silently accepting it", () => {
    expectStaleMutation("before");
  });

  it("keeps a save to an earlier file when a later file's conflict rolls the batch back", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-mutation-version-"));
    const first = join(projectDir, "first.html");
    const second = join(projectDir, "second.html");
    try {
      writeFileSync(first, "first-before", "utf8");
      writeFileSync(second, "second-before", "utf8");
      const writeFile = (path: string, content: string, encoding: "utf-8") => {
        writeFileSync(path, content, encoding);
        if (path !== first || content !== "first-after") return;
        writeFileSync(first, "first-saved", "utf8");
        writeFileSync(second, "second-saved", "utf8");
      };
      expect(() =>
        applyFileMutations(
          projectDir,
          ["first", "second"].map((name) => ({
            sourceFile: `${name}.html`,
            absPath: join(projectDir, `${name}.html`),
            before: `${name}-before`,
            after: `${name}-after`,
            expectedVersion: fileContentVersion(`${name}-before`),
          })),
          undefined,
          writeFile,
        ),
      ).toThrow("file changed since the timeline was read");
      expect(readFileSync(first, "utf8")).toBe("first-saved");
      expect(readFileSync(second, "utf8")).toBe("second-saved");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("writes nothing when a later file is already stale", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-mutation-version-"));
    try {
      for (const name of ["first", "second"])
        writeFileSync(join(projectDir, `${name}.html`), `${name}-before`, "utf8");
      writeFileSync(join(projectDir, "second.html"), "second-saved", "utf8");
      let writes = 0;
      expect(() =>
        applyFileMutations(
          projectDir,
          ["first", "second"].map((name) => ({
            sourceFile: `${name}.html`,
            absPath: join(projectDir, `${name}.html`),
            before: `${name}-before`,
            after: `${name}-after`,
            expectedVersion: fileContentVersion(`${name}-before`),
          })),
          undefined,
          () => {
            writes += 1;
          },
        ),
      ).toThrow("file changed since the timeline was read");
      expect(writes).toBe(0);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("refuses a file that changed since the caller read it, without an expected version", () => {
    expectStaleMutation("after", false);
  });

  it("leaves a receipt saying which bytes the write started from", () => {
    resetFileWriteReceipts();
    const projectDir = mkdtempSync(join(tmpdir(), "hf-mutation-from-"));
    const path = join(projectDir, "index.html");
    try {
      // Someone else's change lands before the patch reads the file: the receipt names it as the start.
      writeFileSync(path, "external", "utf8");
      applyFileMutations(
        projectDir,
        [{ sourceFile: "index.html", absPath: path, after: "patched" }],
        "hand",
      );
      expect(identifyFileWrite(path, fileContentVersion("patched"))).toMatchObject({
        writeToken: "hand",
        from: fileContentVersion("external"),
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("clears receipts for writes rolled back after a partial batch", () => {
    resetFileWriteReceipts();
    const projectDir = mkdtempSync(join(tmpdir(), "hf-mutation-rollback-"));
    const first = join(projectDir, "first.html");
    const second = join(projectDir, "second.html");
    try {
      writeFileSync(first, "first-before", "utf8");
      writeFileSync(second, "second-before", "utf8");
      let writes = 0;
      expect(() =>
        applyFileMutations(
          projectDir,
          [
            {
              sourceFile: "first.html",
              absPath: first,
              before: "first-before",
              after: "first-after",
            },
            {
              sourceFile: "second.html",
              absPath: second,
              before: "second-before",
              after: "second-after",
            },
          ],
          undefined,
          (path, content, encoding) => {
            writes += 1;
            if (writes === 2) {
              writeFileSync(path, "second-partial", encoding);
              throw new Error("second write failed");
            }
            writeFileSync(path, content, encoding);
          },
        ),
      ).toThrow("second write failed");
      expect(readFileSync(first, "utf8")).toBe("first-before");
      expect(readFileSync(second, "utf8")).toBe("second-before");
      expect(identifyFileWrite(first, fileContentVersion("first-after"))).toBeNull();
    } finally {
      resetFileWriteReceipts();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports the write error, not a failed rollback, when a later file was never written",
    () => {
      resetFileWriteReceipts();
      const projectDir = mkdtempSync(join(tmpdir(), "hf-mutation-readonly-"));
      const first = join(projectDir, "first.html");
      const lockedDir = join(projectDir, "locked");
      const second = join(lockedDir, "second.html");
      try {
        mkdirSync(lockedDir);
        writeFileSync(first, "first-before", "utf8");
        writeFileSync(second, "second-before", "utf8");
        chmodSync(lockedDir, 0o555);
        let thrown: unknown;
        try {
          applyFileMutations(projectDir, [
            { sourceFile: "first.html", absPath: first, after: "first-after" },
            { sourceFile: "locked/second.html", absPath: second, after: "second-after" },
          ]);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).not.toBeInstanceOf(AggregateError);
        expect(thrown).toMatchObject({ code: "EACCES" });
        expect(readFileSync(first, "utf8")).toBe("first-before");
        expect(readFileSync(second, "utf8")).toBe("second-before");
        expect(identifyFileWrite(first, fileContentVersion("first-after"))).toBeNull();
      } finally {
        chmodSync(lockedDir, 0o755);
        resetFileWriteReceipts();
        rmSync(projectDir, { recursive: true, force: true });
      }
    },
  );

  it("still reports an incomplete rollback when a written file cannot be restored", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-mutation-restore-"));
    try {
      for (const name of ["first", "second"])
        writeFileSync(join(projectDir, `${name}.html`), `${name}-before`, "utf8");
      let writes = 0;
      expect(() =>
        applyFileMutations(
          projectDir,
          ["first", "second"].map((name) => ({
            sourceFile: `${name}.html`,
            absPath: join(projectDir, `${name}.html`),
            after: `${name}-after`,
          })),
          undefined,
          (path, content, encoding) => {
            writes += 1;
            if (writes === 2) throw new Error("second write failed");
            if (writes === 3) throw new Error("first restore failed");
            writeFileSync(path, content, encoding);
          },
        ),
      ).toThrow("File mutation failed and rollback did not complete");
      expect(readFileSync(join(projectDir, "first.html"), "utf8")).toBe("first-after");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
