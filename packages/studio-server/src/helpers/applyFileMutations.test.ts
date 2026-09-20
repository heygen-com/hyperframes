import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { applyFileMutations } from "./applyFileMutations.js";
import { fileContentVersion, identifyFileWrite, resetFileWriteReceipts } from "./fileVersion.js";

function expectStaleMutation(after: string): void {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-mutation-version-"));
  const path = join(projectDir, "index.html");
  try {
    writeFileSync(path, "before", "utf8");
    const expectedVersion = fileContentVersion(readFileSync(path, "utf8"));
    writeFileSync(path, "external", "utf8");
    expect(() =>
      applyFileMutations(projectDir, [
        { sourceFile: "index.html", absPath: path, before: "before", after, expectedVersion },
      ]),
    ).toThrow("file changed since the timeline was read");
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
            if (writes === 2) throw new Error("second write failed");
            writeFileSync(path, content, encoding);
          },
        ),
      ).toThrow("second write failed");
      expect(readFileSync(first, "utf8")).toBe("first-before");
      expect(identifyFileWrite(first, fileContentVersion("first-after"))).toBeNull();
    } finally {
      resetFileWriteReceipts();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
