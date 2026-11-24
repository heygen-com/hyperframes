import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The commands whose own output is about updating (`upgrade`, `skills`) never add
// `_meta.updateNotice`, as `cli.ts` keeps the stderr notices away from them; a notice there
// would contradict the result it sits on.
const state = vi.hoisted(() => ({ dir: "" }));
const config = () => ({
  lastUpdateCheck: new Date().toISOString(),
  latestVersion: "999.0.0",
});

vi.mock("../utils/env.js", () => ({ isDevMode: () => false }));
vi.mock("../telemetry/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../telemetry/config.js")>()),
  get CONFIG_PATH() {
    return join(state.dir, "config.json");
  },
  readConfig: () => config(),
  readConfigFresh: () => config(),
  writeConfig: () => true,
}));
vi.mock("../utils/skillsManifest.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/skillsManifest.js")>()),
  checkSkills: vi.fn(async () => ({
    location: "/home/me/.agents/skills",
    agent: null,
    scope: "global",
    foreign: [],
    ref: "v0.9.6",
    updateAvailable: false,
    skills: [],
    summary: { outdated: 0, missing: 0, coreMissing: 0, current: 0 },
  })),
}));

let stdout: string[] = [];

beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), "hf-notice-commands-"));
  vi.stubEnv("CI", "");
  vi.stubEnv("HYPERFRAMES_NO_UPDATE_CHECK", "");
  vi.stubEnv("HYPERFRAMES_PLUGIN_VERSION", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ version: "999.0.0" }))),
  );
  stdout = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    stdout.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const meta = () => (JSON.parse(stdout.join("\n")) as { _meta: Record<string, unknown> })._meta;

/** citty's `Resolvable`: a value, a promise of it, or a function returning either. */
async function resolve<T>(value: T | Promise<T> | (() => T | Promise<T>)): Promise<T> {
  return typeof value === "function" ? (value as () => T | Promise<T>)() : value;
}

async function run(path: string, args: Record<string, unknown>) {
  const { default: cmd } = await import(path);
  await cmd.run({ args: { _: [], ...args }, rawArgs: [], cmd });
}

describe("_meta.updateNotice on update-related commands", () => {
  it("is due here: a plain withMeta in the same state carries it", async () => {
    const { withMeta } = await import("../utils/updateCheck.js");
    expect(withMeta({ ok: true })._meta.updateNotice).toMatch(/999\.0\.0/);
  });

  it("is absent from upgrade --json, which reports the same update", async () => {
    await run("./upgrade.js", { json: true });
    expect(meta()).toMatchObject({ updateAvailable: true, latestVersion: "999.0.0" });
    expect("updateNotice" in meta()).toBe(false);
  });

  it("is absent from upgrade --project --json", async () => {
    await run("./upgrade.js", { json: true, project: state.dir, check: true });
    expect("updateNotice" in meta()).toBe(false);
  });

  it("is absent from skills check --json, which reports the skills itself", async () => {
    const { default: skills } = await import("./skills.js");
    const subs = await resolve(skills.subCommands);
    const check = await resolve(subs?.["check"]);
    if (!check) throw new Error("skills check not found");
    await check.run?.({ args: { _: [], json: true }, rawArgs: [], cmd: check } as never);
    expect(meta().updateAvailable).toBe(true);
    expect("updateNotice" in meta()).toBe(false);
  });
});
