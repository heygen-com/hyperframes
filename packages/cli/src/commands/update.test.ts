// `hyperframes update`: one forced check of the CLI and the skills, then the
// install the way `upgrade --yes` and `skills update` do it. Install detection,
// the upgrade argv and the skills install run for real per install channel;
// only spawn, the config file, the manifest fetch/disk and the registry are stubbed.

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The package-manager binaries a CLI upgrade runs; npx (cmd.exe on Windows) and git are the skills tooling.
const INSTALLERS = vi.hoisted(() => new Set(["npm", "pnpm", "bun", "brew"]));

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  execCalls: [] as { command: string; args: readonly string[]; opts: unknown }[],
  spawnCalls: [] as { command: string; args: readonly string[] }[],
  installFails: false,
  registryLatest: "0.9.8" as string | null,
  // What Homebrew's linked binary reports after `brew upgrade` (null: it cannot be read).
  brewInstalled: "0.9.8" as string | null,
  fetchedUrls: [] as string[],
}));

vi.mock("../version.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../version.js")>()),
  VERSION: "0.9.5",
}));

vi.mock("../telemetry/config.js", () => ({
  CONFIG_PATH: "/nonexistent/hf-update-test/config.json",
  readConfig: () => ({ ...state.config }),
  readConfigFresh: () => ({ ...state.config }),
  writeConfig: (next: Record<string, unknown>) => {
    state.config = { ...next };
    return true;
  },
}));

vi.mock("../telemetry/events.js", () => ({ trackSkillsInstallSkipped: vi.fn() }));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn((command: string, args: readonly string[], opts: unknown) => {
    state.execCalls.push({ command, args, opts });
    if (command === "brew" && args[0] === "--prefix") return "/opt/homebrew/opt/hyperframes\n";
    if (command.replaceAll("\\", "/") === "/opt/homebrew/opt/hyperframes/bin/hyperframes") {
      if (state.brewInstalled === null) throw new Error("not linked");
      return `${state.brewInstalled}\n`;
    }
    if (state.installFails && INSTALLERS.has(command)) throw new Error("boom");
    return Buffer.from("11.0.0");
  }),
  spawn: vi.fn((command: string, args: readonly string[]) => {
    state.spawnCalls.push({ command, args });
    const child = new EventEmitter();
    setImmediate(() => child.emit("close", 0, null));
    return child;
  }),
}));

const OUTDATED_CHECK = {
  location: "/home/user/.claude/skills",
  agent: "claude-code",
  scope: "global",
  updateAvailable: true,
  summary: { current: 1, outdated: 2, missing: 0, coreMissing: 0, removed: 0 },
  skills: [
    { name: "hyperframes", status: "outdated" },
    { name: "hyperframes-registry", status: "outdated" },
    { name: "figma", status: "current" },
  ],
  foreign: [],
  ref: "v0.9.5",
};

vi.mock("../utils/skillsManifest.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/skillsManifest.js")>()),
  // The manifest is read at the requested CLI version's release tag, as the real check does.
  checkSkills: vi.fn(async (opts: { cliVersion?: string }) => ({
    ...OUTDATED_CHECK,
    ref: `v${opts.cliVersion}`,
  })),
  hyperframesSkillNames: vi.fn(() => ["hyperframes"]),
  presentSkills: vi.fn((names: readonly string[]) => [...names]),
}));
vi.mock("../utils/skillsMirror.js", () => ({
  mirrorGlobalSkills: vi.fn(() => ({ source: null, mirrored: [], skipped: [] })),
}));

const ENTRIES = {
  npm: "/usr/local/lib/node_modules/hyperframes/dist/cli.js",
  pnpm: "/home/me/.local/share/pnpm/global/5/node_modules/hyperframes/dist/cli.js",
  bun: "/home/me/.bun/install/global/node_modules/hyperframes/dist/cli.js",
  brew: "/opt/homebrew/Cellar/hyperframes/0.9.5/libexec/lib/node_modules/hyperframes/dist/cli.js",
  npx: "/home/me/.npm/_npx/4f1c2a/node_modules/hyperframes/dist/cli.js",
  project: "/home/me/video/node_modules/hyperframes/dist/cli.js",
} as const;

