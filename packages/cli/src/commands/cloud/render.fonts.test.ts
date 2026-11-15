import { runCommand } from "citty";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../cloud/fontPreflight.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../cloud/fontPreflight.js")>()),
  embedSystemFonts: vi.fn(async () => ["PingFang SC"]),
}));

import render from "./render.js";
import { errorBox } from "../../ui/format.js";
import { consumeCommandResult } from "../../utils/commandResult.js";

vi.mock("../../ui/format.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ui/format.js")>()),
  errorBox: vi.fn(),
}));

let project: string;
const fetchSpy = vi.fn();

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "hf-cloud-fonts-"));
  writeFileSync(
    join(project, "index.html"),
    `<!doctype html><html><body><div data-composition-id="main" data-width="1920" data-height="1080" data-duration="1"></div></body></html>`,
  );
  vi.stubEnv("HEYGEN_API_KEY", "fixture-key");
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchSpy.mockClear();
  consumeCommandResult();
});

describe("cloud render font preflight", () => {
  it("does not stop for a font that is not on this computer: the dry run names it and carries on", async () => {
    const lines: string[] = [];
    const log = vi
      .spyOn(console, "log")
      .mockImplementation((line) => void lines.push(String(line)));
    await runCommand(render, { rawArgs: [project, "--dry-run", "--json"] });
    log.mockRestore();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorBox).not.toHaveBeenCalled();
    expect(JSON.parse(lines.join("")).archive.swapped_fonts).toEqual(["PingFang SC"]);
  });
});
