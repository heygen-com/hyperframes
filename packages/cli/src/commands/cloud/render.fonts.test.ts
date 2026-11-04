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
import { CliRuntimeError, consumeCommandResult } from "../../utils/commandResult.js";

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
  it("stops before any upload and names the font that is not on this computer", async () => {
    await expect(runCommand(render, { rawArgs: [project, "--no-wait", "--json"] })).rejects.toThrow(
      CliRuntimeError,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorBox).toHaveBeenCalledWith(
      "Fonts not on this computer",
      expect.stringContaining(
        "HyperFrames couldn't find a font file for PingFang SC on this computer, so the cloud can't have it: use Noto Sans SC",
      ),
    );
  });
});
