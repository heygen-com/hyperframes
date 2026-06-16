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
  it("reports the error and re-throws when run() rejects", async () => {
    const onFailure = vi.fn();
    const boom = new Error("ffmpeg not found");
    const wrapped = trackCommandFailures(
      () => Promise.resolve(defineRun(() => Promise.reject(boom))),
      onFailure,
    );

    const cmd = await wrapped();
    await expect((cmd.run as () => Promise<unknown>)()).rejects.toBe(boom);
    expect(onFailure).toHaveBeenCalledWith(boom);
  });

  it("does not report when run() succeeds, and returns its value", async () => {
    const onFailure = vi.fn();
    const wrapped = trackCommandFailures(
      () => Promise.resolve(defineRun(() => Promise.resolve("ok" as unknown as void))),
      onFailure,
    );

    const cmd = await wrapped();
    await expect((cmd.run as () => Promise<unknown>)()).resolves.toBe("ok");
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("passes through a command with no run() untouched", async () => {
    const onFailure = vi.fn();
    const parent: CommandDef = { meta: { name: "parent" } };
    const wrapped = trackCommandFailures(() => Promise.resolve(parent), onFailure);

    const cmd = await wrapped();
    expect(cmd).toBe(parent);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("awaits onFailure and re-throws the ORIGINAL error even if onFailure rejects", async () => {
    const boom = new Error("original failure");
    const wrapped = trackCommandFailures(
      () => Promise.resolve(defineRun(() => Promise.reject(boom))),
      () => Promise.reject(new Error("telemetry is down")),
    );

    const cmd = await wrapped();
    await expect((cmd.run as () => Promise<unknown>)()).rejects.toBe(boom);
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
