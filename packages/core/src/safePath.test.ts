import { describe, it, expect, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  folderGone,
  isPrivateFileUnder,
  isProjectRootMissing,
  isSafePath,
  isStudioPrivatePath,
  mkdirWithinProject,
  resolveExistingWithinProjectOff,
  resolveWithinProject,
  toolTrustedFileKind,
} from "./safePath.js";

const recased = (path: string) => join(dirname(path), basename(path).toUpperCase());

function caseInsensitive(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "safepath-probe-"));
  try {
    return existsSync(recased(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("isSafePath", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  function tmpDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  // Mirror the repo convention (preview.test.ts): non-symlink-privileged Windows
  // runners can't create symlinks — skip those cases rather than crash the suite.
  function tryCreateSymlink(target: string, path: string, type: "dir" | "file"): boolean {
    try {
      symlinkSync(target, path, type);
      return true;
    } catch {
      return false;
    }
  }

  it("allows the base directory itself", () => {
    const base = tmpDir("safepath-base-");
    expect(isSafePath(base, base)).toBe(true);
  });

  it("allows an existing nested path inside base", () => {
    const base = tmpDir("safepath-base-");
    const file = join(base, "assets", "logo.png");
    mkdirSync(join(base, "assets"));
    writeFileSync(file, "x");
    expect(isSafePath(base, file)).toBe(true);
  });

  it("allows a not-yet-existing write target inside base", () => {
    const base = tmpDir("safepath-base-");
    // Neither the dir nor the file exist yet — the create/write case.
    expect(isSafePath(base, join(base, "new", "deep", "file.txt"))).toBe(true);
  });

  it("rejects a `..` traversal that escapes base", () => {
    const base = tmpDir("safepath-base-");
    expect(isSafePath(base, join(base, "..", "..", "etc", "passwd"))).toBe(false);
  });

  it("rejects an existing file reached through a symlink that points outside base", () => {
    const base = tmpDir("safepath-base-");
    const external = tmpDir("safepath-external-");
    const secret = join(external, "secret.txt");
    writeFileSync(secret, "top secret");
    // project/link -> external/  (the classic in-project symlink escape)
    if (!tryCreateSymlink(external, join(base, "link"), "dir")) return;
    expect(isSafePath(base, join(base, "link", "secret.txt"))).toBe(false);
  });

  it("rejects a not-yet-existing write target whose parent is a symlink to outside base", () => {
    const base = tmpDir("safepath-base-");
    const external = tmpDir("safepath-external-");
    // base/link -> external; writing base/link/evil.txt would land in external.
    if (!tryCreateSymlink(external, join(base, "link"), "dir")) return;
    expect(isSafePath(base, join(base, "link", "evil.txt"))).toBe(false);
  });

  it("rejects a file symlink inside base that targets a file outside base", () => {
    const base = tmpDir("safepath-base-");
    const external = tmpDir("safepath-external-");
    const secret = join(external, "secret.txt");
    writeFileSync(secret, "top secret");
    if (!tryCreateSymlink(secret, join(base, "passwd"), "file")) return;
    expect(isSafePath(base, join(base, "passwd"))).toBe(false);
  });

  it("allows a symlink inside base that points to another location inside base", () => {
    const base = tmpDir("safepath-base-");
    const realDir = join(base, "real");
    mkdirSync(realDir);
    writeFileSync(join(realDir, "in.txt"), "x");
    if (!tryCreateSymlink(realDir, join(base, "alias"), "dir")) return;
    expect(isSafePath(base, join(base, "alias", "in.txt"))).toBe(true);
  });

  it("canonicalizes base too: a symlinked base path still admits in-base targets", () => {
    // Guards against one-sided realpath: when base is reached via a symlink
    // (as on macOS where tmpdir lives under /var -> /private/var), an in-base
    // target must still be accepted.
    const realBase = tmpDir("safepath-realbase-");
    const linkParent = tmpDir("safepath-linkparent-");
    const baseLink = join(linkParent, "baseLink");
    if (!tryCreateSymlink(realBase, baseLink, "dir")) return;
    writeFileSync(join(realBase, "file.txt"), "x");
    expect(isSafePath(baseLink, join(baseLink, "file.txt"))).toBe(true);
  });

  it.skipIf(!caseInsensitive())("admits an in-base path typed in another letter case", () => {
    const base = tmpDir("safepath-case-");
    writeFileSync(join(base, "file.txt"), "x");
    expect(isSafePath(base, join(recased(base), "file.txt"))).toBe(true);
    expect(isSafePath(recased(base), join(base, "new.txt"))).toBe(true);
    expect(isSafePath(recased(base), join(tmpdir(), "outside.txt"))).toBe(false);
  });

  it("fails closed when the base directory does not exist", () => {
    const base = join(tmpdir(), "safepath-does-not-exist-zzz", "nope");
    expect(isSafePath(base, join(base, "file.txt"))).toBe(false);
  });
});

describe("resolveWithinProject", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  function tmpDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  }

  function tryCreateSymlink(target: string, path: string, type: "dir" | "file"): boolean {
    try {
      symlinkSync(target, path, type);
      return true;
    } catch {
      return false;
    }
  }

  it("returns the resolved absolute path for an in-project relative path", () => {
    const base = tmpDir("rwp-base-");
    expect(resolveWithinProject(base, "assets/logo.png")).toBe(join(base, "assets", "logo.png"));
  });

  it("returns the resolved path for a not-yet-existing write target", () => {
    const base = tmpDir("rwp-base-");
    expect(resolveWithinProject(base, "new/deep/file.txt")).toBe(
      join(base, "new", "deep", "file.txt"),
    );
  });

  it("returns null for a `..` traversal that escapes the project", () => {
    const base = tmpDir("rwp-base-");
    expect(resolveWithinProject(base, "../../etc/passwd")).toBeNull();
  });

  it("returns null when the path resolves outside via an in-project symlink", () => {
    const base = tmpDir("rwp-base-");
    const external = tmpDir("rwp-external-");
    writeFileSync(join(external, "secret.txt"), "top secret");
    if (!tryCreateSymlink(external, join(base, "link"), "dir")) return;
    expect(resolveWithinProject(base, "link/secret.txt")).toBeNull();
  });

  it("answers the same off the event loop for a file that exists", async () => {
    const base = tmpDir("rwp-base-");
    const external = tmpDir("rwp-external-");
    writeFileSync(join(base, "in.js"), "in");
    writeFileSync(join(external, "secret.txt"), "top secret");
    expect(await resolveExistingWithinProjectOff(base, "in.js")).toBe(join(base, "in.js"));
    // fails without the fix: a path that does not resolve threw instead of answering null.
    expect(await resolveExistingWithinProjectOff(base, "missing.js")).toBeNull();
    const escape = join("..", basename(external), "secret.txt");
    expect(await resolveExistingWithinProjectOff(base, escape)).toBeNull();
    if (!tryCreateSymlink(external, join(base, "link"), "dir")) return;
    expect(await resolveExistingWithinProjectOff(base, "link/secret.txt")).toBeNull();
  });
});

