import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";

const ESC = String.fromCharCode(27);
const ODD = `od${ESC}[2Jd\x07`;
const SHOWN = "od\\x1b[2Jd\\x07";

const fake = vi.hoisted(() => ({
  lines: [] as string[],
  missingTool: "" as "" | "git" | "npx",
  copyHint: "",
  checkSkills: vi.fn(),
  presentSkills: vi.fn(),
  foreignSkillNames: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn((command: string, args: ReadonlyArray<string>) => {
    const tool = command === "git" ? "git" : "npx";
    if (fake.missingTool === tool && args.includes("--version")) throw new Error("ENOENT");
    return Buffer.from("11.0.0");
  }),
  spawn: vi.fn(() => {
    const child = new EventEmitter();
    setImmediate(() => child.emit("close", 0, null));
    return child;
  }),
}));
vi.mock("@clack/prompts", () => ({
  log: {
    error: (message: string) => fake.lines.push(message),
    warn: (message: string) => fake.lines.push(message),
  },
}));
vi.mock("../telemetry/events.js", () => ({ trackSkillsInstallSkipped: vi.fn() }));
vi.mock("../utils/appleStubs.js", () => ({ runsWithoutInstallPrompt: () => true }));
vi.mock("../utils/projectCopyHint.js", () => ({ projectCopyHint: () => fake.copyHint }));
vi.mock("../utils/skillsManifest.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/skillsManifest.js")>()),
  checkSkills: fake.checkSkills,
  presentSkills: fake.presentSkills,
  foreignSkillNames: fake.foreignSkillNames,
  hyperframesSkillNames: () => [],
}));
vi.mock("../utils/skillsMirror.js", () => ({
  mirrorGlobalSkills: () => ({ source: null, mirrored: [], skipped: [] }),
}));
vi.mock("../utils/skillsUpdateCheck.js", () => ({ invalidateSkillsCache: vi.fn() }));

const { default: skillsCommand, updateSkills } = await import("./skills.js");

const printed = (): string =>
  fake.lines.join("\n").replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

function expectNoControlCharacters(): void {
  expect(printed()).not.toContain(ESC);
  expect(printed()).not.toContain("\x07");
}

function check(skills: Array<{ name: string; status: string }>): Record<string, unknown> {
  return {
    location: `/skills/${ODD}`,
    agent: `agent-${ODD}`,
    scope: "global",
    updateAvailable: true,
    summary: { current: 0, outdated: 1, missing: 1, coreMissing: 0, removed: 0 },
    skills,
    lockMissing: false,
  };
}

const ODD_MANIFEST = [
  { name: "hyperframes", status: "outdated" },
  { name: `late-${ODD}`, status: "outdated" },
  { name: `more-${ODD}`, status: "missing" },
];

function runSub(name: "check" | "update", positionals: string[] = []): Promise<unknown> {
  const subs = skillsCommand.subCommands as unknown as Record<string, typeof skillsCommand>;
  return Promise.resolve(
    subs[name]!.run?.({ args: { _: positionals }, rawArgs: positionals, cmd: subs[name] } as never),
  );
}

const runBare = (): Promise<unknown> =>
  Promise.resolve(skillsCommand.run?.({ args: {}, rawArgs: [], cmd: skillsCommand } as never));

beforeEach(() => {
  fake.lines.length = 0;
  fake.missingTool = "";
  fake.copyHint = "";
  fake.checkSkills.mockReset().mockResolvedValue(check(ODD_MANIFEST));
  fake.presentSkills.mockReset().mockImplementation((names: readonly string[]) => [...names]);
  fake.foreignSkillNames.mockReset().mockReturnValue([]);
  for (const method of ["log", "error", "warn"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      fake.lines.push(args.join(" "));
    });
});

afterEach(() => {
  consumeCommandResult();
  vi.restoreAllMocks();
});

describe("skills output for people", () => {
  // fails without the fix: the folder, the agent and each listed name are printed as they arrived.
  it("check shows control characters in the location and the listed names as text", async () => {
    await runSub("check");
    expect(printed()).toContain(`/skills/${SHOWN} (agent-${SHOWN})`);
    expect(printed()).toContain(`↑ late-${SHOWN}`);
    expect(printed()).toContain(`◦ more-${SHOWN}`);
    expectNoControlCharacters();
  });

  // fails without the fix: the names the list held are repeated as they arrived.
  it("update shows control characters in a skipped name and the installed list as text", async () => {
    await runSub("update");
    expect(printed()).toContain(`Skipping unexpected skill name(s): late-${SHOWN}`);
    expect(printed()).toContain(`Installed/updated 2 skill(s): hyperframes, late-${SHOWN}`);
    expectNoControlCharacters();
  });

  // fails without the fix: the failure line repeats the names the list held.
  it("update shows control characters in a failure as text", async () => {
    await runSub("update", ["nope"]);
    expect(printed()).toContain(`Update failed: Unknown skill(s): nope. Available: `);
    expect(printed()).toContain(`late-${SHOWN}`);
    expect(consumeCommandResult().exitCode).toBe(1);
    expectNoControlCharacters();
  });

  // fails without the fix: the names still absent are repeated as they arrived.
  it("a bare run shows control characters in the names still missing as text", async () => {
    fake.presentSkills.mockReturnValue([]);
    await runBare();
    expect(printed()).toContain(`Skill(s) still missing after install: hyperframes, late-${SHOWN}`);
    expectNoControlCharacters();
  });

  // fails without the fix: the asked-for name and the list's names are repeated as they arrived.
  it("shows control characters in an unknown name as text", async () => {
    await updateSkills({ requested: [`ask-${ODD}`] });
    expect(printed()).toContain(`Unknown skill(s): ask-${SHOWN}. Available: `);
    expectNoControlCharacters();
  });

  // fails without the fix: the other publisher's name and the names to install are repeated as they arrived.
  it("shows control characters in the lines of a run that cannot reach the list as text", async () => {
    fake.checkSkills.mockRejectedValue(new Error("offline"));
    fake.foreignSkillNames.mockReturnValue([`theirs-${ODD}`]);
    fake.presentSkills.mockReturnValue([]);
    await updateSkills({ requested: [`theirs-${ODD}`, `mine-${ODD}`] });
    expect(printed()).toContain(`Skill(s) owned by another publisher: theirs-${SHOWN}.`);
    expect(printed()).toContain(`attempting a blind install of: mine-${SHOWN}`);
    expectNoControlCharacters();
  });

  // fails without the fix: the path of the unused copy is printed as it is on disk.
  it.each([
    ["git", "Skipping AI coding skills: git not available."],
    ["npx", "npx not found. Install Node.js and retry."],
  ] as const)("shows control characters in the unused %s copy as text", async (tool, line) => {
    fake.missingTool = tool;
    fake.copyHint = ` A copy at ./${ODD}/${tool} was not used.`;
    await runBare();
    expect(printed()).toContain(`${line} A copy at ./${SHOWN}/${tool} was not used.`);
    expectNoControlCharacters();
  });
});
