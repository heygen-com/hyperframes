import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildManifest, FALLBACK_CORE_SKILLS } from "../utils/skillsManifest.js";
import { updateSkills } from "./skills.js";
import { log } from "../ui/prompts.js";

const installer = vi.hoisted(() => ({ run: vi.fn<(args: readonly string[]) => void>() }));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (_cmd: string, _args: readonly string[], _opts: unknown, callback: (err: Error) => void) =>
      callback(new Error("git unavailable in test")),
  ),
  execFileSync: vi.fn(() => Buffer.from("22.0.0")),
  spawn: vi.fn((_cmd: string, args: readonly string[]) => {
    const child = new EventEmitter();
    setImmediate(() => {
      installer.run(args);
      child.emit("close", 0, null);
    });
    return child;
  }),
}));

vi.mock("../telemetry/events.js", () => ({ trackSkillsInstallSkipped: vi.fn() }));
vi.mock("../utils/skillsUpdateCheck.js", () => ({ invalidateSkillsCache: vi.fn() }));

let fixture: string;
let home: string;
let cwd: string;
let source: string;
let store: string;
let cursor: string;
let manifest: ReturnType<typeof buildManifest>;

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function selected(args: readonly string[]): string[] {
  return args.filter((_, index) => args[index - 1] === "--skill");
}

function seedCore(target: string): void {
  mkdirSync(target, { recursive: true });
  for (const name of FALLBACK_CORE_SKILLS)
    cpSync(join(source, name), join(target, name), { recursive: true });
}

function install(args: readonly string[], omit: readonly string[] = []): void {
  const lockPath = join(home, ".agents", ".skill-lock.json");
  const lock: { skills: Record<string, { source: string }> } = existsSync(lockPath)
    ? JSON.parse(readFileSync(lockPath, "utf8"))
    : { skills: {} };
  for (const name of selected(args)) {
    if (omit.includes(name)) continue;
    for (const target of [store, join(home, ".agents", "skills")]) {
      mkdirSync(target, { recursive: true });
      cpSync(join(source, name), join(target, name), { recursive: true });
    }
    lock.skills[name] = { source: "heygen-com/hyperframes" };
  }
  write(lockPath, JSON.stringify(lock));
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "hf-install-target-"));
  home = join(fixture, "home");
  cwd = join(fixture, "project");
  source = join(fixture, "source");
  store = join(home, ".claude", "skills");
  cursor = join(home, ".cursor", "skills");
  mkdirSync(cwd, { recursive: true });
  for (const name of [...FALLBACK_CORE_SKILLS, "remotion-to-hyperframes", "slideshow"]) {
    write(join(source, name, "SKILL.md"), `# ${name}\nCurrent release\n`);
  }
  manifest = buildManifest(source, { source: "heygen-com/hyperframes" });
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  for (const name of ["CLAUDE_CONFIG_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME"])
    vi.stubEnv(name, "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(manifest))),
  );
  installer.run.mockReset();
  installer.run.mockImplementation(install);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(fixture, { recursive: true, force: true });
});

