import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEnvOrGitPath, isPrivateCompositionFile } from "./privateProjectFile.js";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("isEnvOrGitPath", () => {
  it("names env files and Git folders, whatever the letter case", () => {
    expect(isEnvOrGitPath("/home/me/.env")).toBe(true);
    expect(isEnvOrGitPath("a\\.Env.Local")).toBe(true);
    expect(isEnvOrGitPath("repo/.git/config")).toBe(true);
    expect(isEnvOrGitPath(".envrc")).toBe(true);
    expect(isEnvOrGitPath("sub/.env-local")).toBe(true);
    expect(isEnvOrGitPath(".env_prod")).toBe(true);
    expect(isEnvOrGitPath(".environment.json")).toBe(false);
    expect(isEnvOrGitPath("assets/environment.png")).toBe(false);
    expect(isEnvOrGitPath("dotfiles.git/logo.png")).toBe(false);
  });
});

describe("isPrivateCompositionFile", () => {
  it("covers env files, Git data and tool records, not composition assets", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-private-file-"));
    const at = (path: string) => isPrivateCompositionFile(dir!, join(dir!, path));

    expect(at(".env")).toBe(true);
    expect(at(".env.production")).toBe(true);
    expect(at("sub/.env")).toBe(true);
    expect(at(".git/HEAD")).toBe(true);
    expect(at(".hyperframes/history-turn.json")).toBe(true);
    expect(at(".hyperframes/prepared-assets/gif/a.webm")).toBe(false);
    expect(at(".media/clip.mp4")).toBe(false);
    expect(at("environment.png")).toBe(false);
    expect(at("index.html")).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "follows a link inside the project to an env file",
    () => {
      dir = mkdtempSync(join(tmpdir(), "hf-private-file-"));
      writeFileSync(join(dir, ".env"), "KEY=secret");
      mkdirSync(join(dir, "assets"));
      symlinkSync(join(dir, ".env"), join(dir, "assets", "logo.png"));

      expect(isPrivateCompositionFile(dir, join(dir, "assets", "logo.png"))).toBe(true);
    },
  );
});
