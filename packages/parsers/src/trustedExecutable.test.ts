import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, win32 } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  findTrustedExecutable,
  isTrustedDirectory,
  isTrustedExecutablePath,
  trustedPathDirs,
} from "./trustedExecutable.js";

describe("isTrustedDirectory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects relative entries, the working directory and folders inside it", () => {
    const project = resolve("/projects/shared");
    vi.spyOn(process, "cwd").mockReturnValue(project);

    for (const dir of ["", ".", "bin", "./node_modules/.bin"]) {
      expect(isTrustedDirectory(dir)).toBe(false);
    }
    expect(isTrustedDirectory(project)).toBe(false);
    expect(isTrustedDirectory(join(project, "node_modules", ".bin"))).toBe(false);
    expect(isTrustedExecutablePath(join(project, ".hyperframes", "bin", "ffmpeg"))).toBe(false);
    expect(isTrustedExecutablePath("ffmpeg")).toBe(false);
  });

  it("accepts absolute folders outside the working directory", () => {
    vi.spyOn(process, "cwd").mockReturnValue(resolve("/projects/shared"));

    expect(isTrustedDirectory(resolve("/usr/local/bin"))).toBe(true);
    expect(isTrustedDirectory(resolve("/projects/shared-tools"))).toBe(true);
    expect(isTrustedExecutablePath(resolve("/opt/homebrew/bin/ffmpeg"))).toBe(true);
  });

  it("run from the home folder or above it, skips only that folder itself", () => {
    const home = homedir();
    for (const cwd of [home, dirname(home)]) {
      vi.spyOn(process, "cwd").mockReturnValue(cwd);

      expect(isTrustedDirectory(cwd)).toBe(false);
      expect(isTrustedDirectory(join(home, ".local", "bin"))).toBe(true);
    }
  });
});

/** Makes `dir` the home folder, so a marker in a folder above the temp folder cannot move the project root. */
function homeAt(dir: string): void {
  vi.stubEnv("HOME", dir);
  vi.stubEnv("USERPROFILE", dir);
}