describe("skills update install destination", () => {
  it.each([false, true])(
    "reports a requested foreign skill while offline (strict: %s)",
    async (strict) => {
      seedCore(store);
      const path = join(store, "remotion-to-hyperframes", "SKILL.md");
      write(path, "# Another publisher\n");
      write(
        join(home, ".agents", ".skill-lock.json"),
        JSON.stringify({
          skills: { "remotion-to-hyperframes": { source: "another/publisher" } },
        }),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("offline");
        }),
      );
      const warning = vi.spyOn(log, "warn").mockImplementation(() => {});

      const update = updateSkills({ cwd, requested: ["remotion-to-hyperframes"], strict });

      if (strict) {
        await expect(update).rejects.toThrow(
          "Skill(s) owned by another publisher: remotion-to-hyperframes",
        );
      } else {
        const result = await update;
        expect(result.unknown).toEqual(["remotion-to-hyperframes"]);
        expect(warning).toHaveBeenCalledWith(
          expect.stringContaining("owned by another publisher: remotion-to-hyperframes"),
        );
      }
      expect(installer.run).not.toHaveBeenCalled();
      expect(readFileSync(path, "utf8")).toBe("# Another publisher\n");
    },
  );

  it("installs the core in one run with only Cursor skills present, then becomes a no-op", async () => {
    seedCore(cursor);
    rmSync(join(cursor, "media-use"), { recursive: true });
    const optional = join(cursor, "remotion-to-hyperframes", "SKILL.md");
    write(optional, "# Existing Cursor-only workflow\n");

    const first = await updateSkills({ cwd, refreshInstalled: true, strict: true });

    expect(first.installed.sort()).toEqual([...FALLBACK_CORE_SKILLS].sort());
    for (const name of FALLBACK_CORE_SKILLS) {
      expect(readFileSync(join(store, name, "SKILL.md"), "utf8")).toBe(
        readFileSync(join(source, name, "SKILL.md"), "utf8"),
      );
    }
    expect(existsSync(join(store, "remotion-to-hyperframes"))).toBe(false);
    expect(readFileSync(optional, "utf8")).toBe("# Existing Cursor-only workflow\n");
    if (process.platform !== "win32")
      expect(lstatSync(join(cursor, "hyperframes")).isSymbolicLink()).toBe(true);

    const second = await updateSkills({ cwd, refreshInstalled: true, strict: true });
    expect(second.installed).toEqual([]);
    expect(installer.run).toHaveBeenCalledTimes(1);
  });

  it("still refreshes an optional skill already installed in the managed store", async () => {
    seedCore(store);
    write(join(store, "remotion-to-hyperframes", "SKILL.md"), "# Stale workflow\n");

    const result = await updateSkills({ cwd, refreshInstalled: true, strict: true });

    expect(result.installed).toEqual(["remotion-to-hyperframes"]);
    expect(readFileSync(join(store, "remotion-to-hyperframes", "SKILL.md"), "utf8")).toBe(
      readFileSync(join(source, "remotion-to-hyperframes", "SKILL.md"), "utf8"),
    );
    expect(existsSync(join(store, "slideshow"))).toBe(false);
  });

  it.each([false, true])(
    "preserves another publisher's skill outside the target store (offline: %s)",
    async (offline) => {
      write(join(cursor, "hyperframes", "SKILL.md"), "# Another publisher\n");
      write(
        join(home, ".agents", ".skill-lock.json"),
        JSON.stringify({
          skills: { hyperframes: { source: "another/publisher" } },
        }),
      );

      if (offline)
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            throw new Error("offline");
          }),
        );
      const result = await updateSkills({
        cwd,
        requested: ["slideshow"],
        refreshInstalled: true,
        strict: true,
      });

      expect(result.targets).not.toContain("hyperframes");
      expect(readFileSync(join(cursor, "hyperframes", "SKILL.md"), "utf8")).toBe(
        "# Another publisher\n",
      );
      expect(existsSync(join(store, "hyperframes"))).toBe(false);
    },
  );

  it("does not accept Cursor's copies as proof that the destination install succeeded", async () => {
    seedCore(cursor);
    installer.run.mockImplementation((args) => install(args, ["hyperframes", "hyperframes-cli"]));

    await expect(updateSkills({ cwd, refreshInstalled: true, strict: true })).rejects.toThrow(
      "Skill(s) still missing after install: hyperframes, hyperframes-cli",
    );
  });

  it("checks the write destination during the offline presence-only fallback too", async () => {
    seedCore(cursor);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    const result = await updateSkills({ cwd, requested: ["slideshow"], strict: true });

    expect(result.presenceOnly).toBe(true);
    expect(result.installed.sort()).toEqual(["slideshow", ...FALLBACK_CORE_SKILLS].sort());
    for (const name of result.targets) expect(existsSync(join(store, name, "SKILL.md"))).toBe(true);
  });

  it("uses CLAUDE_CONFIG_DIR even when the command runs from HOME", async () => {
    store = join(home, "custom-claude", "skills");
    vi.stubEnv("CLAUDE_CONFIG_DIR", dirname(store));
    write(
      join(home, ".agents", ".skill-lock.json"),
      JSON.stringify({
        skills: { "remotion-to-hyperframes": { source: "another/publisher" } },
      }),
    );
    seedCore(store);
    write(join(store, "remotion-to-hyperframes", "SKILL.md"), "# Another publisher\n");

    const result = await updateSkills({ cwd: home, refreshInstalled: true, strict: true });

    expect(result.installed).toEqual([]);
    expect(result.targets).not.toContain("remotion-to-hyperframes");
    expect(installer.run).not.toHaveBeenCalled();
  });
});
