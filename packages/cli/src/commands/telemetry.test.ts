import { afterEach, describe, expect, it, vi } from "vitest";

const baseConfig = {
  telemetryEnabled: true,
  anonymousId: "test-install",
  telemetryNoticeShown: true,
  commandCount: 7,
  renderSuccessCount: 0,
  lastFeedbackPromptAt: 0,
};

async function loadTelemetryCommand(options?: {
  writeSucceeds?: boolean;
  configEnabled?: boolean;
}) {
  const config = {
    ...baseConfig,
    telemetryEnabled: options?.configEnabled ?? true,
  };
  const writeConfig = vi.fn(() => options?.writeSucceeds ?? true);
  vi.resetModules();
  vi.doMock("../telemetry/config.js", () => ({
    CONFIG_PATH: "/test/.hyperframes/config.json",
    readConfig: () => {
      throw new Error("telemetry commands must bypass stale cached config");
    },
    readConfigFresh: () => ({ ...config }),
    writeConfig,
  }));
  const module = await import("./telemetry.js");
  return { command: module.default, writeConfig };
}

async function runSubcommand(
  command: Awaited<ReturnType<typeof loadTelemetryCommand>>["command"],
  subcommand: string,
): Promise<void> {
  await command.run?.({
    args: { subcommand },
    rawArgs: [subcommand],
    cmd: command,
  } as never);
}

describe("telemetry command", () => {
  afterEach(() => {
    vi.doUnmock("../telemetry/config.js");
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env["HYPERFRAMES_NO_TELEMETRY"];
    delete process.env["DO_NOT_TRACK"];
  });

  it("persists disable from a fresh config snapshot", async () => {
    const { command, writeConfig } = await loadTelemetryCommand();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runSubcommand(command, "disable");

    expect(writeConfig).toHaveBeenCalledWith(expect.objectContaining({ telemetryEnabled: false }));
  });

  it("fails instead of claiming success when the preference cannot be persisted", async () => {
    const { command } = await loadTelemetryCommand({ writeSucceeds: false });
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runSubcommand(command, "disable")).rejects.toMatchObject({
      name: "CliRuntimeError",
    });

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Could not persist"));
    expect(stdout).not.toHaveBeenCalledWith(expect.stringContaining("Telemetry disabled"));
  });

  it("reports the effective env-var opt-out instead of the stored preference", async () => {
    process.env["HYPERFRAMES_NO_TELEMETRY"] = "1";
    const { command } = await loadTelemetryCommand({ configEnabled: true });
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    await runSubcommand(command, "status");

    const output = lines.join("\n");
    expect(output).toContain("disabled");
    expect(output).toContain("HYPERFRAMES_NO_TELEMETRY");
    expect(output).toContain("Tracked commands:");
  });

  it("reports DO_NOT_TRACK as the effective opt-out source", async () => {
    process.env["DO_NOT_TRACK"] = "1";
    const { command } = await loadTelemetryCommand({ configEnabled: true });
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    await runSubcommand(command, "status");

    expect(lines.join("\n")).toContain("DO_NOT_TRACK");
  });
});