const originalArgv = [...process.argv];
let stdout: string[];

async function runUpdate(entry: string, args: Record<string, unknown>) {
  process.argv = [process.argv[0] ?? "node", entry];
  const { default: cmd } = await import("./update.js");
  await cmd.run?.({ args: { _: [], ...args }, rawArgs: [], cmd } as never);
  const { consumeCommandResult } = await import("../utils/commandResult.js");
  return consumeCommandResult().exitCode;
}

const json = () => JSON.parse(stdout.join("\n")) as Record<string, any>;
const installs = () =>
  state.execCalls.filter((c) => INSTALLERS.has(c.command) && c.args[0] !== "--prefix");
const skillsAdds = () => state.spawnCalls.filter((c) => c.args.includes("add"));

beforeEach(() => {
  vi.resetModules();
  state.config = {};
  state.execCalls = [];
  state.spawnCalls = [];
  state.installFails = false;
  state.registryLatest = "0.9.8";
  state.brewInstalled = "0.9.8";
  state.fetchedUrls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      state.fetchedUrls.push(String(url));
      return state.registryLatest
        ? ({ ok: true, json: async () => ({ version: state.registryLatest }) } as Response)
        : ({ ok: false, status: 503 } as Response);
    }),
  );
  for (const name of [
    "HYPERFRAMES_PLUGIN_VERSION",
    "HYPERFRAMES_SKIP_SKILLS",
    "HYPERFRAMES_AGENT",
  ]) {
    vi.stubEnv(name, "");
  }
  stdout = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void stdout.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.argv = [...originalArgv];
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("hyperframes update --check", () => {
  it("reports the CLI (fresh from npm, past the cache) and the skills in one JSON call, installing nothing", async () => {
    // A cache that says "current" and is only minutes old must not answer `update`.
    state.config = { latestVersion: "0.9.5", lastUpdateCheck: new Date().toISOString() };

    expect(await runUpdate(ENTRIES.npm, { check: true, json: true })).toBe(0);

    const out = json();
    expect(state.fetchedUrls).toEqual(["https://registry.npmjs.org/hyperframes/latest"]);
    expect(out.cli).toMatchObject({
      current: "0.9.5",
      latest: "0.9.8",
      updateAvailable: true,
      install: { channel: "npm", path: ENTRIES.npm },
      command: "npm install -g hyperframes@0.9.8",
    });
    expect(out.cli.checkedAt).toEqual(expect.any(String));
    expect(out.skills).toMatchObject({
      status: "checked",
      ref: "v0.9.5",
      outdated: 2,
      updateAvailable: true,
      // The global CLI runs its own update: `npx hyperframes` could run another copy.
      command: "hyperframes update",
    });
    expect(out._meta).toMatchObject({
      latestVersion: "0.9.8",
      updateAvailable: true,
      skillsOutdated: 2,
    });
    expect(installs()).toEqual([]);
    expect(skillsAdds()).toEqual([]);
  });

  it("reads the skills manifest at this CLI's release tag", async () => {
    const { checkSkills } = await import("../utils/skillsManifest.js");
    await runUpdate(ENTRIES.npm, { check: true, json: true });
    expect(checkSkills).toHaveBeenCalledWith({ canonical: true, cliVersion: "0.9.5" });
  });

  it("says when npm was not reached instead of passing the cache off as fresh", async () => {
    state.registryLatest = null;
    await runUpdate(ENTRIES.npm, { check: true, json: true });
    expect(json().cli).toMatchObject({ updateAvailable: false, checkedAt: null });
  });

  it("does not call the CLI latest when npm was not reached", async () => {
    state.registryLatest = null;
    await runUpdate(ENTRIES.npm, { check: true });
    const text = stdout.join("\n");
    expect(text).toContain("(npm registry not reached)");
    expect(text).not.toContain("latest");
  });

  it.each([
    ["npm", ENTRIES.npm, "npm install -g hyperframes@0.9.8"],
    ["pnpm", ENTRIES.pnpm, "pnpm add -g hyperframes@0.9.8"],
    ["bun", ENTRIES.bun, "bun add -g hyperframes@0.9.8"],
    ["brew", ENTRIES.brew, "brew upgrade hyperframes"],
    ["npx", ENTRIES.npx, "npx hyperframes@latest"],
    ["project", ENTRIES.project, "npm install hyperframes@0.9.8"],
  ])("names the %s install and the command that updates it", async (channel, entry, command) => {
    await runUpdate(entry, { check: true, json: true });
    expect(json().cli.install).toEqual({ channel, path: entry });
    expect(json().cli.command).toBe(command);
  });

  it("reports a plugin install as plugin-managed, and does not check its pinned skills", async () => {
    vi.stubEnv("HYPERFRAMES_PLUGIN_VERSION", "0.9.5");
    vi.stubEnv("HYPERFRAMES_SKIP_SKILLS", "1");
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockClear();

    expect(await runUpdate(ENTRIES.npx, { check: true, json: true })).toBe(0);

    expect(json().cli.install.channel).toBe("plugin");
    expect(json().cli.command).toMatch(/plugin/);
    expect(json().skills.status).toBe("skipped");
    expect(checkSkills).not.toHaveBeenCalled();
  });
});