describe("isTrustedDirectory from a subfolder of a project", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // fails without the fix: only folders inside the working directory were dropped, so the
  // node_modules/.bin a package runner adds for the project root stayed ahead of system folders.
  it("drops every ancestor's node_modules and the folders of the project above", () => {
    const root = tempDir("hf-trusted-tree-");
    homeAt(root);
    const project = join(root, "project");
    const sub = join(project, "video");
    const venv = join(project, ".venv", "bin");
    mkdirSync(join(sub, "node_modules", ".bin"), { recursive: true });
    mkdirSync(join(project, "node_modules", ".bin"), { recursive: true });
    mkdirSync(venv, { recursive: true });
    writeFileSync(join(project, "package.json"), "{}");
    vi.spyOn(process, "cwd").mockReturnValue(sub);

    expect(isTrustedDirectory(join(sub, "node_modules", ".bin"))).toBe(false);
    expect(isTrustedDirectory(join(project, "node_modules", ".bin"))).toBe(false);
    expect(isTrustedDirectory(join(root, "node_modules", ".bin"))).toBe(false);
    expect(isTrustedDirectory(venv)).toBe(false);
    expect(isTrustedDirectory(project)).toBe(false);
    expect(isTrustedDirectory(join(root, "tools"))).toBe(true);
  });

  // fails without the fix: a folder that does not exist kept the spelling it was given, so a project
  // folder named through a link (or a Windows short name such as RUNNER~1) never matched.
  it.skipIf(process.platform === "win32")(
    "drops a project folder that does not exist yet, named through a link",
    () => {
      const root = tempDir("hf-trusted-link-");
      homeAt(root);
      const project = join(root, "project");
      const sub = join(project, "video");
      mkdirSync(sub, { recursive: true });
      symlinkSync(root, join(root, "link"));
      vi.spyOn(process, "cwd").mockReturnValue(sub);

      expect(isTrustedDirectory(join(root, "link", "project", "node_modules", ".bin"))).toBe(false);
      expect(isTrustedDirectory(join(root, "link", "node_modules", ".bin"))).toBe(false);
    },
  );

  it("keeps the per-user install dirs when the home folder itself holds a package.json or .git", () => {
    const home = tempDir("hf-trusted-home-");
    const sub = join(home, "films", "launch", "video");
    mkdirSync(sub, { recursive: true });
    mkdirSync(join(home, ".git"));
    writeFileSync(join(home, "package.json"), "{}");
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.spyOn(process, "cwd").mockReturnValue(sub);

    expect(isTrustedDirectory(join(home, ".local", "bin"))).toBe(true);
    expect(isTrustedDirectory(join(home, ".bun", "bin"))).toBe(true);
    expect(isTrustedDirectory(join(home, "node_modules", ".bin"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "never finds a helper in the project when run from its subfolder through a package runner",
    () => {
      const root = tempDir("hf-trusted-runner-");
      homeAt(root);
      const project = join(root, "project");
      const sub = join(project, "video");
      const tools = join(root, "tools");
      const subBin = join(sub, "node_modules", ".bin");
      const projectBin = join(project, "node_modules", ".bin");
      for (const dir of [subBin, projectBin, tools]) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "ffmpeg"), "", { mode: 0o755 });
      }
      vi.spyOn(process, "cwd").mockReturnValue(sub);
      vi.stubEnv("PATH", [subBin, projectBin, tools, "/usr/bin", "/bin"].join(delimiter));

      expect(trustedPathDirs()).toEqual([tools, "/usr/bin", "/bin"]);
      expect(findTrustedExecutable("ffmpeg")).toBe(join(tools, "ffmpeg"));
    },
  );
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("findTrustedExecutable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.skipIf(process.platform === "win32")(
    "never runs a `which` that sits on PATH ahead of the system folders",
    () => {
      const project = tempDir("hf-trusted-project-");
      const tools = tempDir("hf-trusted-tools-");
      const marker = join(tools, "ran");
      const bin = join(project, "node_modules", ".bin");
      mkdirSync(bin, { recursive: true });
      for (const dir of [bin, project]) {
        const script = `#!/bin/sh\necho ran > "${marker}"\necho "${join(bin, "ffmpeg")}"\n`;
        writeFileSync(join(dir, "which"), script, { mode: 0o755 });
      }
      writeFileSync(join(bin, "ffmpeg"), "", { mode: 0o755 });
      writeFileSync(join(tools, "ffmpeg"), "", { mode: 0o755 });
      mkdirSync(join(tools, "probe"));
      vi.spyOn(process, "cwd").mockReturnValue(project);
      vi.stubEnv("PATH", [bin, project, tools, "/usr/bin", "/bin"].join(delimiter));

      expect(findTrustedExecutable("ffmpeg")).toBe(join(tools, "ffmpeg"));
      expect(findTrustedExecutable("probe")).toBeUndefined();
      expect(existsSync(marker)).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "run from a subfolder, skips the project's node_modules/.bin and every folder inside the project",
    () => {
      const project = tempDir("hf-trusted-project-");
      const tools = tempDir("hf-trusted-tools-");
      const bin = join(project, "node_modules", ".bin");
      const scenes = join(project, "scenes", "intro");
      mkdirSync(bin, { recursive: true });
      mkdirSync(scenes, { recursive: true });
      writeFileSync(join(project, "package.json"), "{}");
      for (const dir of [bin, project, tools])
        writeFileSync(join(dir, "ffmpeg"), "", { mode: 0o755 });
      vi.spyOn(process, "cwd").mockReturnValue(scenes);
      vi.stubEnv("PATH", [bin, project, tools, "/usr/bin", "/bin"].join(delimiter));

      expect(findTrustedExecutable("ffmpeg")).toBe(join(tools, "ffmpeg"));
      expect(trustedPathDirs()).not.toContain(bin);
    },
  );

  it.skipIf(process.platform === "win32")(
    "in a monorepo, skips the repository's hoisted node_modules/.bin as well as the package's",
    () => {
      const repo = tempDir("hf-trusted-repo-");
      const tools = tempDir("hf-trusted-tools-");
      const pkg = join(repo, "packages", "film");
      const hoisted = join(repo, "node_modules", ".bin");
      const local = join(pkg, "node_modules", ".bin");
      const cwd = join(pkg, "scenes");
      for (const dir of [hoisted, local, cwd]) mkdirSync(dir, { recursive: true });
      mkdirSync(join(repo, ".git"));
      writeFileSync(join(pkg, "package.json"), "{}");
      for (const dir of [hoisted, local, tools])
        writeFileSync(join(dir, "ffmpeg"), "", { mode: 0o755 });
      vi.spyOn(process, "cwd").mockReturnValue(cwd);
      vi.stubEnv("PATH", [local, hoisted, tools].join(delimiter));

      expect(findTrustedExecutable("ffmpeg")).toBe(join(tools, "ffmpeg"));
      expect(trustedPathDirs()).toEqual([tools]);
    },
  );

  it("on Windows, takes the PATH copy and skips one in the working directory", () => {
    const project = tempDir("hf-trusted-project-");
    const tools = tempDir("hf-trusted-tools-");
    writeFileSync(join(project, "ffprobe.exe"), "");
    writeFileSync(join(tools, "ffprobe.exe"), "");
    const realPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    onTestFinished(() => {
      Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
    });
    vi.spyOn(process, "cwd").mockReturnValue(project);
    vi.stubEnv("PATH", [".", project, `"${tools}"`].join(win32.delimiter));

    expect(findTrustedExecutable("ffprobe")).toBe(join(tools, "ffprobe.exe"));
  });
});

describe("trustedPathDirs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.skipIf(process.platform === "win32")(
    "reads a leading ~ as the home folder, as shells do",
    () => {
      vi.spyOn(process, "cwd").mockReturnValue(resolve("/projects/shared"));

      expect(trustedPathDirs(["~/bin", "~", "~other/bin", "/usr/bin"].join(delimiter))).toEqual([
        join(homedir(), "bin"),
        homedir(),
        "/usr/bin",
      ]);
    },
  );
});

