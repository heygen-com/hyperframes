// fallow-ignore-file code-duplication
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { applyFileMutations } from "./applyFileMutations.js";
import { fileContentVersion } from "./fileVersion.js";

describe("applyFileMutations", () => {
  it("refuses a file whose version changed since the caller read it", () => {
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
            after: "after",
            expectedVersion,
          },
        ]),
      ).toThrow("file changed since the timeline was read");
      expect(readFileSync(path, "utf8")).toBe("external");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("refuses a stale no-op instead of silently accepting it", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-mutation-noop-version-"));
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
            after: "before",
            expectedVersion,
          },
        ]),
      ).toThrow("file changed since the timeline was read");
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
