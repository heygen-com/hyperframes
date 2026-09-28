import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CliRuntimeError } from "../utils/commandResult.js";
import projectsCommand from "./projects.js";

describe("hyperframes projects", () => {
  it("refuses a root it cannot read instead of reporting no projects", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const run = projectsCommand.run!({ args: { json: true, root: "/no/such/folder" } } as never);

    await expect(run).rejects.toBeInstanceOf(CliRuntimeError);
    expect(log).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "refuses a folder it is not allowed to read",
    async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const root = mkdtempSync(join(tmpdir(), "hf-projects-locked-"));
      chmodSync(root, 0o000);
      onTestFinished(() => {
        chmodSync(root, 0o755);
        rmSync(root, { recursive: true, force: true });
      });

      const run = projectsCommand.run!({ args: { json: true, root } } as never);

      await expect(run).rejects.toBeInstanceOf(CliRuntimeError);
    },
  );
});
