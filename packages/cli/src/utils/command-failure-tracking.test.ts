import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand, type CommandDef } from "citty";
import { CliUsageError } from "./commandResult.js";
import { resolveExtraPositionals } from "./reject-extra-positionals.js";

const trackCommandFailure = vi.fn();
vi.mock("../telemetry/events.js", () => ({
  trackCommandFailure: (...args: unknown[]) => trackCommandFailure(...args),
}));

const { trackCommandFailures, reportCommandFailure } =
  await import("./command-failure-tracking.js");

function defineRun(run: CommandDef["run"]): CommandDef {
  return { meta: { name: "test" }, run };
}

describe("trackCommandFailures", () => {
  it("re-throws when run() rejects so the executable boundary can report it", async () => {
    const boom = new Error("ffmpeg not found");
    const wrapped = trackCommandFailures(() =>
      Promise.resolve(defineRun(() => Promise.reject(boom))),
    );

    const cmd = await wrapped();
    await expect((cmd.run as () => Promise<unknown>)()).rejects.toBe(boom);
  });

  it("returns the command value when run() succeeds", async () => {
    const wrapped = trackCommandFailures(() =>
      Promise.resolve(defineRun(() => Promise.resolve("ok" as unknown as void))),
    );

    const cmd = await wrapped();
    await expect((cmd.run as () => Promise<unknown>)()).resolves.toBe("ok");
  });

  it("rejects an unknown flag on a leaf command", async () => {
    const wrapped = trackCommandFailures(() =>
      Promise.resolve({
        meta: { name: "leaf" },
        args: { out: { type: "string" } },
        run: () => Promise.resolve(),
      } as CommandDef),
    );
    const cmd = await wrapped();
    await expect(
      (cmd.run as (ctx: unknown) => Promise<unknown>)({ rawArgs: ["--bogus", "x"] }),
    ).rejects.toThrow(/--bogus/);
  });

  it("skips the unknown-flag check when a command group delegates to a subcommand", async () => {
    // `figma component <ref> --name x`: --name belongs to the subcommand's
    // table; the group (subCommands + fallback-help run) must not reject it.
    const run = vi.fn(() => Promise.resolve());
    const wrapped = trackCommandFailures(() =>
      Promise.resolve({
        meta: { name: "figma" },
        subCommands: { component: () => Promise.resolve({ meta: { name: "component" } }) },
        run,
      } as unknown as CommandDef),
    );
    const cmd = await wrapped();
    await expect(
      (cmd.run as (ctx: unknown) => Promise<unknown>)({
        rawArgs: ["component", "KEY:1-2", "--name", "hero"],
      }),
    ).resolves.toBeUndefined();
    expect(run).toHaveBeenCalled();
  });

  it("still rejects an unknown flag when the group is NOT delegating", async () => {
    const wrapped = trackCommandFailures(() =>
      Promise.resolve({
        meta: { name: "figma" },
        subCommands: { component: () => Promise.resolve({ meta: { name: "component" } }) },
        run: () => Promise.resolve(),
      } as unknown as CommandDef),
    );
    const cmd = await wrapped();
    await expect(
      (cmd.run as (ctx: unknown) => Promise<unknown>)({ rawArgs: ["--bogus"] }),
    ).rejects.toThrow(/--bogus/);
  });

  it("passes through a command with no run() untouched", async () => {
    const parent: CommandDef = { meta: { name: "parent" } };
    const wrapped = trackCommandFailures(() => Promise.resolve(parent));

    const cmd = await wrapped();
    expect(cmd).toBe(parent);
  });

  it("re-throws an unknown-flag rejection to the executable boundary", async () => {
    const cmd = {
      meta: { name: "render" },
      args: { output: { type: "string", alias: "o" } },
      run: vi.fn(() => Promise.resolve()),
    } as unknown as CommandDef;
    const wrapped = trackCommandFailures(() => Promise.resolve(cmd));

    const resolved = await wrapped();
    await expect(
      (resolved.run as (ctx: unknown) => Promise<unknown>)({ rawArgs: ["--nope", "x"] }),
    ).rejects.toThrow(/unknown flag/i);
    expect(cmd.run).not.toHaveBeenCalled(); // body never ran — flag rejected first
  });

  it("recursively wraps nested subcommands so their failures reach the boundary", async () => {
    const boom = new Error("nested boom");
    const group: CommandDef = {
      meta: { name: "cloud" },
      subCommands: {
        render: defineRun(() => Promise.reject(boom)),
      },
    };
    const wrapped = trackCommandFailures(() => Promise.resolve(group));

    const resolvedGroup = await wrapped();
    const subLoader = (resolvedGroup.subCommands as Record<string, () => Promise<CommandDef>>)
      .render;
    if (!subLoader) throw new Error("expected a wrapped 'render' subcommand loader");
    const leaf = await subLoader();
    await expect((leaf.run as () => Promise<unknown>)()).rejects.toBe(boom);
  });
});

