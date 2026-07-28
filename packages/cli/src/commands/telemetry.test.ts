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
  devMode?: boolean;
  apiKey?: string;
}) {
  const config = {
    ...baseConfig,
    telemetryEnabled: options?.configEnabled ?? true,
  };
  const writeConfigWithResult = vi.fn(() =>
    options?.writeSucceeds === false
      ? { ok: false as const, error: "EACCES: permission denied" }
      : { ok: true as const },
  );
  vi.resetModules();
  vi.doMock("../telemetry/config.js", () => ({
    CONFIG_PATH: "/test/.hyperframes/config.json",
    readConfig: () => {
      throw new Error("telemetry commands must bypass stale cached config");
    },
    readConfigFresh: () => ({ ...config }),
    writeConfigWithResult,
  }));
  vi.doMock("../utils/env.js", () => ({
    isDevMode: () => options?.devMode ?? false,
  }));
  vi.doMock("../telemetry/transport.js", () => ({
    POSTHOG_API_KEY: options?.apiKey ?? "phc_test",
  }));
  const module = await import("./telemetry.js");
  return { command: module.default, writeConfigWithResult };
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

async function runWithCapturedOutput(
  command: Awaited<ReturnType<typeof loadTelemetryCommand>>["command"],
  subcommand: string,
): Promise<string> {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  await runSubcommand(command, subcommand);
  return lines.join("\n");
}

describe("telemetry command", () => {
  afterEach(() => {
    vi.doUnmock("../telemetry/config.js");
    vi.doUnmock("../utils/env.js");
    vi.doUnmock("../telemetry/transport.js");
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env["HYPERFRAMES_NO_TELEMETRY"];
    delete process.env["DO_NOT_TRACK"];
  });

  it("persists disable from a fresh config snapshot", async () => {
    const { command, writeConfigWithResult } = await loadTelemetryCommand();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runSubcommand(command, "disable");

    expect(writeConfigWithResult).toHaveBeenCalledWith(
      expect.objectContaining({ telemetryEnabled: false }),
    );
  });

  it("fails instead of claiming success when the preference cannot be persisted", async () => {
    const { command } = await loadTelemetryCommand({ writeSucceeds: false });
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runSubcommand(command, "disable")).rejects.toMatchObject({
      name: "CliRuntimeError",
    });

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Could not persist"));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("EACCES: permission denied"));
    expect(stdout).not.toHaveBeenCalledWith(expect.stringContaining("Telemetry disabled"));
  });

  it("reports the effective env-var opt-out instead of the stored preference", async () => {
    process.env["HYPERFRAMES_NO_TELEMETRY"] = "1";
    const { command } = await loadTelemetryCommand({ configEnabled: true });
    const output = await runWithCapturedOutput(command, "status");
    expect(output).toContain("disabled");
    expect(output).toContain("HYPERFRAMES_NO_TELEMETRY");
    expect(output).toContain("Tracked commands:");
  });

  it("reports DO_NOT_TRACK as the effective opt-out source", async () => {
    process.env["DO_NOT_TRACK"] = "1";
    const { command } = await loadTelemetryCommand({ configEnabled: true });
    const output = await runWithCapturedOutput(command, "status");
    expect(output).toContain("DO_NOT_TRACK");
  });

  it.each([
    ["enable", "Telemetry preference"],
    ["disable", "Telemetry disabled"],
  ])("explains the effective override after telemetry %s", async (subcommand, expectedSuccess) => {
    process.env["HYPERFRAMES_NO_TELEMETRY"] = "true";
    const { command } = await loadTelemetryCommand({ configEnabled: subcommand === "disable" });
    const output = await runWithCapturedOutput(command, subcommand);
    expect(output).toContain(expectedSuccess);
    expect(output).toContain("remains disabled");
    expect(output).toContain("HYPERFRAMES_NO_TELEMETRY");
  });

  it("reports dev mode as the effective source", async () => {
    const { command } = await loadTelemetryCommand({ devMode: true });
    const output = await runWithCapturedOutput(command, "status");
    expect(output).toContain("disabled");
    expect(output).toContain("dev_mode");
  });

  it("reports a telemetry-disabled build as the effective source", async () => {
    const { command } = await loadTelemetryCommand({ apiKey: "disabled" });
    const output = await runWithCapturedOutput(command, "status");
    expect(output).toContain("disabled");
    expect(output).toContain("telemetry_disabled_build");
  });
});
