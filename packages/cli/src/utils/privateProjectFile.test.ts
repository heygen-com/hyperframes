import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEnvOrGitPath, isPrivateCompositionFile, receivedFiles } from "./privateProjectFile.js";

const zeroFileIds = vi.hoisted(() => ({ on: false }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const lstatSync = ((path: string, options?: { bigint?: boolean }) => {
    const stat = actual.lstatSync(path, options as never);
    return zeroFileIds.on ? Object.assign(stat, { dev: 0n, ino: 0n }) : stat;
  }) as typeof actual.lstatSync;
  return { ...actual, default: { ...actual, lstatSync }, lstatSync };
});

let dir: string | undefined;

afterEach(() => {
  zeroFileIds.on = false;
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

describe("receivedFiles", () => {
  it("matches no file by identity on a drive that reports no file ids", () => {
    dir = mkdtempSync(join(tmpdir(), "hf-received-"));
    mkdirSync(join(dir, ".hyperframes"));
    writeFileSync(join(dir, "theirs.html"), "");
    writeFileSync(join(dir, "mine.html"), "");
    writeFileSync(
      join(dir, ".hyperframes", "received-files.json"),
      JSON.stringify({ files: ["theirs.html"] }),
    );
    zeroFileIds.on = true;
    const received = receivedFiles(dir);
    expect(received("theirs.html")).toBe(true);
    expect(received("mine.html")).toBe(false);
  });
});
