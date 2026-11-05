// `doctor` names the binary that is running and where it lives, and its update hint is the
// command for that install: the manager's for a global one, `npx hyperframes@latest` for npx.
// The install detection is real; only the resolved entry path and the cached latest are stubbed.

import { afterEach, describe, expect, it, vi } from "vitest";

const ENTRIES = {
  npm: "/usr/local/lib/node_modules/hyperframes/dist/cli.js",
  brew: "/opt/homebrew/Cellar/hyperframes/0.9.5/libexec/lib/node_modules/hyperframes/dist/cli.js",
  npx: "/home/me/.npm/_npx/4f1c2a/node_modules/hyperframes/dist/cli.js",
  project: "/home/me/video/node_modules/hyperframes/dist/cli.js",
} as const;

const originalArgv1 = process.argv[1];

async function doctorAt(entry: string, latestVersion: string | undefined) {
  vi.resetModules();
  vi.stubEnv("HYPERFRAMES_PLUGIN_VERSION", "");
  vi.doMock("node:fs", async () => ({
    ...(await vi.importActual<typeof import("node:fs")>("node:fs")),
    realpathSync: () => entry,
  }));
  vi.doMock("../utils/updateCheck.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../utils/updateCheck.js")>()),
    getUpdateMeta: () => ({
      version: "0.9.5",
      latestVersion,
      updateAvailable: latestVersion !== undefined && latestVersion !== "0.9.5",
    }),
  }));
  vi.doMock("../version.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../version.js")>()),
    VERSION: "0.9.5",
  }));
  process.argv[1] = "/usr/local/bin/hyperframes";
  return import("./doctor.js");
}

afterEach(() => {
  process.argv[1] = originalArgv1 ?? "";
  vi.doUnmock("node:fs");
  vi.doUnmock("../utils/updateCheck.js");
  vi.doUnmock("../version.js");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("doctor: the running binary", () => {
  it.each([
    ["npm", ENTRIES.npm, "npm global install"],
    ["brew", ENTRIES.brew, "Homebrew install"],
    ["npx", ENTRIES.npx, "npx"],
    ["project", ENTRIES.project, "project-local install"],
  ])("names a %s binary and its path", async (_channel, entry, label) => {
    const { checkInstall } = await doctorAt(entry, "0.9.5");
    const result = checkInstall();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain(label);
    expect(result.detail).toContain(entry);
  });

  it("names a plugin run as plugin-pinned", async () => {
    const { checkInstall } = await doctorAt(ENTRIES.npx, "0.9.5");
    vi.stubEnv("HYPERFRAMES_PLUGIN_VERSION", "0.9.5");
    expect(checkInstall().detail).toContain("agent plugin");
  });
});

describe("doctor: the update hint fits the install", () => {
  it.each([
    ["npm", ENTRIES.npm, "Run: npm install -g hyperframes@0.9.8"],
    ["brew", ENTRIES.brew, "Run: brew upgrade hyperframes"],
    ["npx", ENTRIES.npx, "Run: npx hyperframes@latest"],
    ["project", ENTRIES.project, "Run: npm install hyperframes@0.9.8"],
  ])("%s", async (_channel, entry, hint) => {
    const { checkVersion } = await doctorAt(entry, "0.9.8");
    expect(checkVersion()).toEqual({ ok: false, detail: "0.9.5 → 0.9.8 available", hint });
  });

  it("does not claim 'latest' before any check has answered", async () => {
    const { checkVersion } = await doctorAt(ENTRIES.npm, undefined);
    expect(checkVersion()).toEqual({ ok: true, detail: "0.9.5 (not checked yet)" });
  });
});
