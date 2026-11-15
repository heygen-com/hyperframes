import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import AdmZip from "adm-zip";
import type { LeftOutReference } from "./leftOutReference.js";
import { buildPublishFileMap, createPublishArchive, stagePublishFiles } from "./publishProject.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-publish-private-"));
  writeFileSync(join(dir, "index.html"), "<html></html>", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(path: string, content = "x"): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content, "utf-8");
}

function stage(): { keys: string[]; leftOut: LeftOutReference[]; warnings: string[] } {
  const leftOut: LeftOutReference[] = [];
  const warnings: string[] = [];
  const staged = stagePublishFiles(dir, Infinity, (warning, reference) => {
    warnings.push(warning);
    leftOut.push(reference);
  });
  return { keys: [...staged.keys()].sort(), leftOut, warnings };
}

const SECRETS = [".env", ".env.local", ".env.production", "assets/.env", ".envrc"];

describe("upload archives leave out env files and private data whatever .hyperframesignore says", () => {
  it.each([
    ["re-includes .env files", "!.env\n!.env.*\n!.envrc\n!**/.env\n"],
    ["re-includes every dotfile", "!.*\n"],
    ["re-includes every path", "!*\n!**/*\n"],
  ])("when it %s", (_, rules) => {
    for (const path of SECRETS) write(path, "HEYGEN_API_KEY=secret");
    write(".hyperframesignore", rules);

    const { keys, leftOut, warnings } = stage();

    for (const path of SECRETS) expect(keys).not.toContain(path);
    expect(leftOut.map((one) => one.file).sort()).toEqual([...SECRETS].sort());
    expect(new Set(leftOut.map((one) => one.reason))).toEqual(new Set(["private"]));
    expect(warnings.every((warning) => warning.endsWith("it was left out of the upload."))).toBe(
      true,
    );
  });

  it("leaves Git data out when a hidden folder is re-included recursively", () => {
    write(".git/config", "[remote]");
    write(".media/.git/HEAD", "ref");
    write(".media/.env", "KEY=1");
    write(".media/logo.png", "logo");
    write(".hyperframesignore", "!/.git/\n!/.git/**\n!/.media/\n!/.media/**\n");

    const { keys, leftOut } = stage();

    expect(keys).toContain(".media/logo.png");
    expect(keys.filter((key) => key.includes(".git") || key.endsWith(".env"))).toEqual([]);
    expect(leftOut.map((one) => one.file)).toEqual([".media/.env"]);
  });

  it("leaves Studio's private records out but keeps its shared ones", () => {
    write(".hyperframes/received-files.json", "{}");
    write(".hyperframesignore", "!/.hyperframes/\n!/.hyperframes/**\n");

    const { keys, leftOut } = stage();

    expect(keys).not.toContain(".hyperframes/received-files.json");
    expect(leftOut.map((one) => one.file)).toEqual([".hyperframes/received-files.json"]);
  });

  it("applies to the publish map and the feedback repro archive too", () => {
    write(".env", "HEYGEN_API_KEY=secret");
    write(".hyperframesignore", "!.*\n");

    const publishLeftOut: string[] = [];
    const publishMap = buildPublishFileMap(dir, (_, one) => publishLeftOut.push(one.file));
    expect([...publishMap.keys()]).not.toContain(".env");
    expect(publishLeftOut).toEqual([".env"]);

    const reproLeftOut: string[] = [];
    const repro = createPublishArchive(dir, (_, one) => reproLeftOut.push(one.file));
    const entries = new AdmZip(repro.buffer).getEntries().map((entry) => entry.entryName);
    expect(entries).not.toContain(".env");
    expect(reproLeftOut).toEqual([".env"]);
  });

  it("says nothing when the ignore rules already leave the env file out", () => {
    write(".env", "HEYGEN_API_KEY=secret");

    const { keys, leftOut } = stage();

    expect(keys).toEqual(["index.html"]);
    expect(leftOut).toEqual([]);
  });
});