describe("mkdirWithinProject", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-mkdir-within-"));
    made.push(dir);
    return dir;
  };

  it("creates the missing folders below a project folder that exists", () => {
    const root = tempDir();
    mkdirWithinProject(root, join(root, ".hyperframes", "backup"));
    expect(existsSync(join(root, ".hyperframes", "backup"))).toBe(true);
  });

  it("does not bring back a project folder that was renamed away", () => {
    const parent = tempDir();
    const root = join(parent, "film");
    let thrown: unknown;
    try {
      mkdirWithinProject(root, join(root, "assets", "audio"));
    } catch (error) {
      thrown = error;
    }
    expect(isProjectRootMissing(thrown)).toBe(true);
    expect(existsSync(root)).toBe(false);
  });

  it("creates a folder outside the project as before", () => {
    const parent = tempDir();
    mkdirSync(join(parent, "film"));
    mkdirWithinProject(join(parent, "film"), join(parent, "cache", "renders"));
    expect(existsSync(join(parent, "cache", "renders"))).toBe(true);
  });

  it("creates no folder outside the project once the project folder is gone", () => {
    const parent = tempDir();
    expect(() => mkdirWithinProject(join(parent, "film"), join(parent, "renders"))).toThrow(
      /Project folder not found/,
    );
    expect(existsSync(join(parent, "renders"))).toBe(false);
  });
});