describe("hyperframes update (install)", () => {
  it("asks for --yes in an unattended run instead of installing", async () => {
    vi.stubEnv("HYPERFRAMES_AGENT", "1");
    await expect(runUpdate(ENTRIES.npm, { json: true })).rejects.toThrow(/confirmation/);
    expect(installs()).toEqual([]);
    expect(state.fetchedUrls).toEqual([]);
  });

  it.each([
    ["npm", ENTRIES.npm, "npm", ["install", "-g", "hyperframes@0.9.8"]],
    ["pnpm", ENTRIES.pnpm, "pnpm", ["add", "-g", "hyperframes@0.9.8"]],
    ["bun", ENTRIES.bun, "bun", ["add", "-g", "hyperframes@0.9.8"]],
    // Explicit: the user asked, so brew may move to the formula (unlike auto-update); here it reached npm.
    ["brew", ENTRIES.brew, "brew", ["upgrade", "hyperframes"]],
  ])(
    "%s: upgrades the CLI like upgrade --yes, then installs the skills at the new CLI's tag",
    async (_channel, entry, bin, args) => {
      expect(await runUpdate(entry, { yes: true, json: true })).toBe(0);

      expect(installs()).toHaveLength(1);
      expect(installs()[0]).toMatchObject({ command: bin, args });
      // The child's stdout goes to stderr: a --json stdout stays one parseable object.
      expect(installs()[0]!.opts).toMatchObject({ shell: false, stdio: ["inherit", 2, 2] });
      expect(skillsAdds()).toHaveLength(1);
      expect(skillsAdds()[0]!.args).toContain("https://github.com/heygen-com/hyperframes#v0.9.8");
      expect(json().updated).toMatchObject({
        cli: { status: "upgraded", version: "0.9.8" },
        skills: { status: "updated" },
      });
    },
  );

  it.each([
    ["npx", ENTRIES.npx, "npx hyperframes@latest"],
    // The project's manager moves its dependency, as `--check` names it.
    ["project", ENTRIES.project, "npm install hyperframes@0.9.8"],
  ])(
    "%s: installs no CLI, names %s, refreshes the skills at its own tag",
    async (_channel, entry, command) => {
      expect(await runUpdate(entry, { yes: true, json: true })).toBe(0);
      expect(installs()).toEqual([]);
      expect(json().updated.cli).toMatchObject({ status: "manual", command });
      expect(skillsAdds()[0]!.args).toContain("https://github.com/heygen-com/hyperframes#v0.9.5");
    },
  );

  // `brew upgrade` installs the formula's version, which lags npm, and exits 0 on a no-op: the
  // skills must follow the CLI that is actually installed, never npm's latest.
  it("brew staying behind npm: reports the CLI unchanged and keeps the skills at its own tag", async () => {
    state.brewInstalled = "0.9.5";
    expect(await runUpdate(ENTRIES.brew, { yes: true, json: true })).toBe(0);

    expect(json().updated.cli).toMatchObject({ status: "unchanged", version: "0.9.5" });
    expect(json().updated.cli.reason).toContain("0.9.8");
    const adds = skillsAdds().flatMap((c) => c.args);
    expect(adds).not.toContain("https://github.com/heygen-com/hyperframes#v0.9.8");
    expect(adds).toContain("https://github.com/heygen-com/hyperframes#v0.9.5");
  });

  it("brew moving to a formula between the two: skills at the version brew installed", async () => {
    state.brewInstalled = "0.9.7";
    expect(await runUpdate(ENTRIES.brew, { yes: true, json: true })).toBe(0);
    expect(json().updated.cli).toMatchObject({ status: "upgraded", version: "0.9.7" });
    expect(skillsAdds()[0]!.args).toContain("https://github.com/heygen-com/hyperframes#v0.9.7");
  });

  it("brew whose installed version cannot be read: says so and keeps the skills at this CLI's tag", async () => {
    state.brewInstalled = null;
    expect(await runUpdate(ENTRIES.brew, { yes: true, json: true })).toBe(0);
    expect(json().updated.cli).toMatchObject({ status: "unverified" });
    expect(skillsAdds()[0]!.args).toContain("https://github.com/heygen-com/hyperframes#v0.9.5");
  });

  it("plugin: refuses, installing neither the CLI nor the skills", async () => {
    vi.stubEnv("HYPERFRAMES_PLUGIN_VERSION", "0.9.5");
    vi.stubEnv("HYPERFRAMES_SKIP_SKILLS", "1");
    expect(await runUpdate(ENTRIES.npx, { yes: true, json: true })).toBe(1);
    expect(json()).toMatchObject({ ok: false, error: { code: "plugin_managed" } });
    expect(installs()).toEqual([]);
    expect(skillsAdds()).toEqual([]);
    expect(state.fetchedUrls).toEqual([]);
  });

  it("HYPERFRAMES_SKIP_SKILLS leaves the skills alone while the CLI still updates", async () => {
    vi.stubEnv("HYPERFRAMES_SKIP_SKILLS", "1");
    expect(await runUpdate(ENTRIES.npm, { yes: true, json: true })).toBe(0);
    expect(installs()).toHaveLength(1);
    expect(skillsAdds()).toEqual([]);
    expect(json().updated.skills.status).toBe("skipped");
  });

  it("a failed CLI install exits 1 and says what to run", async () => {
    state.installFails = true;
    expect(await runUpdate(ENTRIES.npm, { yes: true, json: true })).toBe(1);
    expect(json().updated.cli).toMatchObject({
      status: "failed",
      command: "npm install -g hyperframes@0.9.8",
    });
  });

  it("installs nothing when the CLI and its skills are current", async () => {
    state.registryLatest = "0.9.5";
    const { checkSkills } = await import("../utils/skillsManifest.js");
    vi.mocked(checkSkills).mockResolvedValueOnce({
      ...OUTDATED_CHECK,
      updateAvailable: false,
      summary: { ...OUTDATED_CHECK.summary, outdated: 0, current: 3 },
    } as never);
    expect(await runUpdate(ENTRIES.npm, { yes: true, json: true })).toBe(0);
    expect(installs()).toEqual([]);
    expect(skillsAdds()).toEqual([]);
    expect(json().updated).toEqual({ cli: { status: "current" }, skills: { status: "current" } });
  });
});
