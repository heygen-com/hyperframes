import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isCredentialOrToolStatePath } from "@hyperframes/core/safe-path";
import {
  isEnvOrGitPath,
  isPrivateCompositionFile,
  receivedFiles,
  recordReceivedFiles,
} from "./privateProjectFile.js";

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

describe("isCredentialOrToolStatePath", () => {
  it("names logins, keys and agent or editor state at any depth and in any case", () => {
    for (const path of [
      ".npmrc",
      "a/b/.YARNRC.yml",
      "_netrc",
      "pip.ini",
      ".git-credentials",
      ".ssh/config",
      "x\\.AWS\\credentials",
      ".config/gcloud/application_default_credentials.json",
      ".config/gh/hosts.yml",
      "keys/id_ecdsa.pub",
      "certs/site.PEM",
      ".claude/settings.json",
      ".idea/workspace.xml",
      "sub/.mcp.json",
    ]) {
      expect(isCredentialOrToolStatePath(path), path).toBe(true);
    }
  });

  it("leaves ordinary composition files alone", () => {
    for (const path of [
      "assets/keyframes.json",
      "monkey.png",
      "id.png",
      "fonts/key.woff2",
      ".config/theme.json",
      "claude/logo.svg",
      "scenes/mcp.json",
      ".media/clip.mp4",
    ]) {
      expect(isCredentialOrToolStatePath(path), path).toBe(false);
    }
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

describe("recordReceivedFiles", () => {
  const record = (root: string) => join(root, ".hyperframes", "received-files.json");
  const lock = (root: string) => `${record(root)}.lock`;
  const listed = (root: string) => JSON.parse(readFileSync(record(root), "utf-8")).files;
  function project(): string {
    dir = mkdtempSync(join(tmpdir(), "hf-received-lock-"));
    mkdirSync(join(dir, ".hyperframes"));
    writeFileSync(record(dir), JSON.stringify({ files: ["hyperframes.json"] }));
    return dir;
  }

  it("waits for another writer's lock, so both writers keep their entries", async () => {
    const root = project();
    writeFileSync(lock(root), "");
    // Another writer: it read the record, holds the lock, writes its entry, then lets go.
    const other = spawn(process.execPath, [
      "-e",
      `const fs = require("node:fs");
       const files = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).files;
       process.stdout.write("read");
       setTimeout(() => {
         fs.writeFileSync(process.argv[1], JSON.stringify({ files: [...files, "theirs.html"] }));
         fs.rmSync(process.argv[2]);
       }, 300);`,
      record(root),
      lock(root),
    ]);
    await new Promise((resolve) => other.stdout.once("data", resolve));
    recordReceivedFiles(root, ["mine.html"]);
    await new Promise((resolve) => other.once("exit", resolve));
    expect(listed(root)).toEqual(["hyperframes.json", "mine.html", "theirs.html"]);
  });

  it("takes a project folder however its path is spelled", () => {
    const root = join(project(), "Project");
    mkdirSync(root);
    const respelled = join(dirname(root), "project");
    const spelled = existsSync(respelled) ? respelled : root;
    expect(recordReceivedFiles(spelled, ["mine.html"])).toEqual(["mine.html"]);
    expect(listed(root)).toEqual(["mine.html"]);
  });

  it("takes over a lock left behind for more than ten seconds", () => {
    const root = project();
    writeFileSync(lock(root), "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock(root), old, old);
    expect(recordReceivedFiles(root, ["mine.html"])).toEqual(["mine.html"]);
    expect(listed(root)).toEqual(["hyperframes.json", "mine.html"]);
  });

  it("fails rather than write past a lock that stays held", () => {
    const root = project();
    writeFileSync(lock(root), "");
    expect(() => recordReceivedFiles(root, ["mine.html"])).toThrow(/Another program is changing/);
    expect(listed(root)).toEqual(["hyperframes.json"]);
  });
});