describe("folderGone", () => {
  it("is true only when nothing is there", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-folder-gone-"));
    writeFileSync(join(dir, "file"), "");
    try {
      expect(folderGone(dir)).toBe(false);
      expect(folderGone(join(dir, "missing"))).toBe(true);
      expect(folderGone(join(dir, "file", "below"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "is false for a folder that cannot be looked at",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-folder-gone-"));
      mkdirSync(join(dir, "film"));
      chmodSync(dir, 0o000);
      try {
        expect(folderGone(join(dir, "film"))).toBe(false);
      } finally {
        chmodSync(dir, 0o700);
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("isStudioPrivatePath on very long paths", () => {
  const MILLION = 1_000_000;
  it.each([
    ["a million empty segments", "/".repeat(MILLION), false],
    ["a million named segments", "a/".repeat(MILLION) + "clip.png", false],
    [
      "Studio's own file after a million empty segments",
      "/".repeat(MILLION) + ".hyperframes/studio-motion.json",
      false,
    ],
    [
      "the media folder after a million empty segments",
      "/".repeat(MILLION) + ".media/take.mp4",
      false,
    ],
    [
      "a nested .hyperframes after a million named segments",
      "a/".repeat(MILLION) + ".hyperframes/studio-motion.json",
      true,
    ],
    ["a hidden file after a million named segments", "a/".repeat(MILLION) + ".token", true],
  ])("judges %s in linear time, as before", (_, path, privateFile) => {
    const started = performance.now();
    expect(isStudioPrivatePath(path)).toBe(privateFile);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("judges a file named past the platform's path limit in linear time", () => {
    const projectDir = realpathSync(mkdtempSync(join(tmpdir(), "hf-long-name-")));
    try {
      const started = performance.now();
      const file = join(projectDir, "a/".repeat(200_000) + "clip.png");
      expect(isPrivateFileUnder(projectDir, file, isStudioPrivatePath)).toBe(false);
      expect(performance.now() - started).toBeLessThan(2_000);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("isStudioPrivatePath", () => {
  it.each([
    ".hyperframes",
    ".hyperframes/app-history.jsonl",
    ".hyperframes/agent-handoff.json",
    ".HYPERFRAMES/comments.jsonl",
    ".hyperframes./heygen-jobs.jsonl",
    ".hyperframes /agent-handoff.json",
    ".hyperframes\\comments.jsonl",
    ".hyperframes:stream/comments.jsonl",
    ".git/config",
    ".env.local",
    ".npmrc",
    ".NPMRC",
    ".mcp.json",
    ".mcp.json::$DATA",
    ".claude/x.json",
    ".Claude./settings.local.json",
    ".aws/credentials",
    "keys\\.ssh\\config",
    "id_ed25519",
    "deploy/id_rsa.pub",
    "certs/cert.pem",
    "certs/CERT.PEM.",
    ".config/gh/hosts.yml",
    "../.aws/credentials",
    "sub/.hyperframes",
    "sub/.hyperframes/app-history.jsonl",
    "sub/.HyperFrames./App-History.JSONL",
    "sub\\.hyperframes \\agent-handoff.json",
    "a/b/.hyperframes:stream/comments.jsonl",
    "sub/.hyperframes/backup/index.html",
    "sub/.hyperframes/studio-motion.json",
    "sub/.hyperframes/prepared-assets/gif/clip.gif",
    "sub/.hyperframes/requests/1/before.png",
    ".hyperframes/prepared-assets/.hyperframes/app-history.jsonl",
    "assets/.hyperframes/logo.png",
    ".dev.vars",
    ".pgpass",
    ".vault-token",
    ".cargo/credentials.toml",
    ".pulumi/credentials.json",
    "sub/.terraform/providers.json",
    ".DEV.VARS.",
    ".hyperframes-pull.json",
    "sub/.hyperframes-pull.json",
    ".config/fonts/brand.txt",
    ".cache/notes.yaml",
    ".png",
    "sub/.media/audio/bgm.json",
    ".media/.lock",
    "infra/terraform.tfstate",
    "infra/terraform.tfstate.backup",
    "prod.tfvars",
    "prod.tfvars.json",
    "android/release.jks",
    "release.keystore",
    "AuthKey_ABC.p8",
    "vault.kdbx",
    "putty.ppk",
    ".next/server/app/page.js",
    "web/.svelte-kit/output/client/app.css",
    ".vercel/output/static/logo.png",
    "credentials.json",
    "config/serviceAccountKey.json",
    ".secrets.js",
    ".eslintrc.cjs",
    "sub/.tokens.css",
    ".cache/.session.webp",
  ])("refuses %s", (path) => {
    expect(isStudioPrivatePath(path)).toBe(true);
  });

  it.each([
    ".hyperframes/prepared-assets/gif/clip.gif",
    ".HYPERFRAMES/Prepared-Assets./heif/photo.png",
    ".hyperframes/requests/sketch.png",
    ".hyperframes/studio-motion.json",
    ".hyperframes/studio-manual-edits.json",
    "sub/hyperframes/app-history.jsonl",
    "assets/logo.png",
    "assets/keynote-cover.png",
    "fonts/aws-logo.svg",
    ".media/audio/bgm/bgm_001.wav",
    ".MEDIA./luts/lut_001.cube",
    ".config/fonts/brand.woff2",
    ".assets/animation.js",
    ".cache/still.webp",
    "sub/.media/audio/bgm.wav",
    "../../.cache/hyperframes/frames/v1/frame_0001.png",
    "..\\.cache\\frames\\frame_0001.png",
  ])("allows %s", (path) => {
    expect(isStudioPrivatePath(path)).toBe(false);
  });
});

describe("toolTrustedFileKind", () => {
  it.each([
    ["package.json", "project-config"],
    ["sub/Package.JSON", "project-config"],
    ["hyperframes.json.", "project-config"],
    ["hyperframes.lock.json", "project-config"],
    ["package.json::$DATA", "project-config"],
    ["pnpm-lock.yaml", "lock-file"],
    ["nested/yarn.lock", "lock-file"],
    ["bun.lockb ", "lock-file"],
    ["tsconfig.json", "tool-config"],
    ["Makefile", "tool-config"],
    ["vite.config.ts", "tool-config"],
    ["lib/eslint.config.mjs", "tool-config"],
    ["AGENTS.md", "agent-instructions"],
    ["deep/sub\\CLAUDE.local.md", "agent-instructions"],
    ["compositions/gemini.md", "agent-instructions"],
    ["scripts/postinstall.sh", "program"],
    ["tools/run.PY", "program"],
    ["assets/app.exe", "program"],
    ["PACKAG~1.JSO", "short-name"],
    ["CLAUDE~1/notes.md", "short-name"],
    ["COPILO~1.MD", "short-name"],
    ["AGENT\u017f.md", "agent-instructions"],
    ["package.j\u017fon", "project-config"],
    ["Make\ufb01le", "tool-config"],
    ["run.\u017fh", "program"],
    ["\uff50ackage.json", "project-config"],
    ["pack\u200bage.json", "project-config"],
    ["jest.config.json", "tool-config"],
    ["docker-compose.yml", "tool-config"],
    ["gulpfile.mjs", "tool-config"],
    ["turbo.json", "tool-config"],
    ["pyproject.toml", "tool-config"],
    ["opencode.json", "tool-config"],
    ["opencode.jsonc", "tool-config"],
    ["crush.json", "tool-config"],
    ["docker-compose.override.yml", "tool-config"],
    ["compose.override.yaml", "tool-config"],
    ["Dockerfile.dev", "tool-config"],
    ["web.dockerfile", "tool-config"],
    ["Containerfile", "tool-config"],
    ["lefthook-local.yml", "tool-config"],
    ["lefthook.json", "tool-config"],
    ["lefthook.toml", "tool-config"],
    ["Taskfile.dist.yml", "tool-config"],
    ["nodemon.json", "tool-config"],
    ["mise.toml", "tool-config"],
    ["mise.local.toml", "tool-config"],
    ["mise/config.toml", "tool-config"],
    ["eslint.config.jsonc", "tool-config"],
    ["tsconfig.app.json", "tool-config"],
    ["simple-git-hooks.json", "tool-config"],
    ["devbox.json", "tool-config"],
    ["wrangler.jsonc", "tool-config"],
    ["Gemfile", "tool-config"],
    ["Vagrantfile", "tool-config"],
    ["shell.nix", "program"],
    ["hooks/pre-commit.fish", "program"],
    ["NODEMON.JSON.", "tool-config"],
    ["Docker\ufb01le.dev", "tool-config"],
    ["binding.gyp", "tool-config"],
    ["BINDING.GYP. ", "tool-config"],
    ["binding.gyp::$DATA", "tool-config"],
    ["BINDIN~1.GYP", "tool-config"],
    ["addon.gyp", "tool-config"],
    ["deps/common.gypi", "tool-config"],
    ["server.js", "program"],
    ["Server.JS.", "program"],
    ["server.js::$DATA", "program"],
    ["sub/server.js", "program"],
    ["SERVER~1.JS", "short-name"],
  ] as const)("names %s %s", (path, kind) => {
    expect(toolTrustedFileKind(path)).toBe(kind);
  });

  it("finds an agent file below a folder with a decomposed name", () => {
    expect(toolTrustedFileKind("caf\u0065\u0301/AGENTS.md")).toBe("agent-instructions");
  });

  it.each([
    "index.html",
    "compositions/scene.html",
    "assets/style.css",
    "assets/gsap.min.js",
    "lib/scene.mjs",
    "assets/data.json",
    "assets/logo.svg",
    "notes.md",
    "README.md",
    "compositions/lockup.html",
    "assets/package-art.png",
    ".hyperframes/studio-motion.json",
    "media/take~2.mp4",
    "assets/scene~10.png",
    "assets/config.json",
    "compositions/docker.html",
    "assets/mise-en-scene.png",
    "assets/lefthook.png",
    "assets/compose.svg",
    "config.toml",
    "assets/script.js",
    "assets/webserver.js",
    "assets/server.json",
  ])("leaves %s to the other rules", (path) => {
    expect(toolTrustedFileKind(path)).toBeNull();
  });
});
