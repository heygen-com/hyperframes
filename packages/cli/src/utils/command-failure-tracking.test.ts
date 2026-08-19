import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandDef } from "citty";

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