describe("trackCommandFailures: extra positionals", () => {
  const leaf = (name: string, run = vi.fn()): CommandDef =>
    ({
      meta: { name },
      args: {
        dir: { type: "positional", required: false },
        json: { type: "boolean", default: false },
      },
      run,
    }) as CommandDef;
  const wrap = (cmd: CommandDef) => trackCommandFailures(() => Promise.resolve(cmd))();
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const tempDirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-join-"));
    tempDirs.push(dir);
    return dir;
  };

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("throws a presented error whose message carries a count, never the arguments", async () => {
    const error = await runCommand(await wrap(leaf("render")), {
      rawArgs: ["./proj", "secret-launch", "Jane"],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliUsageError);
    expect((error as CliUsageError).result.presented).toBe(true);
    expect((error as Error).message).toBe("2 unexpected extra arguments for hyperframes render");
  });

  it("labels a required positional <NAME> and an optional one [NAME]", async () => {
    const cmd = {
      meta: { name: "keyframes" },
      args: { file: { type: "positional" }, at: { type: "positional", required: false } },
      run: vi.fn(),
    };
    await expect(
      runCommand(await wrap(cmd as CommandDef), { rawArgs: ["a", "b", "c"] }),
    ).rejects.toThrow(CliUsageError);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain(
      "Usage: hyperframes keyframes <FILE> [AT]",
    );
  });

  it.each([
    ["figma asset", () => import("../commands/figma/asset.js")],
    [
      "skills update",
      async () => ({
        default: (await import("../commands/skills.js")).default.subCommands!.update,
      }),
    ],
  ])("lets the real %s command read several positionals", async (path, load) => {
    const def = (await (load as () => Promise<{ default: unknown }>)()).default;
    const cmd = (typeof def === "function" ? await def() : def) as CommandDef;
    const parsed: Record<string, unknown> = { _: ["one", "two", "three"] };
    expect(() => resolveExtraPositionals(cmd, path as string, parsed, [])).not.toThrow();
  });

  it("rejects a leaf's extra positional, naming it and the usage line, before run()", async () => {
    const run = vi.fn();
    await expect(
      runCommand(await wrap(leaf("render", run)), { rawArgs: ["./proj", "out.mp4"] }),
    ).rejects.toThrow(CliUsageError);
    expect(run).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls.flat().join("\n")).toBe(
      "Unexpected extra argument for hyperframes render: out.mp4\nUsage: hyperframes render [DIR] [OPTIONS]",
    );
  });

  it.each(["--json", "--json=true", "--json=1"])(
    "reports the rejection as JSON on stdout under %s",
    async (flag) => {
      await expect(
        runCommand(await wrap(leaf("lint")), { rawArgs: ["a", "b", flag] }),
      ).rejects.toThrow(CliUsageError);
      expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toEqual({
        ok: false,
        error:
          "Unexpected extra argument for hyperframes lint: b\nUsage: hyperframes lint [DIR] [OPTIONS]",
      });
    },
  );

  it("rejects instead of joining when the first word names a file", async () => {
    const run = vi.fn();
    const file = join(tempDir(), "script.txt");
    writeFileSync(file, "hello");
    await expect(
      runCommand(await wrap(leaf("tts", run)), { rawArgs: [file, "extra"] }),
    ).rejects.toThrow(CliUsageError);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("hyperframes tts: extra");
    expect(run).not.toHaveBeenCalled();
  });

  it("still joins catalog words when the first one names a folder", async () => {
    const run = vi.fn();
    const folder = tempDir();
    await runCommand(await wrap(leaf("catalog", run)), { rawArgs: [folder, "player"] });
    expect(run.mock.calls[0]![0].args.dir).toBe(`${folder} player`);
  });

  it.each(["catalog", "tts"])(
    "joins %s's trailing words into its last positional",
    async (name) => {
      const run = vi.fn();
      await runCommand(await wrap(leaf(name, run)), { rawArgs: ["lower", "third", "--json"] });
      expect(run.mock.calls[0]![0].args.dir).toBe("lower third");
    },
  );

  it("reports JSON under --json=true for a command that declares no json flag", async () => {
    const bare = {
      meta: { name: "snapshot" },
      args: { dir: { type: "positional" } },
      run: vi.fn(),
    };
    await expect(
      runCommand(await wrap(bare as CommandDef), { rawArgs: ["a", "b", "--json=true"] }),
    ).rejects.toThrow(CliUsageError);
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({ ok: false });
  });

  it("runs a leaf given no more positionals than it declares", async () => {
    const run = vi.fn();
    await runCommand(await wrap(leaf("lint", run)), { rawArgs: ["a", "--json"] });
    expect(run).toHaveBeenCalledOnce();
  });

  it("names a nested subcommand by its full path", async () => {
    const group = {
      meta: { name: "cloud" },
      subCommands: { get: leaf("get") },
      run: vi.fn(),
    } as CommandDef;
    await expect(runCommand(await wrap(group), { rawArgs: ["get", "id1", "id2"] })).rejects.toThrow(
      CliUsageError,
    );
    expect(errorSpy.mock.calls.flat().join("\n")).toContain(
      "hyperframes cloud get: id2\nUsage: hyperframes cloud get [DIR]",
    );
  });

  it("lets an opted-out command read extra positionals", async () => {
    const run = vi.fn();
    await runCommand(await wrap(leaf("compare", run)), { rawArgs: ["a", "b", "c"] });
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not count the subcommand name against the group citty also runs", async () => {
    const run = vi.fn();
    const sub = vi.fn();
    const group = { meta: { name: "auth" }, subCommands: { status: leaf("status", sub) }, run };
    await runCommand(await wrap(group as CommandDef), { rawArgs: ["status", "--json"] });
    expect(sub).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("reportCommandFailure", () => {
  beforeEach(() => {
    trackCommandFailure.mockReset();
  });

  it("forwards the command and error to trackCommandFailure", async () => {
    const err = new Error("ENOENT /Users/me/project/index.html");
    await reportCommandFailure("info", err);
    expect(trackCommandFailure).toHaveBeenCalledWith("info", err);
  });

  it("never throws when the telemetry call throws", async () => {
    trackCommandFailure.mockImplementationOnce(() => {
      throw new Error("telemetry blew up");
    });
    await expect(reportCommandFailure("browser", new Error("x"))).resolves.toBeUndefined();
  });
});
