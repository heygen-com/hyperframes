import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The module inspects `process.argv[1]` + `realpathSync`. We stub both so
// each test describes a hypothetical install layout without touching the
// filesystem.

type InstallerInfo =
  (typeof import("./installerDetection.js"))["detectInstaller"] extends () => infer R ? R : never;

async function detectWith(realPath: string | null): Promise<InstallerInfo> {
  vi.resetModules();
  const origArgv1 = process.argv[1];
  if (realPath === null) {
    process.argv[1] = "";
  } else {
    // argv[1] doesn't matter — realpathSync is what gets checked after the
    // resolver runs. Set it to the unresolved form and stub fs.realpathSync
    // to return the scenario's resolved path.
    process.argv[1] = "/not/used/at/runtime";
  }
  vi.doMock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    return {
      ...actual,
      realpathSync:
        realPath === null
          ? () => {
              throw new Error("simulated unresolved path");
            }
          : () => realPath,
    };
  });

  const mod = await import("./installerDetection.js");
  const info = mod.detectInstaller();
  process.argv[1] = origArgv1 ?? "";
  return info;
}

describe("detectInstaller", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("classifies workspace link as skip (monorepo dev)", async () => {
    const info = await detectWith("/Users/dev/hyperframes-oss/packages/cli/dist/cli.js");
    expect(info.kind).toBe("skip");
    expect(info.reason).toContain("workspace");
    expect(info.installCommand("0.4.4")).toBeNull();
  });

  it("classifies npx _npx cache path as skip", async () => {
    const info = await detectWith(
      "/Users/me/.npm/_npx/abc123/node_modules/hyperframes/dist/cli.js",
    );
    expect(info.kind).toBe("skip");
    expect(info.reason.toLowerCase()).toContain("ephemeral");
  });

  it("classifies bunx temp dir as skip", async () => {
    const info = await detectWith("/var/folders/tmp/bunx-501-hyperframes/entry.js");
    expect(info.kind).toBe("skip");
    expect(info.reason.toLowerCase()).toContain("ephemeral");
  });

  it("detects Homebrew install", async () => {
    const info = await detectWith("/opt/homebrew/Cellar/hyperframes/0.4.3/bin/hyperframes");
    expect(info.kind).toBe("brew");
    expect(info.installCommand("0.4.4")).toBe("brew upgrade hyperframes");
  });

  it("detects bun global install", async () => {
    const info = await detectWith(
      "/Users/me/.bun/install/global/node_modules/hyperframes/dist/cli.js",
    );
    expect(info.kind).toBe("bun");
    expect(info.installCommand("0.4.4")).toBe("bun add -g hyperframes@0.4.4");
  });

  it("detects pnpm global install (Library/pnpm path)", async () => {
    const info = await detectWith(
      "/Users/me/Library/pnpm/global/5/node_modules/hyperframes/dist/cli.js",
    );
    expect(info.kind).toBe("pnpm");
    expect(info.installCommand("0.4.4")).toBe("pnpm add -g hyperframes@0.4.4");
  });

  it("treats pnpm project-local installs as unknown layouts", async () => {
    const info = await detectWith(
      "/path/to/project/node_modules/.pnpm/hyperframes@0.4.3/node_modules/hyperframes/dist/cli.js",
    );
    expect(info.kind).toBe("skip");
    expect(info.installCommand("0.4.4")).toBeNull();
  });

  it("detects npm global install", async () => {
    const info = await detectWith("/usr/local/lib/node_modules/hyperframes/dist/cli.js");
    expect(info.kind).toBe("npm");
    expect(info.installCommand("0.4.4")).toBe("npm install -g hyperframes@0.4.4");
  });

  it("detects npm global install on Windows", async () => {
    const info = await detectWith(
      "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\hyperframes\\dist\\cli.js",
    );
    expect(info.kind).toBe("npm");
    expect(info.installCommand("0.4.4")).toBe("npm install -g hyperframes@0.4.4");
  });

  it("returns skip when the entry cannot be resolved", async () => {
    const info = await detectWith(null);
    // realpathSync throws → reason is "could not resolve" OR the path itself
    // (the fallback returns the unresolved argv[1]); either way the kind is
    // skip-or-unknown which we treat as skip downstream.
    expect(info.kind).toBe("skip");
    expect(info.installCommand("0.4.4")).toBeNull();
  });

  it("returns skip for an unknown install layout", async () => {
    const info = await detectWith("/some/random/path/hyperframes");
    expect(info.kind).toBe("skip");
    expect(info.reason).toMatch(/Unknown install layout/);
  });
});

import { installInvocation } from "./installerDetection.js";