describe("trustedPathDirs on Windows", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads an entry wrapped in double quotes", () => {
    const project = tempDir("hf-trusted-project-");
    const tools = tempDir("hf-trusted-tools-");
    vi.spyOn(process, "cwd").mockReturnValue(project);

    expect(
      trustedPathDirs([`"${tools}"`, `"${project}"`].join(win32.delimiter), "win32", {}),
    ).toEqual([tools]);
  });

  it("still skips the project root's and every ancestor's node_modules/.bin, quoted or not", () => {
    const project = tempDir("hf-trusted-project-");
    const tools = tempDir("hf-trusted-tools-");
    writeFileSync(join(project, "package.json"), "{}");
    const sub = join(project, "video");
    mkdirSync(sub);
    vi.stubEnv("HOME", tempDir("hf-trusted-home-"));
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    vi.spyOn(process, "cwd").mockReturnValue(sub);
    const pathValue = [
      `"${join(project, "node_modules", ".bin")}"`,
      join(dirname(project), "node_modules", ".bin"),
      `"${join(sub, "scripts")}"`,
      `"${tools}"`,
    ].join(win32.delimiter);

    expect(trustedPathDirs(pathValue, "win32", {})).toEqual([tools]);
  });

  it("keeps the system folders when started from inside System32", () => {
    vi.spyOn(process, "cwd").mockReturnValue("C:\\Windows\\System32");
    const pathValue = [
      "C:\\Windows\\system32",
      ".",
      "C:\\Windows",
      "C:/Windows/System32/Wbem/",
      "C:\\Windows\\System32\\evil",
      "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\",
    ].join(win32.delimiter);

    expect(trustedPathDirs(pathValue, "win32", { SystemRoot: "C:\\Windows" })).toEqual([
      "C:\\Windows\\system32",
      "C:\\Windows",
      "C:/Windows/System32/Wbem/",
      "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\",
    ]);
  });

  it("takes the system folders from SystemRoot", () => {
    vi.spyOn(process, "cwd").mockReturnValue("C:\\Windows\\System32");
    const pathValue = ["C:\\Windows\\System32", "D:\\WinNT\\System32"].join(win32.delimiter);

    expect(trustedPathDirs(pathValue, "win32", { SYSTEMROOT: "D:\\WinNT" })).toEqual([
      "D:\\WinNT\\System32",
    ]);
  });

  it("reads PATH spelled Path, as a worker thread's copy of the Windows environment keeps it", () => {
    vi.spyOn(process, "cwd").mockReturnValue("C:\\Windows\\System32");
    const env = { Path: "C:\\Windows\\System32", SystemRoot: "C:\\Windows" };

    expect(trustedPathDirs(undefined, "win32", env)).toEqual(["C:\\Windows\\System32"]);
  });
});