const CREDENTIALS = [
  ".npmrc",
  ".yarnrc.yml",
  ".pypirc",
  "pip.conf",
  ".netrc",
  ".git-credentials",
  ".gitconfig",
  ".mcp.json",
  ".ssh/id_ed25519",
  ".aws/credentials",
  ".gnupg/private-keys-v1.d/key.key",
  ".docker/config.json",
  ".kube/config",
  ".azure/accessTokens.json",
  ".config/gcloud/credentials.db",
  ".claude/settings.local.json",
  ".codex/auth.json",
  ".cursor/mcp.json",
  ".agents/state.json",
  ".gemini/settings.json",
  ".vscode/settings.json",
  ".idea/workspace.xml",
  "keys/id_rsa",
  "keys/server.pem",
  "keys/tls.key",
  "keys/cert.p12",
  "keys/cert.pfx",
  "scenes/_netrc",
  "scenes/.NPMRC",
  "scenes/.Claude/settings.json",
];

const HTML_REFERENCED = CREDENTIALS.filter((_, at) => at % 2 === 0);
const CSS_REFERENCED = CREDENTIALS.filter((_, at) => at % 2 === 1);

function credentialProject(): void {
  for (const path of CREDENTIALS) write(path, "token=secret");
  write("assets/logo.png", "logo");
  write(".media/clip.mp4", "clip");
  write(
    "style.css",
    CSS_REFERENCED.map((path, at) => `.c${at}{background:url("${path}")}`).join("\n") +
      `\n.logo{background:url("assets/logo.png")}`,
  );
  write(
    "index.html",
    `<link rel="stylesheet" href="style.css"><video src=".media/clip.mp4"></video>` +
      HTML_REFERENCED.map((path) => `<img src="${path}"><link href="${path}">`).join(""),
  );
}

function leftOutPaths(leftOut: LeftOutReference[]): Set<string> {
  return new Set(leftOut.filter((one) => one.reason === "private").map((one) => one.path));
}

describe("upload archives leave out credentials and agent or editor state", () => {
  it.each([
    ["re-includes every dotfile", "!.*\n"],
    ["re-includes every path", "!*\n!**/*\n"],
    ["is absent", null],
  ])("when .hyperframesignore %s and the page and a stylesheet name them", (_, rules) => {
    credentialProject();
    if (rules) write(".hyperframesignore", rules);

    const { keys, leftOut } = stage();

    for (const path of CREDENTIALS) expect(keys).not.toContain(path);
    const reported = leftOutPaths(leftOut);
    for (const path of CREDENTIALS) expect(reported).toContain(path);
    expect(keys).toEqual(expect.arrayContaining(["assets/logo.png", ".media/clip.mp4"]));
  });

  it("keeps them out of the publish map, the cloud render staging and the feedback archive", () => {
    credentialProject();
    write(".hyperframesignore", "!.*\n");

    const publishMap = buildPublishFileMap(dir);
    const cloudStaged = stagePublishFiles(dir, 1);
    const feedback = new AdmZip(createPublishArchive(dir).buffer)
      .getEntries()
      .map((entry) => entry.entryName);

    for (const entries of [[...publishMap.keys()], [...cloudStaged.keys()], feedback]) {
      expect(entries.filter((entry) => CREDENTIALS.includes(entry))).toEqual([]);
      expect(entries).toEqual(expect.arrayContaining(["assets/logo.png", ".media/clip.mp4"]));
    }
  });

  it("brings back a skipped file a page names only when it is an asset or not hidden", () => {
    write("renders/data.json", "{}");
    write("snapshots/frame.png", "png");
    write(".cache/notes.yaml", "token: secret");
    write(".cache/still.webp", "webp");
    write(
      "index.html",
      `<a href="renders/data.json">d</a><img src="snapshots/frame.png">` +
        `<a href=".cache/notes.yaml">n</a><img src=".cache/still.webp">`,
    );

    const { keys, leftOut } = stage();

    expect(keys).toEqual([
      ".cache/still.webp",
      "index.html",
      "renders/data.json",
      "snapshots/frame.png",
    ]);
    expect(leftOut.map(({ path, reason }) => ({ path, reason }))).toEqual([
      { path: ".cache/notes.yaml", reason: "private" },
    ]);
  });
});
