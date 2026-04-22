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
