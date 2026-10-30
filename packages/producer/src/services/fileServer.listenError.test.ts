import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileServer } from "./fileServer.js";

describe("createFileServer when the port is taken", () => {
  it("rejects instead of never settling", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-file-server-taken-"));
    try {
      writeFileSync(join(projectDir, "index.html"), "<!DOCTYPE html><html><body></body></html>");
      const options = { projectDir, preHeadScripts: [], headScripts: [] };
      const first = await createFileServer(options);
      try {
        await expect(createFileServer({ ...options, port: first.port })).rejects.toThrow(
          /EADDRINUSE/,
        );
      } finally {
        first.close();
      }
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
