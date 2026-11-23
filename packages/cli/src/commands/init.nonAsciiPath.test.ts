import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import init from "./init.js";

vi.mock("../telemetry/events.js", () => ({ trackInitTemplate: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// Node 22's native directory copy wrote nothing to such a path on Windows, without an error.
it("scaffolds the template into a folder with a Cyrillic name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-init-cyrillic-"));
  const project = join(dir, "Проект");
  vi.stubEnv("HYPERFRAMES_SKIP_SKILLS", "1");
  vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runCommand(init, { rawArgs: [project, "--example", "blank", "--non-interactive"] });
    expect(existsSync(join(project, "index.html"))).toBe(true);
    expect(existsSync(join(project, "hyperframes.json"))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