describe("installInvocation", () => {
  it("returns the npm global argv for kind npm", () => {
    expect(installInvocation("npm", "1.2.3")).toEqual({
      bin: "npm",
      args: ["install", "-g", "hyperframes@1.2.3"],
    });
  });

  it("returns bun/pnpm add -g argv for those managers", () => {
    expect(installInvocation("bun", "1.2.3")).toEqual({
      bin: "bun",
      args: ["add", "-g", "hyperframes@1.2.3"],
    });
    expect(installInvocation("pnpm", "1.2.3")).toEqual({
      bin: "pnpm",
      args: ["add", "-g", "hyperframes@1.2.3"],
    });
  });

  it("returns a version-less brew upgrade for kind brew", () => {
    expect(installInvocation("brew", "1.2.3")).toEqual({
      bin: "brew",
      args: ["upgrade", "hyperframes"],
    });
  });

  it("returns null for kind skip (ephemeral / project-local / unknown)", () => {
    expect(installInvocation("skip", "1.2.3")).toBeNull();
  });
});

describe("runningInstall: which binary runs, and the command that updates it", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  async function runningAt(realPath: string) {
    vi.resetModules();
    vi.stubEnv("HYPERFRAMES_PLUGIN_VERSION", "");
    vi.doMock("node:fs", async () => ({
      ...(await vi.importActual<typeof import("node:fs")>("node:fs")),
      realpathSync: () => realPath,
    }));
    const origArgv1 = process.argv[1];
    process.argv[1] = "/usr/local/bin/hyperframes";
    try {
      const mod = await import("./installerDetection.js");
      const install = mod.runningInstall();
      return {
        install,
        command: mod.updateCommandFor(install, "0.9.8"),
        label: mod.installChannelLabel(install.channel),
        mod,
      };
    } finally {
      process.argv[1] = origArgv1 ?? "";
    }
  }

  it.each([
    [
      "npm",
      "/usr/local/lib/node_modules/hyperframes/dist/cli.js",
      "npm install -g hyperframes@0.9.8",
    ],
    [
      "pnpm",
      "/home/me/.local/share/pnpm/global/5/node_modules/hyperframes/dist/cli.js",
      "pnpm add -g hyperframes@0.9.8",
    ],
    [
      "bun",
      "/home/me/.bun/install/global/node_modules/hyperframes/dist/cli.js",
      "bun add -g hyperframes@0.9.8",
    ],
    [
      "brew",
      "/opt/homebrew/Cellar/hyperframes/0.9.5/libexec/lib/node_modules/hyperframes/dist/cli.js",
      "brew upgrade hyperframes",
    ],
    [
      "npx",
      "/home/me/.npm/_npx/4f1c2a/node_modules/hyperframes/dist/cli.js",
      "npx hyperframes@latest",
    ],
    [
      "npx",
      "/tmp/bunx-1000-hyperframes@latest/node_modules/hyperframes/dist/cli.js",
      "npx hyperframes@latest",
    ],
    [
      "project",
      "/home/me/video/node_modules/hyperframes/dist/cli.js",
      "npm install hyperframes@0.9.8",
    ],
    [
      "project",
      "/home/me/video/node_modules/.pnpm/hyperframes@0.9.5/node_modules/hyperframes/dist/cli.js",
      "npm install hyperframes@0.9.8",
    ],
    ["workspace", "/home/me/hyperframes/packages/cli/dist/cli.js", "npx hyperframes@latest"],
    ["unknown", "/opt/tools/hyperframes/cli.js", "npx hyperframes@latest"],
  ])("classifies a %s install at %s; update with: %s", async (channel, path, command) => {
    const run = await runningAt(path);
    expect(run.install).toEqual({ channel, path });
    expect(run.command).toBe(command);
    expect(run.label).toBeTruthy();
  });

  // `upgrade --project` only rewrites script pins; the dependency moves with the project's manager.
  it.each([
    ["bun.lock", "bun add hyperframes@0.9.8"],
    ["bun.lockb", "bun add hyperframes@0.9.8"],
    ["pnpm-lock.yaml", "pnpm add hyperframes@0.9.8"],
    ["yarn.lock", "yarn add hyperframes@0.9.8"],
    ["package-lock.json", "npm install hyperframes@0.9.8"],
  ])("moves a project-local CLI with the manager its %s names", async (lockfile, command) => {
    const project = mkdtempSync(join(tmpdir(), "hf-project-"));
    writeFileSync(join(project, lockfile), "");
    const run = await runningAt(join(project, "node_modules", "hyperframes", "dist", "cli.js"));
    expect(run.install.channel).toBe("project");
    expect(run.command).toBe(command);
  });

  it("names a plugin install (plugin-cli.mjs marks its pinned npx child) and never an npx command for it", async () => {
    const run = await runningAt("/home/me/.npm/_npx/4f1c2a/node_modules/hyperframes/dist/cli.js");
    vi.stubEnv("HYPERFRAMES_PLUGIN_VERSION", "0.9.5");
    const install = run.mod.runningInstall();
    expect(install.channel).toBe("plugin");
    expect(run.mod.updateCommandFor(install, "0.9.8")).toMatch(/plugin/);
  });
});
